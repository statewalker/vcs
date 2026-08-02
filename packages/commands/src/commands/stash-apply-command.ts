import type { ObjectId } from "@statewalker/vcs-core";
import type { Worktree } from "@statewalker/vcs-working-tree";

import {
  InvalidArgumentError,
  NoHeadError,
  RefNotFoundError,
  StashApplyFailedError,
  StoreNotAvailableError,
} from "../errors/index.js";
import { GitCommand } from "../git-command.js";
import { type ContentMergeStrategy, MergeStrategy } from "../results/merge-result.js";
import type { StashApplyResult } from "../results/stash-result.js";
import { StashApplyStatus } from "../results/stash-result.js";
import { STASH_REF } from "./stash-list-command.js";
import { planTreeRestore, type TreeRestorePlan, writeTreeRestorePlan } from "./tree-restore.js";

/** Names this operation in restore failure messages. */
const STASH_APPLY = "stash apply";

/**
 * Command to apply a stashed commit.
 *
 * Equivalent to `git stash apply`.
 *
 * Based on JGit's StashApplyCommand.
 *
 * The stashed changes are three-way merged against the current HEAD and the
 * result is written back: the merged working tree always, the merged index
 * when `restoreIndex` is set, and the stashed untracked files when
 * `restoreUntracked` is set. A conflict aborts before anything is written.
 *
 * Known limits, shared with `reset --hard`:
 * - a symlink in the merged tree is refused, because the `Worktree` interface
 *   has no primitive to create one - writing the target as a regular file
 *   would silently produce a working tree that does not match;
 * - a gitlink's contents are not restored, as in git;
 * - directories left empty by a deletion are not pruned;
 * - the restore is not atomic across the working tree and the index.
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

    // Applying a stash means putting files back. A repository with no working
    // tree has nowhere to put them, and reporting OK there would be the same
    // silent no-op this command used to be.
    const worktree = this.worktreeAccess;
    if (!worktree) {
      throw new StoreNotAvailableError("worktree", "stash apply requires a working tree");
    }

    // Get HEAD commit
    const headRef = await this.refsStore.resolve("HEAD");
    if (!headRef?.objectId) {
      throw new NoHeadError("HEAD is required to apply stash");
    }

    // Get stash commit
    const stashId = await this.resolveStashRef();
    const stashCommit = await this.commits.load(stashId);
    if (!stashCommit) {
      throw new RefNotFoundError(stashId, "Stash commit not found");
    }

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
    const headCommit = await this.commits.load(headRef.objectId);
    const stashHeadCommitObj = await this.commits.load(stashHeadCommit);
    if (!headCommit || !stashHeadCommitObj) {
      throw new RefNotFoundError(headRef.objectId, "Head or stash commit not found");
    }
    const stashHeadTree = stashHeadCommitObj.tree;
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

    // If restoreIndex, also merge index changes. Both merges are resolved
    // before anything is written, so a conflict in either leaves the working
    // tree and the index exactly as they were.
    let mergedIndexTree: ObjectId | undefined;
    if (this.restoreIndex) {
      const stashIndexCommitObj = await this.commits.load(stashIndexCommit);
      const stashIndexTree = stashIndexCommitObj?.tree ?? stashHeadTree;
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

      mergedIndexTree = indexMergeResult.tree;
    }

    // Plan the whole restore - the merged working tree, the paths it deletes,
    // and the untracked files - and validate it before touching anything. A
    // stash this command cannot restore faithfully then fails with the working
    // tree intact rather than half applied.
    const worktreePlan = await planTreeRestore(
      this.trees,
      this.blobs,
      mergeResult.tree,
      STASH_APPLY,
    );

    // A tracked path the merged tree does not account for is one the stash
    // deleted; it has to go, or the delete half of the stash is silently
    // dropped. Tracked means "in the index", as it does for `reset --hard`:
    // untracked files are none of this command's business, and a path removed
    // from the index is no longer tracked whatever HEAD's tree still says.
    const trackedPaths = new Set<string>();
    for await (const entry of this.staging.entries()) {
      trackedPaths.add(entry.path);
    }
    const removals = [...trackedPaths].filter((path) => !worktreePlan.paths.has(path));

    const untrackedPlan = await this.planUntrackedRestore(
      stashUntrackedCommit,
      worktreePlan,
      worktree,
    );

    // Everything below this line writes.
    await writeTreeRestorePlan(worktree, this.blobs, worktreePlan, STASH_APPLY);
    for (const path of removals) {
      await worktree.remove(path);
    }
    if (untrackedPlan) {
      // Restored untracked files are written to the working tree only - they
      // were untracked when stashed and stay untracked now.
      await writeTreeRestorePlan(worktree, this.blobs, untrackedPlan, STASH_APPLY);
    }
    if (mergedIndexTree !== undefined) {
      await this.staging.readTree(this.trees, mergedIndexTree);
      await this.staging.write();
    }

    return {
      status: StashApplyStatus.OK,
      stashCommit: stashId,
    };
  }

  /**
   * Plan the restore of the stash's untracked files, if there are any to restore.
   *
   * Untracked files are stashed in their own parentless commit and are not
   * merged with anything: they are simply written back. A stashed untracked
   * file whose path is already taken - by a file on disk, or by one the merged
   * tree is about to write - is refused rather than overwritten, since nothing
   * in the stash records what the displaced content was.
   *
   * @param untrackedCommitId The stash's third parent, if it has one
   * @param worktreePlan The already-planned restore of the merged working tree
   * @param worktree The working tree, checked for existing files
   * @returns The plan, or undefined if there is nothing to restore
   */
  private async planUntrackedRestore(
    untrackedCommitId: ObjectId | undefined,
    worktreePlan: TreeRestorePlan,
    worktree: Worktree,
  ): Promise<TreeRestorePlan | undefined> {
    if (!this.restoreUntracked || !untrackedCommitId) {
      return undefined;
    }

    const untrackedCommit = await this.commits.load(untrackedCommitId);
    if (!untrackedCommit) {
      throw new RefNotFoundError(untrackedCommitId, "Stash untracked commit not found");
    }

    const plan = await planTreeRestore(this.trees, this.blobs, untrackedCommit.tree, STASH_APPLY);

    for (const { path } of plan.entries) {
      if (worktreePlan.paths.has(path) || (await worktree.exists(path))) {
        throw new StashApplyFailedError(
          untrackedCommitId,
          undefined,
          `stash apply would overwrite ${path} with a stashed untracked file`,
        );
      }
    }

    return plan;
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
        const ref = await this.refsStore.resolve(baseRef);
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
    const ref = await this.refsStore.resolve(refName);
    if (ref?.objectId) {
      return ref.objectId;
    }

    // Try as commit ID
    if (await this.commits.has(refName)) {
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
    for await (const entry of this.trees.loadTree(treeId)) {
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

    return this.trees.storeTree(treeEntries);
  }

  /**
   * Whether two optional tree entries denote the same state for a path.
   *
   * Both absent means the path is absent on both sides. When both are present,
   * content *and* mode must match: comparing object ids alone treats a
   * mode-only change (setting the executable bit on unchanged content, say) as
   * no change at all, which silently discards it.
   */
  private static entriesEqual(
    a: { id: ObjectId; mode: number } | undefined,
    b: { id: ObjectId; mode: number } | undefined,
  ): boolean {
    if (!a || !b) {
      return !a && !b;
    }
    return a.id === b.id && a.mode === b.mode;
  }

  /**
   * Path-level three-way tree merge with recursive support.
   *
   * The base is the tree of the commit the stash was taken from, so
   * base->ours is exactly the stashed change and base->theirs is what the
   * branch did since. A path only one side changed takes that side, a path
   * both changed identically merges cleanly, and a path both changed
   * differently is a conflict.
   *
   * The merge is path-level only - it never merges the *contents* of a file.
   * A file edited both in the stash and on the branch conflicts here where
   * git would resolve non-overlapping edits.
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

      // Only one side changed the path relative to base - take that side. If
      // that side deleted the path, it is simply not carried into the merge.
      if (StashApplyCommand.entriesEqual(oursEntry, baseEntry)) {
        if (theirsEntry) {
          mergedEntries.set(path, theirsEntry);
        }
        continue;
      }
      if (StashApplyCommand.entriesEqual(theirsEntry, baseEntry)) {
        if (oursEntry) {
          mergedEntries.set(path, oursEntry);
        }
        continue;
      }

      // Both sides changed the path. Identical changes merge cleanly - and
      // that includes both sides deleting it, which leaves it deleted.
      if (StashApplyCommand.entriesEqual(oursEntry, theirsEntry)) {
        if (oursEntry) {
          mergedEntries.set(path, oursEntry);
        }
        continue;
      }

      // Conflict: both sides changed the path differently. Conflicts are only
      // collected here - a conflicting merge never builds a tree from
      // `mergedEntries` (see the early return below) and the caller halts the
      // apply, so there is no merged content to record for this path.
      conflicts.push(path);
    }

    if (conflicts.length > 0) {
      return { tree: theirs, conflicts };
    }

    // Build tree from merged entries (handles nested paths)
    const newTree = await this.buildTreeFromPaths(mergedEntries);
    return { tree: newTree };
  }
}
