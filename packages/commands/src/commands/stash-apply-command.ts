import type { ObjectId } from "@webrun-vcs/core";

import { InvalidArgumentError, NoHeadError, RefNotFoundError } from "../errors/index.js";
import { GitCommand } from "../git-command.js";
import { type ContentMergeStrategy, MergeStrategy } from "../results/merge-result.js";
import type { StashApplyResult } from "../results/stash-result.js";
import { StashApplyStatus } from "../results/stash-result.js";
import { STASH_REF } from "./stash-list-command.js";

/**
 * Command to apply a stashed commit.
 *
 * Equivalent to `git stash apply`.
 *
 * Based on JGit's StashApplyCommand.
 *
 * @example
 * ```typescript
 * // Apply most recent stash
 * const result = await git.stashApply().call();
 *
 * // Apply specific stash
 * const result = await git.stashApply()
 *   .setStashRef("stash@{2}")
 *   .call();
 *
 * // Apply without restoring index
 * const result = await git.stashApply()
 *   .setRestoreIndex(false)
 *   .call();
 * ```
 */
export class StashApplyCommand extends GitCommand<StashApplyResult> {
  private stashRef?: string;
  private restoreIndex = true;
  private restoreUntracked = true;
  private strategy = MergeStrategy.RECURSIVE;
  private contentStrategy?: ContentMergeStrategy;

  /**
   * Set the stash reference to apply.
   *
   * Defaults to stash@{0} (most recent) if not specified.
   *
   * @param stashRef Name of the stash ref to apply
   */
  setStashRef(stashRef: string): this {
    this.checkCallable();
    this.stashRef = stashRef;
    return this;
  }

  /**
   * Get the stash reference.
   */
  getStashRef(): string | undefined {
    return this.stashRef;
  }

  /**
   * Set whether to restore the index state.
   *
   * @param restoreIndex true to restore index (default)
   */
  setRestoreIndex(restoreIndex: boolean): this {
    this.checkCallable();
    this.restoreIndex = restoreIndex;
    return this;
  }

  /**
   * Get whether index will be restored.
   */
  getRestoreIndex(): boolean {
    return this.restoreIndex;
  }

  /**
   * Set whether to restore untracked files.
   *
   * @param restoreUntracked true to restore untracked files (default)
   */
  setRestoreUntracked(restoreUntracked: boolean): this {
    this.checkCallable();
    this.restoreUntracked = restoreUntracked;
    return this;
  }

  /**
   * Get whether untracked files will be restored.
   */
  getRestoreUntracked(): boolean {
    return this.restoreUntracked;
  }

  /**
   * Set whether to ignore repository state when applying.
   *
   * Note: Currently not implemented - stash apply always ignores repo state.
   *
   * @param _ignore true to ignore state
   */
  setIgnoreRepositoryState(_ignore: boolean): this {
    this.checkCallable();
    // Not currently implemented - reserved for future use
    return this;
  }

  /**
   * Set the merge strategy to use.
   *
   * @param strategy The merge strategy
   */
  setStrategy(strategy: MergeStrategy): this {
    this.checkCallable();
    this.strategy = strategy;
    return this;
  }

  /**
   * Get the merge strategy.
   */
  getStrategy(): MergeStrategy {
    return this.strategy;
  }

  /**
   * Set the content merge strategy for file-level conflicts.
   *
   * @param strategy The content merge strategy
   */
  setContentMergeStrategy(strategy: ContentMergeStrategy): this {
    this.checkCallable();
    this.contentStrategy = strategy;
    return this;
  }

  /**
   * Get the content merge strategy.
   */
  getContentMergeStrategy(): ContentMergeStrategy | undefined {
    return this.contentStrategy;
  }

  /**
   * Execute the stash apply command.
   *
   * @returns Result of the apply operation
   */
  async call(): Promise<StashApplyResult> {
    this.checkCallable();
    this.setCallable(false);

    // Get HEAD commit
    const headRef = await this.store.refs.resolve("HEAD");
    if (!headRef?.objectId) {
      throw new NoHeadError("HEAD is required to apply stash");
    }

    // Get stash commit
    const stashId = await this.resolveStashRef();
    const stashCommit = await this.store.commits.loadCommit(stashId);

    // Validate stash commit structure
    if (stashCommit.parents.length < 2 || stashCommit.parents.length > 3) {
      throw new InvalidArgumentError(
        "stashRef",
        stashId,
        `Stash commit ${stashId} has invalid number of parents: ${stashCommit.parents.length}`,
      );
    }

    const stashHeadCommit = stashCommit.parents[0];
    const stashIndexCommit = stashCommit.parents[1];
    const stashUntrackedCommit = stashCommit.parents[2]; // Optional

    // Three-way merge: stash base -> current HEAD with stash changes
    const headCommit = await this.store.commits.loadCommit(headRef.objectId);
    const stashHeadTree = (await this.store.commits.loadCommit(stashHeadCommit)).tree;
    const stashWorkingTree = stashCommit.tree;

    // Merge working tree changes
    const mergeResult = await this.mergeTreesThreeWay(
      stashHeadTree,
      stashWorkingTree,
      headCommit.tree,
    );

    if (mergeResult.conflicts && mergeResult.conflicts.length > 0) {
      return {
        status: StashApplyStatus.CONFLICTS,
        stashCommit: stashId,
        conflicts: mergeResult.conflicts,
      };
    }

    // If restoreIndex, also merge index changes
    if (this.restoreIndex) {
      const stashIndexTree = (await this.store.commits.loadCommit(stashIndexCommit)).tree;
      const indexMergeResult = await this.mergeTreesThreeWay(
        stashHeadTree,
        stashIndexTree,
        headCommit.tree,
      );

      if (indexMergeResult.conflicts && indexMergeResult.conflicts.length > 0) {
        return {
          status: StashApplyStatus.CONFLICTS,
          stashCommit: stashId,
          conflicts: indexMergeResult.conflicts,
        };
      }
    }

    // Handle untracked files
    if (this.restoreUntracked && stashUntrackedCommit) {
      const _untrackedCommit = await this.store.commits.loadCommit(stashUntrackedCommit);
      // The untracked tree would need to be extracted to the working directory
      // This requires working tree access
    }

    return {
      status: StashApplyStatus.OK,
      stashCommit: stashId,
    };
  }

  /**
   * Resolve the stash reference to a commit ID.
   */
  private async resolveStashRef(): Promise<ObjectId> {
    const refName = this.stashRef ?? `${STASH_REF}@{0}`;

    // Handle stash@{N} syntax
    const match = refName.match(/^(.+)@\{(\d+)\}$/);
    if (match) {
      let baseRef = match[1];
      const index = parseInt(match[2], 10);

      // Normalize stash to refs/stash
      if (baseRef === "stash") {
        baseRef = STASH_REF;
      }

      // For index 0, just resolve the ref
      if (index === 0) {
        const ref = await this.store.refs.resolve(baseRef);
        if (!ref?.objectId) {
          throw new RefNotFoundError(refName);
        }
        return ref.objectId;
      }

      // For other indices, need reflog support
      // Note: The core RefStore interface doesn't include reflog methods.
      // Without reflog, we can only access the most recent stash (index 0).
      throw new RefNotFoundError(refName, `Stash entry ${index} not found (reflog not supported)`);
    }

    // Try as direct ref
    const ref = await this.store.refs.resolve(refName);
    if (ref?.objectId) {
      return ref.objectId;
    }

    // Try as commit ID
    if (await this.store.commits.hasCommit(refName)) {
      return refName;
    }

    throw new RefNotFoundError(refName);
  }

  /**
   * Directory mode constant.
   */
  private static readonly TREE_MODE = 0o040000;

  /**
   * Recursively walk a tree, yielding all entries with full paths.
   */
  private async *walkTreeRecursive(
    treeId: ObjectId,
    prefix = "",
  ): AsyncGenerator<{ path: string; id: ObjectId; mode: number }> {
    for await (const entry of this.store.trees.loadTree(treeId)) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;

      if ((entry.mode & StashApplyCommand.TREE_MODE) === StashApplyCommand.TREE_MODE) {
        // It's a directory - recurse into it
        yield* this.walkTreeRecursive(entry.id, fullPath);
      } else {
        // It's a file
        yield { path: fullPath, id: entry.id, mode: entry.mode };
      }
    }
  }

  /**
   * Build a tree from flat path entries (handles nested directories).
   */
  private async buildTreeFromPaths(
    entries: Map<string, { id: ObjectId; mode: number }>,
  ): Promise<ObjectId> {
    // Group entries by top-level directory
    const rootEntries: Map<string, { id: ObjectId; mode: number }> = new Map();
    const subDirs: Map<string, Map<string, { id: ObjectId; mode: number }>> = new Map();

    for (const [path, entry] of entries) {
      const slashIndex = path.indexOf("/");
      if (slashIndex === -1) {
        // Top-level file
        rootEntries.set(path, entry);
      } else {
        // Nested path - group by first component
        const dirName = path.substring(0, slashIndex);
        const restPath = path.substring(slashIndex + 1);

        if (!subDirs.has(dirName)) {
          subDirs.set(dirName, new Map());
        }
        subDirs.get(dirName)?.set(restPath, entry);
      }
    }

    // Recursively create subtrees
    for (const [dirName, subEntries] of subDirs) {
      const subTreeId = await this.buildTreeFromPaths(subEntries);
      rootEntries.set(dirName, { id: subTreeId, mode: StashApplyCommand.TREE_MODE });
    }

    // Create the tree
    const treeEntries = Array.from(rootEntries.entries()).map(([name, { id, mode }]) => ({
      name,
      id,
      mode,
    }));

    return this.store.trees.storeTree(treeEntries);
  }

  /**
   * Three-way tree merge with recursive support.
   */
  private async mergeTreesThreeWay(
    base: ObjectId,
    ours: ObjectId,
    theirs: ObjectId,
  ): Promise<{ tree: ObjectId; conflicts?: string[] }> {
    // Simplified merge
    if (ours === theirs) {
      return { tree: theirs };
    }
    if (base === ours) {
      return { tree: theirs };
    }
    if (base === theirs) {
      return { tree: ours };
    }

    // Collect all entries from all trees recursively
    const conflicts: string[] = [];
    const mergedEntries: Map<string, { id: ObjectId; mode: number }> = new Map();

    const baseEntries = new Map<string, { id: ObjectId; mode: number }>();
    const oursEntries = new Map<string, { id: ObjectId; mode: number }>();
    const theirsEntries = new Map<string, { id: ObjectId; mode: number }>();

    // Recursively walk all trees
    for await (const entry of this.walkTreeRecursive(base)) {
      baseEntries.set(entry.path, { id: entry.id, mode: entry.mode });
    }
    for await (const entry of this.walkTreeRecursive(ours)) {
      oursEntries.set(entry.path, { id: entry.id, mode: entry.mode });
    }
    for await (const entry of this.walkTreeRecursive(theirs)) {
      theirsEntries.set(entry.path, { id: entry.id, mode: entry.mode });
    }

    const allPaths = new Set([
      ...baseEntries.keys(),
      ...oursEntries.keys(),
      ...theirsEntries.keys(),
    ]);

    for (const path of allPaths) {
      const baseEntry = baseEntries.get(path);
      const oursEntry = oursEntries.get(path);
      const theirsEntry = theirsEntries.get(path);

      const baseId = baseEntry?.id;
      const oursId = oursEntry?.id;
      const theirsId = theirsEntry?.id;

      // If ours unchanged from base, take theirs
      if (oursId === baseId) {
        if (theirsEntry) {
          mergedEntries.set(path, theirsEntry);
        }
        // Otherwise deleted in theirs
        continue;
      }

      // If theirs unchanged from base, take ours
      if (theirsId === baseId) {
        if (oursEntry) {
          mergedEntries.set(path, oursEntry);
        }
        // Otherwise deleted in ours
        continue;
      }

      // Both changed - check if same change
      if (oursId === theirsId && oursEntry) {
        mergedEntries.set(path, oursEntry);
        continue;
      }

      // Conflict
      conflicts.push(path);
      // For now, take theirs
      if (theirsEntry) {
        mergedEntries.set(path, theirsEntry);
      }
    }

    if (conflicts.length > 0) {
      return { tree: theirs, conflicts };
    }

    // Build tree from merged entries (handles nested paths)
    const newTree = await this.buildTreeFromPaths(mergedEntries);
    return { tree: newTree };
  }
}
