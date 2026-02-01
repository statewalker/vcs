import type { ObjectId, Ref } from "@statewalker/vcs-core";
import { isSymbolicRef } from "@statewalker/vcs-core";

import { RefNotFoundError } from "../errors/ref-errors.js";
import { GitCommand } from "../git-command.js";
import { ResetMode } from "../types.js";

/**
 * Reset HEAD to a specified state.
 *
 * Equivalent to `git reset`.
 *
 * Based on JGit's ResetCommand.
 *
 * @example
 * ```typescript
 * // Soft reset - move HEAD only
 * await git.reset()
 *   .setRef("HEAD~1")
 *   .setMode(ResetMode.SOFT)
 *   .call();
 *
 * // Mixed reset (default) - move HEAD and reset staging
 * await git.reset()
 *   .setRef("abc123")
 *   .call();
 *
 * // Hard reset - move HEAD, reset staging, and reset working tree
 * await git.reset()
 *   .setRef("HEAD~1")
 *   .setMode(ResetMode.HARD)
 *   .call();
 *
 * // Reset specific paths
 * await git.reset()
 *   .addPath("src/file.ts")
 *   .call();
 * ```
 */
export class ResetCommand extends GitCommand<Ref> {
  private ref?: string;
  private mode = ResetMode.MIXED;
  private paths: string[] = [];

  /**
   * Set the ref to reset to.
   *
   * Can be a commit ID, branch name, tag name, or relative ref like HEAD~1.
   * If not set, defaults to HEAD.
   *
   * @param ref Commit-ish to reset to
   */
  setRef(ref: string): this {
    this.checkCallable();
    this.ref = ref;
    return this;
  }

  /**
   * Set the reset mode.
   *
   * - SOFT: Move HEAD only
   * - MIXED (default): Move HEAD and reset staging
   * - HARD: Move HEAD, reset staging, and reset working tree
   *
   * @param mode Reset mode
   */
  setMode(mode: ResetMode): this {
    this.checkCallable();
    this.mode = mode;
    return this;
  }

  /**
   * Add a path to reset.
   *
   * When paths are specified, only those paths are reset in the staging area.
   * The ref must be HEAD when using paths.
   *
   * @param path Repository-relative path
   */
  addPath(path: string): this {
    this.checkCallable();
    this.paths.push(path);
    return this;
  }

  /**
   * Execute the reset.
   *
   * @returns The ref that HEAD now points to
   * @throws RefNotFoundError if ref cannot be resolved
   */
  async call(): Promise<Ref> {
    this.checkCallable();
    this.setCallable(false);

    // If paths are specified, do path reset
    if (this.paths.length > 0) {
      return this.resetPaths();
    }

    // Resolve target commit
    const targetRef = this.ref ?? "HEAD";
    const targetId = await this.resolveRef(targetRef);

    // Move HEAD/branch
    await this.moveHead(targetId);

    // Reset staging area (for MIXED and HARD)
    if (this.mode === ResetMode.MIXED || this.mode === ResetMode.HARD) {
      await this.resetStaging(targetId);
    }

    // Reset working tree (for HARD)
    // Note: Working tree reset is not implemented yet
    // as it requires WorkingCopy with worktree access
    if (this.mode === ResetMode.HARD) {
      // Would reset working tree here
      // For now, just reset staging
    }

    // Return the updated HEAD ref
    const headRef = await this.refsStore.resolve("HEAD");
    return headRef as Ref;
  }

  /**
   * Reset specific paths in staging area.
   */
  private async resetPaths(): Promise<Ref> {
    // For path reset, we reset the staging entries to match the ref
    const targetRef = this.ref ?? "HEAD";
    const targetId = await this.resolveRef(targetRef);

    // Load target commit's tree
    const targetCommit = await this.commits.load(targetId);
    if (!targetCommit) {
      throw new RefNotFoundError(targetId, "Target commit not found");
    }
    const treeId = targetCommit.tree;

    // Reset each path in staging
    const editor = this.staging.createEditor();

    for (const path of this.paths) {
      const entry = await this.getTreeEntryForPath(treeId, path);
      if (entry) {
        // Path exists in target - update staging to match
        editor.add({
          path,
          apply: () => ({
            path,
            mode: entry.mode,
            objectId: entry.objectId,
            stage: 0,
            size: 0,
            mtime: Date.now(),
          }),
        });
      } else {
        // Path doesn't exist in target - remove from staging
        editor.add({
          path,
          apply: () => undefined,
        });
      }
    }

    await editor.finish();
    await this.staging.write();

    const headRef = await this.refsStore.resolve("HEAD");
    return headRef as Ref;
  }

  /**
   * Move HEAD (and branch if applicable) to target commit.
   */
  private async moveHead(targetId: ObjectId): Promise<void> {
    const head = await this.refsStore.get("HEAD");

    if (head && isSymbolicRef(head)) {
      // HEAD points to a branch - update the branch
      await this.refsStore.set(head.target, targetId);
    } else {
      // Detached HEAD - update HEAD directly
      await this.refsStore.set("HEAD", targetId);
    }
  }

  /**
   * Reset staging area to match a tree.
   */
  private async resetStaging(commitId: ObjectId): Promise<void> {
    const commit = await this.commits.load(commitId);
    if (commit) {
      await this.staging.readTree(this.trees, commit.tree);
      await this.staging.write();
    }
  }

  /**
   * Get tree entry for a path.
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

      const entry = await this.trees.getEntry(currentTreeId, name);

      if (!entry) {
        return undefined;
      }

      if (isLast) {
        return { objectId: entry.id, mode: entry.mode };
      }

      currentTreeId = entry.id;
    }

    return undefined;
  }
}
