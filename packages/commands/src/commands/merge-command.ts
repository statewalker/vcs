import type { Commit, ObjectId, TreeEntry } from "@webrun-vcs/vcs";
import { FileMode, isSymbolicRef, MergeStage } from "@webrun-vcs/vcs";

import { InvalidMergeHeadsError, NotFastForwardError } from "../errors/merge-errors.js";
import { NoHeadError } from "../errors/ref-errors.js";
import { GitCommand } from "../git-command.js";
import { FastForwardMode, type MergeResult, MergeStatus } from "../results/merge-result.js";

/**
 * Merge branches.
 *
 * Equivalent to `git merge`.
 *
 * Based on JGit's MergeCommand.
 *
 * @example
 * ```typescript
 * // Fast-forward merge
 * const result = await git.merge()
 *   .include("feature-branch")
 *   .call();
 *
 * // Force merge commit (no fast-forward)
 * const result = await git.merge()
 *   .include("feature-branch")
 *   .setFastForwardMode(FastForwardMode.NO_FF)
 *   .call();
 *
 * // Fail if fast-forward not possible
 * const result = await git.merge()
 *   .include("feature-branch")
 *   .setFastForwardMode(FastForwardMode.FF_ONLY)
 *   .call();
 * ```
 */
export class MergeCommand extends GitCommand<MergeResult> {
  private includes: string[] = [];
  private fastForwardMode = FastForwardMode.FF;
  private squash = false;
  private commit = true;
  private message?: string;

  /**
   * Add a commit/branch to merge.
   *
   * @param refOrId Commit ID, branch name, or tag name to merge
   */
  include(refOrId: string): this {
    this.checkCallable();
    this.includes.push(refOrId);
    return this;
  }

  /**
   * Set fast-forward mode.
   *
   * - FF (default): Fast-forward when possible
   * - NO_FF: Always create merge commit
   * - FF_ONLY: Abort if fast-forward not possible
   *
   * @param mode Fast-forward mode
   */
  setFastForwardMode(mode: FastForwardMode): this {
    this.checkCallable();
    this.fastForwardMode = mode;
    return this;
  }

  /**
   * Set squash mode.
   *
   * When true, changes are staged but not committed, and HEAD is not updated.
   *
   * @param squash Whether to squash
   */
  setSquash(squash: boolean): this {
    this.checkCallable();
    this.squash = squash;
    return this;
  }

  /**
   * Set whether to commit after merge.
   *
   * @param commit Whether to commit (default: true)
   */
  setCommit(commit: boolean): this {
    this.checkCallable();
    this.commit = commit;
    return this;
  }

  /**
   * Set the merge commit message.
   *
   * @param message Commit message
   */
  setMessage(message: string): this {
    this.checkCallable();
    this.message = message;
    return this;
  }

  /**
   * Execute the merge.
   *
   * @returns MergeResult with status and details
   */
  async call(): Promise<MergeResult> {
    this.checkCallable();
    this.setCallable(false);

    // Validate parameters
    if (this.includes.length === 0) {
      throw new InvalidMergeHeadsError("No merge head specified");
    }

    if (this.includes.length > 1) {
      throw new InvalidMergeHeadsError("Only single-head merges are currently supported");
    }

    // Get HEAD
    const head = await this.store.refs.get("HEAD");
    if (!head) {
      throw new NoHeadError("Cannot merge without HEAD");
    }

    const headId = await this.store.refs.resolve("HEAD");
    if (!headId?.objectId) {
      throw new NoHeadError("HEAD does not point to a commit");
    }

    // Resolve merge source
    const srcRef = this.includes[0];
    const srcId = await this.resolveRef(srcRef);

    // Check if already up to date (src is ancestor of HEAD)
    if (await this.isAncestor(srcId, headId.objectId)) {
      return {
        status: MergeStatus.ALREADY_UP_TO_DATE,
        newHead: headId.objectId,
        mergedCommits: [srcId],
      };
    }

    // Check if fast-forward is possible (HEAD is ancestor of src)
    const canFastForward = await this.isAncestor(headId.objectId, srcId);

    if (canFastForward && this.fastForwardMode !== FastForwardMode.NO_FF) {
      // Fast-forward merge
      return this.doFastForward(headId.objectId, srcId, head);
    }

    if (this.fastForwardMode === FastForwardMode.FF_ONLY) {
      // Cannot fast-forward and FF_ONLY was requested
      throw new NotFastForwardError();
    }

    // Need to do a real merge
    return this.doMerge(headId.objectId, srcId, head);
  }

  /**
   * Perform a fast-forward merge.
   */
  private async doFastForward(
    headId: ObjectId,
    srcId: ObjectId,
    head: Awaited<ReturnType<typeof this.store.refs.get>>,
  ): Promise<MergeResult> {
    if (!this.squash) {
      // Update HEAD/branch to point to source commit
      if (head && isSymbolicRef(head)) {
        await this.store.refs.set(head.target, srcId);
      } else {
        await this.store.refs.set("HEAD", srcId);
      }

      // Update staging to match new HEAD
      const srcCommit = await this.store.commits.loadCommit(srcId);
      await this.store.staging.readTree(this.store.trees, srcCommit.tree);
      await this.store.staging.write();

      return {
        status: MergeStatus.FAST_FORWARD,
        newHead: srcId,
        mergedCommits: [headId, srcId],
      };
    }

    // Squash: stage changes but don't update HEAD
    const srcCommit = await this.store.commits.loadCommit(srcId);
    await this.store.staging.readTree(this.store.trees, srcCommit.tree);
    await this.store.staging.write();

    return {
      status: MergeStatus.MERGED_SQUASHED,
      newHead: headId,
      mergedCommits: [headId, srcId],
      message: "Squashed commit of merged changes",
    };
  }

  /**
   * Perform a three-way merge.
   */
  private async doMerge(
    headId: ObjectId,
    srcId: ObjectId,
    head: Awaited<ReturnType<typeof this.store.refs.get>>,
  ): Promise<MergeResult> {
    // Find merge base
    const mergeBases = await this.store.commits.findMergeBase(headId, srcId);
    if (mergeBases.length === 0) {
      // No common ancestor - shouldn't happen with connected histories
      throw new Error("No merge base found");
    }

    const baseId = mergeBases[0]; // Use first merge base

    // Load commits and trees
    const headCommit = await this.store.commits.loadCommit(headId);
    const srcCommit = await this.store.commits.loadCommit(srcId);
    const baseCommit = await this.store.commits.loadCommit(baseId);

    // Perform tree-level merge
    const mergeResult = await this.mergeTreesThreeWay(
      baseCommit.tree,
      headCommit.tree,
      srcCommit.tree,
    );

    if (mergeResult.conflicts.length > 0) {
      // Has conflicts - write conflict state to staging
      await this.writeConflictStaging(
        baseCommit.tree,
        headCommit.tree,
        srcCommit.tree,
        mergeResult,
      );
      await this.store.staging.write();

      return {
        status: MergeStatus.CONFLICTING,
        mergeBase: baseId,
        mergedCommits: [headId, srcId],
        conflicts: mergeResult.conflicts,
      };
    }

    // No conflicts - write merged tree to staging
    await this.writeMergedStaging(mergeResult);
    await this.store.staging.write();

    if (!this.commit || this.squash) {
      // Don't commit
      const status = this.squash ? MergeStatus.MERGED_SQUASHED : MergeStatus.MERGED_NOT_COMMITTED;
      return {
        status,
        newHead: headId,
        mergeBase: baseId,
        mergedCommits: [headId, srcId],
      };
    }

    // Create merge commit
    const treeId = await this.store.staging.writeTree(this.store.trees);
    const mergeMessage = this.message ?? `Merge commit '${srcId.slice(0, 7)}'`;

    const now = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    const mergeCommit: Commit = {
      tree: treeId,
      parents: [headId, srcId],
      author: {
        name: "Author",
        email: "author@example.com",
        timestamp: now,
        tzOffset: "+0000",
      },
      committer: {
        name: "Committer",
        email: "committer@example.com",
        timestamp: now,
        tzOffset: "+0000",
      },
      message: mergeMessage,
    };

    const newCommitId = await this.store.commits.storeCommit(mergeCommit);

    // Update HEAD/branch
    if (head && isSymbolicRef(head)) {
      await this.store.refs.set(head.target, newCommitId);
    } else {
      await this.store.refs.set("HEAD", newCommitId);
    }

    return {
      status: MergeStatus.MERGED,
      newHead: newCommitId,
      mergeBase: baseId,
      mergedCommits: [headId, srcId],
    };
  }

  /**
   * Check if commitA is an ancestor of commitB.
   */
  private async isAncestor(commitA: ObjectId, commitB: ObjectId): Promise<boolean> {
    if (commitA === commitB) return true;

    // Walk ancestors of B looking for A
    const visited = new Set<ObjectId>();
    const queue: ObjectId[] = [commitB];

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;

      if (visited.has(current)) continue;
      visited.add(current);

      if (current === commitA) return true;

      try {
        const commit = await this.store.commits.loadCommit(current);
        for (const parent of commit.parents) {
          if (!visited.has(parent)) {
            queue.push(parent);
          }
        }
      } catch {
        // Commit not found - continue
      }
    }

    return false;
  }

  /**
   * Perform three-way tree merge.
   *
   * Returns merged entries and conflicts.
   */
  private async mergeTreesThreeWay(
    baseTreeId: ObjectId,
    oursTreeId: ObjectId,
    theirsTreeId: ObjectId,
  ): Promise<TreeMergeResult> {
    const result: TreeMergeResult = {
      merged: [],
      conflicts: [],
    };

    // Collect all paths from all three trees
    const allPaths = new Set<string>();
    const basePaths = new Map<string, TreeEntry>();
    const oursPaths = new Map<string, TreeEntry>();
    const theirsPaths = new Map<string, TreeEntry>();

    await this.collectTreeEntries(baseTreeId, "", basePaths, allPaths);
    await this.collectTreeEntries(oursTreeId, "", oursPaths, allPaths);
    await this.collectTreeEntries(theirsTreeId, "", theirsPaths, allPaths);

    // Process each unique path
    for (const path of allPaths) {
      const base = basePaths.get(path);
      const ours = oursPaths.get(path);
      const theirs = theirsPaths.get(path);

      const mergeEntry = this.mergeEntry(path, base, ours, theirs);

      if (mergeEntry.conflict) {
        result.conflicts.push(path);
        result.merged.push({
          path,
          base,
          ours,
          theirs,
        });
      } else if (mergeEntry.entry) {
        result.merged.push({
          path,
          entry: mergeEntry.entry,
        });
      }
      // If entry is undefined and no conflict, the file was deleted
    }

    return result;
  }

  /**
   * Collect all blob entries from a tree recursively.
   */
  private async collectTreeEntries(
    treeId: ObjectId,
    prefix: string,
    entries: Map<string, TreeEntry>,
    allPaths: Set<string>,
  ): Promise<void> {
    for await (const entry of this.store.trees.loadTree(treeId)) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.mode === FileMode.TREE) {
        // Recurse into subtree
        await this.collectTreeEntries(entry.id, path, entries, allPaths);
      } else {
        // Blob entry
        entries.set(path, entry);
        allPaths.add(path);
      }
    }
  }

  /**
   * Merge a single entry using three-way merge logic.
   */
  private mergeEntry(
    _path: string,
    base: TreeEntry | undefined,
    ours: TreeEntry | undefined,
    theirs: TreeEntry | undefined,
  ): { entry?: TreeEntry; conflict?: boolean } {
    // Case 1: All same (or all undefined)
    if (this.sameEntry(base, ours) && this.sameEntry(base, theirs)) {
      return { entry: ours };
    }

    // Case 2: Only we changed
    if (this.sameEntry(base, theirs)) {
      return { entry: ours };
    }

    // Case 3: Only they changed
    if (this.sameEntry(base, ours)) {
      return { entry: theirs };
    }

    // Case 4: Both changed - check if same change
    if (this.sameEntry(ours, theirs)) {
      return { entry: ours };
    }

    // Case 5: Both changed differently - conflict
    return { conflict: true };
  }

  /**
   * Check if two tree entries are the same.
   */
  private sameEntry(a: TreeEntry | undefined, b: TreeEntry | undefined): boolean {
    if (a === undefined && b === undefined) return true;
    if (a === undefined || b === undefined) return false;
    return a.id === b.id && a.mode === b.mode;
  }

  /**
   * Write conflict state to staging area.
   */
  private async writeConflictStaging(
    _baseTreeId: ObjectId,
    _oursTreeId: ObjectId,
    _theirsTreeId: ObjectId,
    mergeResult: TreeMergeResult,
  ): Promise<void> {
    const builder = this.store.staging.builder();

    // Add merged entries (stage 0)
    for (const item of mergeResult.merged) {
      if (item.entry) {
        builder.add({
          path: item.path,
          mode: item.entry.mode,
          objectId: item.entry.id,
          stage: MergeStage.MERGED,
        });
      } else if (item.base || item.ours || item.theirs) {
        // Conflict entry - add all stages
        if (item.base) {
          builder.add({
            path: item.path,
            mode: item.base.mode,
            objectId: item.base.id,
            stage: MergeStage.BASE,
          });
        }
        if (item.ours) {
          builder.add({
            path: item.path,
            mode: item.ours.mode,
            objectId: item.ours.id,
            stage: MergeStage.OURS,
          });
        }
        if (item.theirs) {
          builder.add({
            path: item.path,
            mode: item.theirs.mode,
            objectId: item.theirs.id,
            stage: MergeStage.THEIRS,
          });
        }
      }
    }

    await builder.finish();
  }

  /**
   * Write successfully merged entries to staging.
   */
  private async writeMergedStaging(mergeResult: TreeMergeResult): Promise<void> {
    const builder = this.store.staging.builder();

    for (const item of mergeResult.merged) {
      if (item.entry) {
        builder.add({
          path: item.path,
          mode: item.entry.mode,
          objectId: item.entry.id,
          stage: MergeStage.MERGED,
        });
      }
    }

    await builder.finish();
  }
}

/**
 * Result of tree-level merge.
 */
interface TreeMergeResult {
  /** Merged entries (both clean merges and conflicts) */
  merged: MergedEntry[];
  /** Paths with conflicts */
  conflicts: string[];
}

/**
 * A merged entry from three-way merge.
 */
interface MergedEntry {
  /** File path */
  path: string;
  /** Merged entry (for clean merges) */
  entry?: TreeEntry;
  /** Base entry (for conflicts) */
  base?: TreeEntry;
  /** Our entry (for conflicts) */
  ours?: TreeEntry;
  /** Their entry (for conflicts) */
  theirs?: TreeEntry;
}
