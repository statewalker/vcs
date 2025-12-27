/**
 * In-memory WorkingCopy implementation for testing.
 *
 * Provides a fast, isolated WorkingCopy without filesystem access.
 * Useful for unit tests that need to verify WorkingCopy-dependent code
 * without dealing with actual file operations.
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
import { MemoryStashStore } from "./stash-store.memory.js";

/**
 * In-memory WorkingCopy implementation.
 *
 * Stores HEAD, merge state, and rebase state in memory.
 * Provides test helpers for setting these states directly.
 */
export class MemoryWorkingCopy implements WorkingCopy {
  private headRef = "refs/heads/main";
  private headCommit: ObjectId | undefined;
  private _mergeState: MergeState | undefined;
  private _rebaseState: RebaseState | undefined;

  readonly stash: StashStore;
  readonly config: WorkingCopyConfig;

  constructor(
    readonly repository: Repository,
    readonly worktree: WorkingTreeIterator,
    readonly staging: StagingStore,
    stash?: StashStore,
    config?: WorkingCopyConfig,
  ) {
    this.stash = stash ?? new MemoryStashStore();
    this.config = config ?? {};
  }

  /**
   * Get current HEAD commit ID.
   * Falls back to resolving HEAD from repository refs if not set locally.
   */
  async getHead(): Promise<ObjectId | undefined> {
    if (this.headCommit) {
      return this.headCommit;
    }
    // Try to resolve from refs
    const resolved = await this.repository.refs.resolve(this.headRef);
    return resolved?.objectId;
  }

  /**
   * Get current branch name.
   * Returns undefined if HEAD is detached.
   */
  async getCurrentBranch(): Promise<string | undefined> {
    if (this.headCommit) {
      // Detached HEAD
      return undefined;
    }
    if (this.headRef.startsWith("refs/heads/")) {
      return this.headRef.substring("refs/heads/".length);
    }
    return undefined;
  }

  /**
   * Set HEAD to a branch or commit.
   */
  async setHead(target: ObjectId | string): Promise<void> {
    const isBranch = target.startsWith("refs/") || !target.match(/^[0-9a-f]{40,64}$/);

    if (isBranch) {
      const ref = target.startsWith("refs/") ? target : `refs/heads/${target}`;
      this.headRef = ref;
      this.headCommit = undefined;
    } else {
      this.headCommit = target;
    }
  }

  /**
   * Check if HEAD is detached.
   */
  async isDetachedHead(): Promise<boolean> {
    return this.headCommit !== undefined;
  }

  /**
   * Get merge state if a merge is in progress.
   */
  async getMergeState(): Promise<MergeState | undefined> {
    return this._mergeState;
  }

  /**
   * Get rebase state if a rebase is in progress.
   */
  async getRebaseState(): Promise<RebaseState | undefined> {
    return this._rebaseState;
  }

  /**
   * Check if any operation is in progress.
   */
  async hasOperationInProgress(): Promise<boolean> {
    return this._mergeState !== undefined || this._rebaseState !== undefined;
  }

  /**
   * Calculate repository status.
   * Returns a simplified status for testing.
   */
  async getStatus(_options?: StatusOptions): Promise<RepositoryStatus> {
    const hasConflicts = await this.staging.hasConflicts();

    return {
      branch: await this.getCurrentBranch(),
      head: await this.getHead(),
      files: [],
      isClean: true,
      hasStaged: false,
      hasUnstaged: false,
      hasUntracked: false,
      hasConflicts,
    };
  }

  /**
   * Refresh working copy state.
   */
  async refresh(): Promise<void> {
    await this.staging.read();
  }

  /**
   * Close working copy.
   * No-op for memory implementation.
   */
  async close(): Promise<void> {
    // No resources to release
  }

  // ============ Test Helpers ============

  /**
   * Set merge state directly (for testing).
   */
  setMergeState(state: MergeState | undefined): void {
    this._mergeState = state;
  }

  /**
   * Set rebase state directly (for testing).
   */
  setRebaseState(state: RebaseState | undefined): void {
    this._rebaseState = state;
  }

  /**
   * Set HEAD reference directly (for testing).
   */
  setHeadRef(ref: string): void {
    this.headRef = ref;
    this.headCommit = undefined;
  }

  /**
   * Set HEAD commit directly (for testing detached HEAD).
   */
  setHeadCommit(commitId: ObjectId): void {
    this.headCommit = commitId;
  }
}

/**
 * Create a MemoryWorkingCopy instance.
 */
export function createMemoryWorkingCopy(
  repository: Repository,
  worktree: WorkingTreeIterator,
  staging: StagingStore,
  stash?: StashStore,
  config?: WorkingCopyConfig,
): MemoryWorkingCopy {
  return new MemoryWorkingCopy(repository, worktree, staging, stash, config);
}
