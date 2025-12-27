/**
 * File-based WorkingCopy implementation.
 *
 * Manages local checkout state for a Git working directory.
 */

import type { ObjectId } from "../id/index.js";
import type { Repository } from "../repository.js";
import type { StagingStore } from "../staging/index.js";
import type { RepositoryStatus, StatusOptions } from "../status/index.js";
import type {
  MergeState,
  RebaseState,
  StashStore,
  WorkingCopy,
  WorkingCopyConfig,
} from "../working-copy.js";
import type { WorkingTreeIterator } from "../worktree/index.js";

import { type MergeStateFilesApi, readMergeState } from "./merge-state-reader.js";
import { type RebaseStateFilesApi, readRebaseState } from "./rebase-state-reader.js";

/**
 * Files API subset needed for GitWorkingCopy
 */
export interface WorkingCopyFilesApi extends MergeStateFilesApi, RebaseStateFilesApi {}

/**
 * Git-compatible WorkingCopy implementation.
 *
 * Links a working directory to a Repository and manages local state
 * including HEAD, staging area, merge/rebase state, and stash.
 */
export class GitWorkingCopy implements WorkingCopy {
  constructor(
    readonly repository: Repository,
    readonly worktree: WorkingTreeIterator,
    readonly staging: StagingStore,
    readonly stash: StashStore,
    readonly config: WorkingCopyConfig,
    private readonly files: WorkingCopyFilesApi,
    private readonly gitDir: string,
  ) {}

  /**
   * Get current HEAD commit ID.
   */
  async getHead(): Promise<ObjectId | undefined> {
    const ref = await this.repository.refs.resolve("HEAD");
    return ref?.objectId;
  }

  /**
   * Get current branch name.
   * Returns undefined if HEAD is detached.
   */
  async getCurrentBranch(): Promise<string | undefined> {
    const headRef = await this.repository.refs.get("HEAD");
    if (headRef && "target" in headRef) {
      const target = headRef.target;
      if (target.startsWith("refs/heads/")) {
        return target.substring("refs/heads/".length);
      }
    }
    return undefined;
  }

  /**
   * Set HEAD to a branch or commit.
   *
   * If target starts with "refs/" or is not a valid SHA, it's treated as a branch.
   * Otherwise, it's treated as a commit ID (detached HEAD).
   */
  async setHead(target: ObjectId | string): Promise<void> {
    const isBranch = target.startsWith("refs/") || !target.match(/^[0-9a-f]{40,64}$/);

    if (isBranch) {
      // Symbolic reference to branch
      const ref = target.startsWith("refs/") ? target : `refs/heads/${target}`;
      await this.repository.refs.setSymbolic("HEAD", ref);
    } else {
      // Direct reference to commit (detached HEAD)
      await this.repository.refs.set("HEAD", target);
    }
  }

  /**
   * Check if HEAD is detached (pointing directly to commit, not branch).
   */
  async isDetachedHead(): Promise<boolean> {
    const headRef = await this.repository.refs.get("HEAD");
    return headRef !== undefined && !("target" in headRef);
  }

  /**
   * Get merge state if a merge is in progress.
   */
  async getMergeState(): Promise<MergeState | undefined> {
    return readMergeState(this.files, this.gitDir);
  }

  /**
   * Get rebase state if a rebase is in progress.
   */
  async getRebaseState(): Promise<RebaseState | undefined> {
    return readRebaseState(this.files, this.gitDir);
  }

  /**
   * Check if any operation is in progress (merge, rebase, cherry-pick, etc.).
   */
  async hasOperationInProgress(): Promise<boolean> {
    const [merge, rebase] = await Promise.all([this.getMergeState(), this.getRebaseState()]);
    return merge !== undefined || rebase !== undefined;
  }

  /**
   * Calculate full repository status.
   *
   * Compares HEAD, staging area, and working tree.
   */
  async getStatus(_options?: StatusOptions): Promise<RepositoryStatus> {
    // TODO: Integrate with StatusCalculator
    // For now, return a minimal status
    const head = await this.getHead();
    const branch = await this.getCurrentBranch();
    const hasConflicts = await this.staging.hasConflicts();

    return {
      branch,
      head,
      files: [],
      isClean: true,
      hasStaged: false,
      hasUnstaged: false,
      hasUntracked: false,
      hasConflicts,
    };
  }

  /**
   * Refresh working copy state from storage.
   */
  async refresh(): Promise<void> {
    await this.staging.read();
  }

  /**
   * Close working copy and release resources.
   */
  async close(): Promise<void> {
    // Release resources if needed
  }
}
