/**
 * File-based WorkingCopy implementation.
 *
 * Manages local checkout state for a Git working directory.
 */

import type { ObjectId } from "../common/id/index.js";
import type { HistoryStore } from "../history/history-store.js";
import type { StagingStore } from "../staging/index.js";
import {
  createStatusCalculator,
  type RepositoryStatus,
  type StatusOptions,
} from "../status/index.js";
import type {
  CherryPickState,
  MergeState,
  RebaseState,
  RevertState,
  StashStore,
  WorkingCopy,
  WorkingCopyConfig,
} from "../working-copy.js";
import type { WorktreeStore } from "../worktree/index.js";

import { type CherryPickStateFilesApi, readCherryPickState } from "./cherry-pick-state-reader.js";
import { type MergeStateFilesApi, readMergeState } from "./merge-state-reader.js";
import { type RebaseStateFilesApi, readRebaseState } from "./rebase-state-reader.js";
import {
  getStateCapabilities,
  type RepositoryStateValue,
  type StateCapabilities,
} from "./repository-state.js";
import { detectRepositoryState, type StateDetectorFilesApi } from "./repository-state-detector.js";
import { type RevertStateFilesApi, readRevertState } from "./revert-state-reader.js";

/**
 * Files API subset needed for GitWorkingCopy
 */
export interface WorkingCopyFilesApi
  extends MergeStateFilesApi,
    RebaseStateFilesApi,
    CherryPickStateFilesApi,
    RevertStateFilesApi,
    StateDetectorFilesApi {}

/**
 * Git-compatible WorkingCopy implementation.
 *
 * Links a working directory to a HistoryStore and manages local state
 * including HEAD, staging area, merge/rebase state, and stash.
 */
export class GitWorkingCopy implements WorkingCopy {
  constructor(
    readonly repository: HistoryStore,
    readonly worktree: WorktreeStore,
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
   * Get cherry-pick state if a cherry-pick is in progress.
   */
  async getCherryPickState(): Promise<CherryPickState | undefined> {
    return readCherryPickState(this.files, this.gitDir);
  }

  /**
   * Get revert state if a revert is in progress.
   */
  async getRevertState(): Promise<RevertState | undefined> {
    return readRevertState(this.files, this.gitDir);
  }

  /**
   * Check if any operation is in progress (merge, rebase, cherry-pick, etc.).
   */
  async hasOperationInProgress(): Promise<boolean> {
    const [merge, rebase, cherryPick, revert] = await Promise.all([
      this.getMergeState(),
      this.getRebaseState(),
      this.getCherryPickState(),
      this.getRevertState(),
    ]);
    return (
      merge !== undefined ||
      rebase !== undefined ||
      cherryPick !== undefined ||
      revert !== undefined
    );
  }

  /**
   * Get current repository state.
   *
   * Detects in-progress operations like merge, rebase, cherry-pick, etc.
   */
  async getState(): Promise<RepositoryStateValue> {
    const hasConflicts = await this.staging.hasConflicts();
    return detectRepositoryState(this.files, this.gitDir, hasConflicts);
  }

  /**
   * Get capability queries for current state.
   *
   * Determines what operations are allowed in the current state.
   */
  async getStateCapabilities(): Promise<StateCapabilities> {
    const state = await this.getState();
    return getStateCapabilities(state);
  }

  /**
   * Calculate full repository status.
   *
   * Compares HEAD, staging area, and working tree.
   */
  async getStatus(options?: StatusOptions): Promise<RepositoryStatus> {
    const calculator = createStatusCalculator({
      worktree: this.worktree,
      staging: this.staging,
      trees: this.repository.trees,
      commits: this.repository.commits,
      refs: this.repository.refs,
      blobs: this.repository.blobs,
    });

    return calculator.calculateStatus(options);
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
