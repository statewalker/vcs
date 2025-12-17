import type { Commit, ObjectId } from "@webrun-vcs/vcs";

import { GitCommand } from "../git-command.js";

/**
 * Show commit history.
 *
 * Equivalent to `git log`.
 *
 * Based on JGit's LogCommand.
 *
 * @example
 * ```typescript
 * // Get all commits from HEAD
 * for await (const commit of await git.log().call()) {
 *   console.log(commit.message);
 * }
 *
 * // Get commits from a specific ref
 * const commits = await git.log().add(commitId).call();
 *
 * // Limit number of commits
 * const recent = await git.log().setMaxCount(10).call();
 *
 * // Skip first N commits
 * const older = await git.log().setSkip(10).setMaxCount(10).call();
 * ```
 */
export class LogCommand extends GitCommand<AsyncIterable<Commit>> {
  private startCommits: ObjectId[] = [];
  private paths: string[] = [];
  private maxCount?: number;
  private skip = 0;
  private includeAll = false;
  private firstParentOnly = false;

  /**
   * Add a starting commit for the log.
   *
   * Multiple start commits can be added - the log will include
   * ancestors of all of them.
   *
   * @param commit ObjectId of commit to start from
   */
  add(commit: ObjectId): this {
    this.checkCallable();
    this.startCommits.push(commit);
    return this;
  }

  /**
   * Filter commits to only those affecting the given path.
   *
   * @param path Repository-relative path to filter by
   */
  addPath(path: string): this {
    this.checkCallable();
    this.paths.push(path);
    return this;
  }

  /**
   * Limit the number of commits returned.
   *
   * @param maxCount Maximum number of commits to return
   */
  setMaxCount(maxCount: number): this {
    this.checkCallable();
    this.maxCount = maxCount;
    return this;
  }

  /**
   * Skip the first N commits.
   *
   * @param skip Number of commits to skip
   */
  setSkip(skip: number): this {
    this.checkCallable();
    this.skip = skip;
    return this;
  }

  /**
   * Include commits from all refs.
   *
   * When set, starts from all refs instead of just HEAD.
   */
  all(): this {
    this.checkCallable();
    this.includeAll = true;
    return this;
  }

  /**
   * Follow only the first parent on merges.
   *
   * Useful for seeing the linear history of a branch.
   */
  setFirstParent(firstParent: boolean): this {
    this.checkCallable();
    this.firstParentOnly = firstParent;
    return this;
  }

  /**
   * Execute the log command.
   *
   * @returns AsyncIterable of commits in reverse chronological order
   */
  async call(): Promise<AsyncIterable<Commit>> {
    this.checkCallable();
    this.setCallable(false);

    // Determine starting commits
    let starts: ObjectId[];
    if (this.startCommits.length > 0) {
      starts = this.startCommits;
    } else if (this.includeAll) {
      starts = await this.getAllRefs();
    } else {
      const headId = await this.resolveHead();
      starts = [headId];
    }

    return this.walkCommits(starts);
  }

  /**
   * Get all commit IDs from all refs.
   */
  private async getAllRefs(): Promise<ObjectId[]> {
    const ids: ObjectId[] = [];
    for await (const ref of this.store.refs.list()) {
      if ("objectId" in ref && ref.objectId) {
        ids.push(ref.objectId);
      }
    }
    return ids;
  }

  /**
   * Walk commits and yield them.
   */
  private async *walkCommits(starts: ObjectId[]): AsyncIterable<Commit> {
    let count = 0;
    let skipped = 0;

    for await (const commitId of this.store.commits.walkAncestry(starts, {
      firstParentOnly: this.firstParentOnly,
    })) {
      // Skip first N commits
      if (skipped < this.skip) {
        skipped++;
        continue;
      }

      // Check max count
      if (this.maxCount !== undefined && count >= this.maxCount) {
        break;
      }

      const commit = await this.store.commits.loadCommit(commitId);

      // Path filtering
      if (this.paths.length > 0 && !(await this.affectsPath(commit, commitId))) {
        continue;
      }

      count++;
      yield commit;
    }
  }

  /**
   * Check if a commit affects any of the filtered paths.
   */
  private async affectsPath(commit: Commit, _commitId: ObjectId): Promise<boolean> {
    // If no parents, this is the initial commit - include if tree has the path
    if (commit.parents.length === 0) {
      return this.treeHasPath(commit.tree);
    }

    // Compare with first parent's tree
    const parentCommit = await this.store.commits.loadCommit(commit.parents[0]);
    const parentTree = parentCommit.tree;

    // Check if any path differs between trees
    for (const path of this.paths) {
      const entryInCurrent = await this.getTreeEntryForPath(commit.tree, path);
      const entryInParent = await this.getTreeEntryForPath(parentTree, path);

      // Different if one exists and other doesn't, or if object IDs differ
      const currentId = entryInCurrent?.objectId;
      const parentId = entryInParent?.objectId;

      if (currentId !== parentId) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if tree contains any of the filtered paths.
   */
  private async treeHasPath(treeId: ObjectId): Promise<boolean> {
    for (const path of this.paths) {
      const entry = await this.getTreeEntryForPath(treeId, path);
      if (entry) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get tree entry for a path (supports nested paths).
   */
  private async getTreeEntryForPath(
    treeId: ObjectId,
    path: string,
  ): Promise<{ objectId: ObjectId; mode: number } | undefined> {
    const parts = path.split("/").filter((p) => p.length > 0);
    let currentTreeId = treeId;

    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isLast = i === parts.length - 1;

      const entry = await this.store.trees.getEntry(currentTreeId, name);

      if (!entry) {
        return undefined;
      }

      if (isLast) {
        return { objectId: entry.id, mode: entry.mode };
      }

      // Navigate into subtree
      currentTreeId = entry.id;
    }

    return undefined;
  }
}
