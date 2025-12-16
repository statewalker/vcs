/**
 * StatusCalculator - Compares working tree, index, and HEAD to detect changes.
 *
 * Performs three-way comparison:
 * 1. HEAD tree (last commit)
 * 2. Index (staging area)
 * 3. Working tree (filesystem)
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/StatusCommand.java
 */

import {
  FileMode,
  type CommitStore,
  type ObjectId,
  type RefStore,
  type StagingStore,
  type TreeStore,
  isSymbolicRef,
} from "@webrun-vcs/vcs";

import type { WorkingTreeIterator } from "./interfaces/working-tree-iterator.js";
import {
  FileStatus,
  type FileStatusEntry,
  type FileStatusValue,
  type RepositoryStatus,
  type StatusCalculator as IStatusCalculator,
  type StatusOptions,
} from "./interfaces/status.js";

/**
 * Tree entry info for comparison.
 */
interface TreeEntryInfo {
  objectId: ObjectId;
  mode: number;
}

/**
 * Index entry info for comparison.
 */
interface IndexEntryInfo {
  objectId: ObjectId;
  mode: number;
  size: number;
  mtime: number;
}

/**
 * Working tree entry info for comparison.
 */
interface WorktreeEntryInfo {
  size: number;
  mtime: number;
  mode: number;
  isIgnored: boolean;
}

/**
 * Options for creating a StatusCalculator.
 */
export interface StatusCalculatorOptions {
  /** Working tree iterator */
  worktree: WorkingTreeIterator;

  /** Staging area (index) */
  staging: StagingStore;

  /** Tree storage */
  trees: TreeStore;

  /** Commit storage */
  commits: CommitStore;

  /** Reference storage */
  refs: RefStore;
}

/**
 * StatusCalculator implementation.
 */
export class StatusCalculatorImpl implements IStatusCalculator {
  private readonly worktree: WorkingTreeIterator;
  private readonly staging: StagingStore;
  private readonly trees: TreeStore;
  private readonly commits: CommitStore;
  private readonly refs: RefStore;

  constructor(options: StatusCalculatorOptions) {
    this.worktree = options.worktree;
    this.staging = options.staging;
    this.trees = options.trees;
    this.commits = options.commits;
    this.refs = options.refs;
  }

  /**
   * Calculate full repository status.
   */
  async calculateStatus(options: StatusOptions = {}): Promise<RepositoryStatus> {
    const { includeIgnored = false, includeUntracked = true, pathPrefix = "" } = options;

    // Get HEAD tree
    const headRef = await this.refs.resolve("HEAD");
    const headTreeId = headRef?.objectId
      ? await this.commits.getTree(headRef.objectId)
      : undefined;

    // Build maps for comparison
    const headEntries = headTreeId
      ? await this.buildTreeMap(headTreeId, "")
      : new Map<string, TreeEntryInfo>();

    const indexEntries = await this.buildIndexMap();
    const worktreeEntries = await this.buildWorktreeMap(includeIgnored, pathPrefix);

    // Collect all paths
    const allPaths = new Set([
      ...headEntries.keys(),
      ...indexEntries.keys(),
      ...worktreeEntries.keys(),
    ]);

    // Calculate status for each path
    const files: FileStatusEntry[] = [];
    let hasStaged = false;
    let hasUnstaged = false;
    let hasUntracked = false;
    let hasConflicts = false;

    for (const path of allPaths) {
      // Filter by path prefix if specified
      if (pathPrefix && !path.startsWith(pathPrefix)) {
        continue;
      }

      const headEntry = headEntries.get(path);
      const indexEntry = indexEntries.get(path);
      const worktreeEntry = worktreeEntries.get(path);

      const status = this.calculateFileStatus(path, headEntry, indexEntry, worktreeEntry);

      // Track summary flags
      if (status.indexStatus !== FileStatus.UNMODIFIED) {
        hasStaged = true;
      }
      if (
        status.workTreeStatus !== FileStatus.UNMODIFIED &&
        status.workTreeStatus !== FileStatus.UNTRACKED &&
        status.workTreeStatus !== FileStatus.IGNORED
      ) {
        hasUnstaged = true;
      }
      if (status.workTreeStatus === FileStatus.UNTRACKED) {
        hasUntracked = true;
      }
      if (status.indexStatus === FileStatus.CONFLICTED) {
        hasConflicts = true;
      }

      // Only include non-unmodified entries
      if (
        status.indexStatus !== FileStatus.UNMODIFIED ||
        status.workTreeStatus !== FileStatus.UNMODIFIED
      ) {
        // Filter ignored/untracked based on options
        if (!includeIgnored && status.workTreeStatus === FileStatus.IGNORED) {
          continue;
        }
        if (!includeUntracked && status.workTreeStatus === FileStatus.UNTRACKED) {
          continue;
        }

        files.push(status);
      }
    }

    // Check for conflicts in staging
    if (await this.staging.hasConflicts()) {
      hasConflicts = true;
      // Add conflict entries
      for await (const conflictPath of this.staging.getConflictPaths()) {
        const existing = files.find((f) => f.path === conflictPath);
        if (existing) {
          existing.indexStatus = FileStatus.CONFLICTED;
        } else {
          files.push({
            path: conflictPath,
            indexStatus: FileStatus.CONFLICTED,
            workTreeStatus: FileStatus.UNMODIFIED,
          });
        }
      }
    }

    // Sort files by path
    files.sort((a, b) => a.path.localeCompare(b.path));

    // Get branch info
    const branch = await this.getCurrentBranch();

    return {
      branch,
      head: headRef?.objectId,
      files,
      isClean: files.length === 0,
      hasStaged,
      hasUnstaged,
      hasUntracked,
      hasConflicts,
    };
  }

  /**
   * Get status for a specific file.
   */
  async getFileStatus(path: string): Promise<FileStatusEntry | undefined> {
    // Get HEAD tree entry
    const headRef = await this.refs.resolve("HEAD");
    const headTreeId = headRef?.objectId
      ? await this.commits.getTree(headRef.objectId)
      : undefined;

    const headEntry = headTreeId ? await this.getTreeEntry(headTreeId, path) : undefined;

    // Get index entry
    const indexEntry = await this.staging.getEntry(path);
    const indexInfo = indexEntry
      ? {
          objectId: indexEntry.objectId,
          mode: indexEntry.mode,
          size: indexEntry.size,
          mtime: indexEntry.mtime,
        }
      : undefined;

    // Get worktree entry
    const worktreeEntry = await this.worktree.getEntry(path);
    const worktreeInfo = worktreeEntry
      ? {
          size: worktreeEntry.size,
          mtime: worktreeEntry.mtime,
          mode: worktreeEntry.mode,
          isIgnored: worktreeEntry.isIgnored,
        }
      : undefined;

    const status = this.calculateFileStatus(path, headEntry, indexInfo, worktreeInfo);

    // Return undefined if completely unmodified
    if (
      status.indexStatus === FileStatus.UNMODIFIED &&
      status.workTreeStatus === FileStatus.UNMODIFIED
    ) {
      return undefined;
    }

    return status;
  }

  /**
   * Check if a file is modified (quick check).
   */
  async isModified(path: string): Promise<boolean> {
    const indexEntry = await this.staging.getEntry(path);
    if (!indexEntry) {
      // Not in index - check if it exists in worktree
      const worktreeEntry = await this.worktree.getEntry(path);
      return worktreeEntry !== undefined;
    }

    const worktreeEntry = await this.worktree.getEntry(path);
    if (!worktreeEntry) {
      // In index but deleted from worktree
      return true;
    }

    // Quick size check
    if (indexEntry.size !== worktreeEntry.size) {
      return true;
    }

    // Check mtime (racily clean detection)
    // If mtime is older than index update, trust size check
    const indexUpdateTime = this.staging.getUpdateTime();
    if (worktreeEntry.mtime < indexUpdateTime - 3000) {
      return false;
    }

    // Potentially modified (racily clean scenario)
    return true;
  }

  /**
   * Calculate status for a single file.
   */
  private calculateFileStatus(
    path: string,
    head: TreeEntryInfo | undefined,
    index: IndexEntryInfo | undefined,
    worktree: WorktreeEntryInfo | undefined,
  ): FileStatusEntry {
    // Index vs HEAD (staged changes)
    let indexStatus: FileStatusValue;
    if (!head && index) {
      indexStatus = FileStatus.ADDED;
    } else if (head && !index) {
      indexStatus = FileStatus.DELETED;
    } else if (head && index && head.objectId !== index.objectId) {
      indexStatus = FileStatus.MODIFIED;
    } else {
      indexStatus = FileStatus.UNMODIFIED;
    }

    // Worktree vs Index (unstaged changes)
    let workTreeStatus: FileStatusValue;
    if (!index && worktree) {
      workTreeStatus = worktree.isIgnored ? FileStatus.IGNORED : FileStatus.UNTRACKED;
    } else if (index && !worktree) {
      workTreeStatus = FileStatus.DELETED;
    } else if (index && worktree) {
      // Check if content changed
      if (this.isWorktreeModified(index, worktree)) {
        workTreeStatus = FileStatus.MODIFIED;
      } else {
        workTreeStatus = FileStatus.UNMODIFIED;
      }
    } else {
      workTreeStatus = FileStatus.UNMODIFIED;
    }

    return {
      path,
      indexStatus,
      workTreeStatus,
    };
  }

  /**
   * Check if worktree file differs from index.
   */
  private isWorktreeModified(index: IndexEntryInfo, worktree: WorktreeEntryInfo): boolean {
    // Quick check: size mismatch
    if (index.size !== worktree.size) {
      return true;
    }

    // Quick check: mode mismatch (executable bit)
    // Normalize modes for comparison (ignore tree vs file distinction)
    const indexIsExecutable = index.mode === FileMode.EXECUTABLE_FILE;
    const worktreeIsExecutable = worktree.mode === FileMode.EXECUTABLE_FILE;
    if (indexIsExecutable !== worktreeIsExecutable) {
      return true;
    }

    // Check mtime (racily clean detection)
    // If mtime is older than index update, trust the size check
    const indexUpdateTime = this.staging.getUpdateTime();
    if (worktree.mtime < indexUpdateTime - 3000) {
      return false;
    }

    // Potentially modified (racily clean scenario)
    // For accurate detection, would need content hash comparison
    return true;
  }

  /**
   * Build map from tree.
   */
  private async buildTreeMap(
    treeId: ObjectId,
    prefix: string,
  ): Promise<Map<string, TreeEntryInfo>> {
    const map = new Map<string, TreeEntryInfo>();

    for await (const entry of this.trees.loadTree(treeId)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.mode === FileMode.TREE) {
        // Recurse into subtree
        const subtreeMap = await this.buildTreeMap(entry.id, path);
        for (const [subPath, subEntry] of subtreeMap) {
          map.set(subPath, subEntry);
        }
      } else {
        map.set(path, {
          objectId: entry.id,
          mode: entry.mode,
        });
      }
    }

    return map;
  }

  /**
   * Build map from index.
   */
  private async buildIndexMap(): Promise<Map<string, IndexEntryInfo>> {
    const map = new Map<string, IndexEntryInfo>();

    for await (const entry of this.staging.listEntries()) {
      // Only stage 0 entries (non-conflicted)
      if (entry.stage === 0) {
        map.set(entry.path, {
          objectId: entry.objectId,
          mode: entry.mode,
          size: entry.size,
          mtime: entry.mtime,
        });
      }
    }

    return map;
  }

  /**
   * Build map from working tree.
   */
  private async buildWorktreeMap(
    _includeIgnored: boolean,
    pathPrefix: string,
  ): Promise<Map<string, WorktreeEntryInfo>> {
    const map = new Map<string, WorktreeEntryInfo>();

    for await (const entry of this.worktree.walk({
      includeIgnored: true, // Always include to detect ignored status
      pathPrefix,
    })) {
      if (!entry.isDirectory) {
        map.set(entry.path, {
          size: entry.size,
          mtime: entry.mtime,
          mode: entry.mode,
          isIgnored: entry.isIgnored,
        });
      }
    }

    return map;
  }

  /**
   * Get tree entry by path.
   */
  private async getTreeEntry(
    treeId: ObjectId,
    path: string,
  ): Promise<TreeEntryInfo | undefined> {
    const parts = path.split("/");
    let currentTreeId = treeId;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const entry = await this.trees.getEntry(currentTreeId, name);

      if (!entry) {
        return undefined;
      }

      if (i === parts.length - 1) {
        return {
          objectId: entry.id,
          mode: entry.mode,
        };
      }

      if (entry.mode !== FileMode.TREE) {
        return undefined;
      }

      currentTreeId = entry.id;
    }

    return undefined;
  }

  /**
   * Get current branch name.
   */
  private async getCurrentBranch(): Promise<string | undefined> {
    const head = await this.refs.get("HEAD");
    if (head && isSymbolicRef(head)) {
      const target = head.target;
      if (target.startsWith("refs/heads/")) {
        return target.slice("refs/heads/".length);
      }
    }
    return undefined;
  }
}

/**
 * Create a StatusCalculator.
 *
 * @param options Calculator options
 * @returns New StatusCalculator instance
 */
export function createStatusCalculator(options: StatusCalculatorOptions): IStatusCalculator {
  return new StatusCalculatorImpl(options);
}
