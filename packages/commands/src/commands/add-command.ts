/**
 * AddCommand - Stage files from working tree to index.
 *
 * Implements JGit-compatible fluent API for `git add` command:
 * - Add new files to index
 * - Update modified files in index
 * - Optionally remove deleted files (--all mode)
 * - Support for update-only mode (-u flag)
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/AddCommand.java
 *
 * @example
 * ```typescript
 * // Add specific files
 * await git.add()
 *   .addFilepattern("src/")
 *   .addFilepattern("lib/")
 *   .call();
 *
 * // Update only tracked files (git add -u)
 * await git.add()
 *   .addFilepattern(".")
 *   .setUpdate(true)
 *   .call();
 *
 * // Add all changes including deletions (git add -A)
 * await git.add()
 *   .addFilepattern(".")
 *   .setAll(true)
 *   .call();
 * ```
 */

import { DeleteStagingEntry, FileMode, UpdateStagingEntry } from "@webrun-vcs/vcs";
import type { WorkingTreeIterator } from "@webrun-vcs/worktree";

import { NoFilepatternError } from "../errors/index.js";
import { GitCommand } from "../git-command.js";
import type { GitStoreWithWorkTree } from "../types.js";

/**
 * Result of AddCommand execution.
 *
 * Contains lists of affected paths.
 */
export interface AddResult {
  /** Paths that were added or updated in the index */
  readonly added: string[];

  /** Paths that were skipped (ignored files) */
  readonly skipped: string[];

  /** Paths that were removed from index (deleted files in --all mode) */
  readonly removed: string[];

  /** Total number of files processed */
  readonly totalProcessed: number;
}

/**
 * Check if a path matches any pattern.
 *
 * Supports glob patterns:
 * - "." matches all files
 * - "*" matches within a single path component
 * - "**" matches across path separators
 * - Exact directory prefix matches (e.g., "src" matches "src/file.ts")
 */
function matchesPattern(path: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchGlob(path, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Simple glob matching.
 */
function matchGlob(path: string, pattern: string): boolean {
  // "." matches everything
  if (pattern === ".") {
    return true;
  }

  // Exact match
  if (path === pattern) {
    return true;
  }

  // Directory prefix (e.g., "src" matches "src/file")
  if (path.startsWith(`${pattern}/`)) {
    return true;
  }

  // Extension patterns like "*.ts"
  if (pattern.startsWith("*.") && !pattern.includes("/")) {
    const extension = pattern.slice(1);
    return path.endsWith(extension);
  }

  // Handle **/* pattern (matches all files)
  if (pattern === "**/*") {
    return true;
  }

  // Glob patterns with * or **
  if (pattern.includes("*")) {
    // Escape regex special chars except * and ?
    const escapedPattern = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");

    // ** matches anything including path separators
    // * matches anything except path separators
    const regexPattern = escapedPattern
      .replace(/\*\*/g, "<<<DOUBLESTAR>>>")
      .replace(/\*/g, "[^/]*")
      .replace(/<<<DOUBLESTAR>>>/g, ".*")
      .replace(/\?/g, ".");

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  return false;
}

/**
 * Command to stage files from working tree to index.
 *
 * Based on JGit's AddCommand. Provides fluent builder API
 * for staging files with various options.
 */
export class AddCommand extends GitCommand<AddResult> {
  private filepatterns: string[] = [];
  private update = false;
  private all: boolean | undefined;
  private force = false;
  private intentToAdd = false;
  private worktreeIterator: WorkingTreeIterator | undefined;

  /**
   * Add a path to a file/directory whose content should be added.
   *
   * A directory name (e.g., "src" to add "src/file1" and "src/file2")
   * can also be given to add all files in the directory recursively.
   *
   * If pattern "." is added, all changes in the repository will be added.
   *
   * @param filepattern Repository-relative path (with "/" as separator)
   * @returns this for chaining
   */
  addFilepattern(filepattern: string): this {
    this.checkCallable();
    this.filepatterns.push(filepattern);
    return this;
  }

  /**
   * Set whether to only match against already tracked files.
   *
   * If true, stages modified tracked files and removes deleted
   * tracked files from index, but never adds new files.
   *
   * Equivalent to `git add -u`.
   *
   * @param update Whether to only update tracked files
   * @returns this for chaining
   */
  setUpdate(update: boolean): this {
    this.checkCallable();
    this.update = update;
    return this;
  }

  /**
   * Whether update mode is enabled.
   */
  isUpdate(): boolean {
    return this.update;
  }

  /**
   * Set whether to also stage deletions.
   *
   * If true, removed files in the working tree will be
   * removed from the index as well.
   *
   * Equivalent to `git add -A` or `git add --all`.
   *
   * @param all Whether to stage deletions
   * @returns this for chaining
   */
  setAll(all: boolean): this {
    this.checkCallable();
    this.all = all;
    return this;
  }

  /**
   * Whether --all mode is enabled.
   */
  isAll(): boolean {
    return this.all === true;
  }

  /**
   * Set whether to add ignored files.
   *
   * If true, files normally ignored by .gitignore will be added.
   *
   * Equivalent to `git add -f` or `git add --force`.
   *
   * @param force Whether to add ignored files
   * @returns this for chaining
   */
  setForce(force: boolean): this {
    this.checkCallable();
    this.force = force;
    return this;
  }

  /**
   * Whether force mode is enabled.
   */
  isForce(): boolean {
    return this.force;
  }

  /**
   * Set whether to only record intent to add.
   *
   * If true, files are added as "intent to add" placeholders
   * without staging their content.
   *
   * Equivalent to `git add -N` or `git add --intent-to-add`.
   *
   * @param intentToAdd Whether to only record intent
   * @returns this for chaining
   */
  setIntentToAdd(intentToAdd: boolean): this {
    this.checkCallable();
    this.intentToAdd = intentToAdd;
    return this;
  }

  /**
   * Whether intent-to-add mode is enabled.
   */
  isIntentToAdd(): boolean {
    return this.intentToAdd;
  }

  /**
   * Set a custom working tree iterator.
   *
   * Allows using a custom implementation for filesystem access.
   *
   * @param iterator Custom working tree iterator
   * @returns this for chaining
   */
  setWorkingTreeIterator(iterator: WorkingTreeIterator): this {
    this.checkCallable();
    this.worktreeIterator = iterator;
    return this;
  }

  /**
   * Execute the add command.
   *
   * @returns Result with lists of added, skipped, and removed paths
   * @throws NoFilepatternError if no file patterns specified and not in update/all mode
   * @throws Error if working tree iterator not available
   */
  async call(): Promise<AddResult> {
    this.checkCallable();
    this.setCallable(false);

    // Validate options - update and all are mutually exclusive
    if (this.update && this.all !== undefined) {
      throw new Error("Cannot combine --update with --all/--no-all");
    }

    // Determine if we're adding all files
    let addAll: boolean;
    if (this.filepatterns.length === 0) {
      if (this.update || this.all !== undefined) {
        addAll = true;
      } else {
        throw new NoFilepatternError("At least one file pattern is required");
      }
    } else {
      addAll = this.filepatterns.includes(".");
      if (this.all === undefined && !this.update) {
        this.all = true;
      }
    }

    // Get working tree iterator
    const worktree = this.getWorktreeIterator();
    if (!worktree) {
      throw new Error(
        "Working tree iterator not available. " +
          "Use GitStoreWithWorkTree or call setWorkingTreeIterator().",
      );
    }

    // Whether to stage deletions
    const stageDeletions = this.update || (this.all !== undefined && this.all);

    // Use addAll pattern if needed
    const patterns = addAll ? ["."] : this.filepatterns;

    // Process files
    return this.processFiles(worktree, patterns, stageDeletions);
  }

  /**
   * Get working tree iterator from store or explicitly set.
   */
  private getWorktreeIterator(): WorkingTreeIterator | undefined {
    if (this.worktreeIterator) {
      return this.worktreeIterator;
    }

    // Try to get from store if it's a GitStoreWithWorkTree
    const store = this.store as GitStoreWithWorkTree;
    return store.worktree;
  }

  /**
   * Process files for staging.
   */
  private async processFiles(
    worktree: WorkingTreeIterator,
    patterns: string[],
    stageDeletions: boolean,
  ): Promise<AddResult> {
    const added: string[] = [];
    const skipped: string[] = [];
    const removed: string[] = [];

    // Collect files to process
    const filesToProcess: Array<{
      path: string;
      exists: boolean;
      isIgnored: boolean;
    }> = [];

    // Walk worktree to find matching files
    for await (const entry of worktree.walk({ includeIgnored: true })) {
      if (entry.isDirectory) continue;

      // Check if file matches any pattern
      if (!matchesPattern(entry.path, patterns)) {
        continue;
      }

      // Skip ignored files unless force
      if (entry.isIgnored && !this.force) {
        skipped.push(entry.path);
        continue;
      }

      filesToProcess.push({
        path: entry.path,
        exists: true,
        isIgnored: entry.isIgnored,
      });
    }

    // If update or all mode, check for deleted files in index
    if (this.update || stageDeletions) {
      const indexedPaths = new Set<string>();
      for await (const entry of this.store.staging.listEntries()) {
        if (entry.stage === 0) {
          indexedPaths.add(entry.path);
        }
      }

      // Find paths in index that match patterns but not in worktree
      for (const indexPath of indexedPaths) {
        if (!matchesPattern(indexPath, patterns)) {
          continue;
        }

        const worktreeEntry = await worktree.getEntry(indexPath);
        if (!worktreeEntry) {
          // File was deleted from worktree
          filesToProcess.push({
            path: indexPath,
            exists: false,
            isIgnored: false,
          });
        }
      }
    }

    // If update mode, filter to only tracked files
    if (this.update) {
      const trackedPaths = new Set<string>();
      for await (const entry of this.store.staging.listEntries()) {
        if (entry.stage === 0) {
          trackedPaths.add(entry.path);
        }
      }

      const filtered = filesToProcess.filter((f) => trackedPaths.has(f.path));
      filesToProcess.length = 0;
      filesToProcess.push(...filtered);
    }

    // Process files
    const editor = this.store.staging.editor();

    for (const file of filesToProcess) {
      if (!file.exists) {
        // File deleted from worktree - remove from index
        editor.add(new DeleteStagingEntry(file.path));
        removed.push(file.path);
        continue;
      }

      if (this.intentToAdd) {
        // Just mark as intent-to-add (placeholder with empty blob)
        const worktreeEntry = await worktree.getEntry(file.path);
        const mode = worktreeEntry?.mode ?? FileMode.REGULAR_FILE;
        editor.add(
          new UpdateStagingEntry(file.path, "", mode, {
            size: 0,
            mtime: Date.now(),
          }),
        );
        added.push(file.path);
        continue;
      }

      // Get file info
      const worktreeEntry = await worktree.getEntry(file.path);
      if (!worktreeEntry) {
        // File disappeared during processing
        continue;
      }

      // Hash and store content
      const objectId = await this.storeFileContent(worktree, file.path);

      // Add to staging
      editor.add(
        new UpdateStagingEntry(file.path, objectId, worktreeEntry.mode, {
          size: worktreeEntry.size,
          mtime: worktreeEntry.mtime,
        }),
      );
      added.push(file.path);
    }

    // Apply changes
    await editor.finish();

    return {
      added,
      skipped,
      removed,
      totalProcessed: added.length + removed.length,
    };
  }

  /**
   * Store file content as blob and return object ID.
   */
  private async storeFileContent(worktree: WorkingTreeIterator, path: string): Promise<string> {
    // Read content from working tree
    const chunks: Uint8Array[] = [];
    for await (const chunk of worktree.readContent(path)) {
      chunks.push(chunk);
    }

    // Calculate total size
    const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);

    // Create blob header
    const header = new TextEncoder().encode(`blob ${totalSize}\0`);

    // Combine header and content
    const fullContent = new Uint8Array(header.length + totalSize);
    fullContent.set(header, 0);

    let offset = header.length;
    for (const chunk of chunks) {
      fullContent.set(chunk, offset);
      offset += chunk.length;
    }

    // Store and get hash
    return this.store.objects.store([fullContent]);
  }
}
