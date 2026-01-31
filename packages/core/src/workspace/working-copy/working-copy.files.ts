/**
 * File-based WorkingCopy implementation.
 *
 * Manages local checkout state for a Git working directory.
 *
 * This implementation delegates to the new Three-Part Architecture:
 * - History: Immutable repository objects
 * - Checkout: Mutable local state (HEAD, staging, operations)
 * - Worktree: Filesystem access
 */

import type { ObjectId } from "../../common/id/index.js";
import type { History } from "../../history/history.js";
import type { HistoryStore } from "../../history/history-store.js";
import type { Checkout } from "../checkout/checkout.js";
import type { Staging, StagingStore } from "../staging/index.js";
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
import type { Worktree, WorktreeStore } from "../worktree/index.js";

import type { CherryPickStateFilesApi } from "./cherry-pick-state-reader.js";
import type { MergeStateFilesApi } from "./merge-state-reader.js";
import type { RebaseStateFilesApi } from "./rebase-state-reader.js";
import {
  getStateCapabilities,
  type RepositoryStateValue,
  type StateCapabilities,
} from "./repository-state.js";
import { detectRepositoryState, type StateDetectorFilesApi } from "./repository-state-detector.js";
import type { RevertStateFilesApi } from "./revert-state-reader.js";

/**
 * Files API subset needed for GitWorkingCopy state detection
 */
export interface WorkingCopyFilesApi
  extends StateDetectorFilesApi,
    MergeStateFilesApi,
    RebaseStateFilesApi,
    CherryPickStateFilesApi,
    RevertStateFilesApi {}

/**
 * Options for creating a GitWorkingCopy (new architecture)
 */
export interface GitWorkingCopyOptions {
  /** History interface (new architecture) */
  history: History;
  /** Checkout interface (new architecture) */
  checkout: Checkout;
  /** Worktree interface (new architecture) */
  worktreeInterface: Worktree;
  /** Legacy HistoryStore (for backward compatibility) */
  repository: HistoryStore;
  /** Legacy WorktreeStore (for backward compatibility) */
  worktree: WorktreeStore;
  /** Stash store */
  stash: StashStore;
  /** Configuration */
  config: WorkingCopyConfig;
  /** Files API for state detection */
  files: WorkingCopyFilesApi;
  /** Git directory path */
  gitDir: string;
}

/**
 * Git-compatible WorkingCopy implementation.
 *
 * Supports two construction modes:
 * 1. New architecture: Pass GitWorkingCopyOptions with History, Checkout, Worktree
 * 2. Legacy: Pass positional arguments (deprecated, for backward compatibility)
 *
 * When using legacy mode, delegates to legacy stores directly.
 * When using new architecture mode, delegates to new interfaces.
 */
export class GitWorkingCopy implements WorkingCopy {
  // New architecture components (optional during migration)
  readonly history?: History;
  readonly checkout?: Checkout;
  readonly worktreeInterface?: Worktree;

  // Legacy properties (for backward compatibility)
  readonly repository: HistoryStore;
  readonly worktree: WorktreeStore;
  readonly stash: StashStore;
  readonly config: WorkingCopyConfig;

  // Internal state for legacy mode
  private _staging?: StagingStore;
  private readonly files: WorkingCopyFilesApi;
  private readonly gitDir: string;
  private readonly useLegacyMode: boolean;

  /** New architecture constructor */
  constructor(options: GitWorkingCopyOptions);
  /** @deprecated Legacy constructor - use options object instead */
  constructor(
    repository: HistoryStore,
    worktree: WorktreeStore,
    staging: StagingStore,
    stash: StashStore,
    config: WorkingCopyConfig,
    files: WorkingCopyFilesApi,
    gitDir: string,
  );
  constructor(
    repositoryOrOptions: HistoryStore | GitWorkingCopyOptions,
    worktree?: WorktreeStore,
    staging?: StagingStore,
    stash?: StashStore,
    config?: WorkingCopyConfig,
    files?: WorkingCopyFilesApi,
    gitDir?: string,
  ) {
    if (typeof repositoryOrOptions === "object" && "history" in repositoryOrOptions) {
      // New architecture options form
      const options = repositoryOrOptions;
      this.history = options.history;
      this.checkout = options.checkout;
      this.worktreeInterface = options.worktreeInterface;
      this.repository = options.repository;
      this.worktree = options.worktree;
      this.stash = options.stash;
      this.config = options.config;
      this.files = options.files;
      this.gitDir = options.gitDir;
      this.useLegacyMode = false;
    } else {
      // Legacy positional arguments form
      this.repository = repositoryOrOptions;
      this.worktree = worktree as WorktreeStore;
      this._staging = staging;
      this.stash = stash as StashStore;
      this.config = config as WorkingCopyConfig;
      this.files = files as WorkingCopyFilesApi;
      this.gitDir = gitDir as string;
      this.useLegacyMode = true;
    }
  }

  /**
   * Staging area - delegates to checkout or legacy staging
   */
  get staging(): Staging | StagingStore {
    if (this.checkout) {
      return this.checkout.staging;
    }
    return this._staging as StagingStore;
  }

  /**
   * Get current HEAD commit ID.
   */
  async getHead(): Promise<ObjectId | undefined> {
    if (!this.useLegacyMode && this.checkout) {
      return this.checkout.getHeadCommit();
    }
    // Legacy mode
    const ref = await this.repository.refs.resolve("HEAD");
    return ref?.objectId;
  }

  /**
   * Get current branch name.
   * Returns undefined if HEAD is detached.
   */
  async getCurrentBranch(): Promise<string | undefined> {
    if (!this.useLegacyMode && this.checkout) {
      return this.checkout.getCurrentBranch();
    }
    // Legacy mode
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
   */
  async setHead(target: ObjectId | string): Promise<void> {
    const isBranch = target.startsWith("refs/") || !target.match(/^[0-9a-f]{40,64}$/);

    if (!this.useLegacyMode && this.checkout) {
      if (isBranch) {
        const ref = target.startsWith("refs/") ? target : `refs/heads/${target}`;
        await this.checkout.setHead({ type: "symbolic", target: ref });
      } else {
        await this.checkout.setHead({ type: "detached", commitId: target });
      }
    } else {
      // Legacy mode
      if (isBranch) {
        const ref = target.startsWith("refs/") ? target : `refs/heads/${target}`;
        await this.repository.refs.setSymbolic("HEAD", ref);
      } else {
        await this.repository.refs.set("HEAD", target);
      }
    }
  }

  /**
   * Check if HEAD is detached (pointing directly to commit, not branch).
   */
  async isDetachedHead(): Promise<boolean> {
    if (!this.useLegacyMode && this.checkout) {
      return this.checkout.isDetached();
    }
    // Legacy mode
    const headRef = await this.repository.refs.get("HEAD");
    return headRef !== undefined && !("target" in headRef);
  }

  /**
   * Get merge state if a merge is in progress.
   */
  async getMergeState(): Promise<MergeState | undefined> {
    if (!this.useLegacyMode && this.checkout) {
      const state = await this.checkout.getMergeState();
      if (!state) return undefined;
      return {
        mergeHead: state.mergeHead,
        origHead: state.originalHead ?? state.mergeHead,
        message: state.message,
        squash: state.squash,
      };
    }
    // Legacy mode - read from files
    return this.readMergeStateFromFiles();
  }

  /**
   * Get rebase state if a rebase is in progress.
   */
  async getRebaseState(): Promise<RebaseState | undefined> {
    if (!this.useLegacyMode && this.checkout) {
      const state = await this.checkout.getRebaseState();
      if (!state) return undefined;
      return {
        type: state.type === "merge" ? "rebase-merge" : "rebase-apply",
        onto: state.onto,
        head: state.originalHead,
        current: state.currentIndex,
        total: state.totalCommits,
      };
    }
    // Legacy mode - read from files
    return this.readRebaseStateFromFiles();
  }

  /**
   * Get cherry-pick state if a cherry-pick is in progress.
   */
  async getCherryPickState(): Promise<CherryPickState | undefined> {
    if (!this.useLegacyMode && this.checkout) {
      const state = await this.checkout.getCherryPickState();
      if (!state) return undefined;
      return {
        cherryPickHead: state.commits[state.currentIndex] ?? state.originalHead,
      };
    }
    // Legacy mode - read from files
    return this.readCherryPickStateFromFiles();
  }

  /**
   * Get revert state if a revert is in progress.
   */
  async getRevertState(): Promise<RevertState | undefined> {
    if (!this.useLegacyMode && this.checkout) {
      const state = await this.checkout.getRevertState();
      if (!state) return undefined;
      return {
        revertHead: state.commits[state.currentIndex] ?? state.originalHead,
      };
    }
    // Legacy mode - read from files
    return this.readRevertStateFromFiles();
  }

  /**
   * Check if any operation is in progress (merge, rebase, cherry-pick, etc.).
   */
  async hasOperationInProgress(): Promise<boolean> {
    if (!this.useLegacyMode && this.checkout) {
      return this.checkout.hasOperationInProgress();
    }
    // Legacy mode
    const [merge, rebase, cherryPick, revert] = await Promise.all([
      this.getMergeState(),
      this.getRebaseState(),
      this.getCherryPickState(),
      this.getRevertState(),
    ]);
    return merge !== undefined || rebase !== undefined || cherryPick !== undefined || revert !== undefined;
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
      staging: this.staging as StagingStore,
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
    if (!this.useLegacyMode && this.checkout) {
      await this.checkout.refresh();
    } else {
      await this.staging.read();
    }
  }

  /**
   * Close working copy and release resources.
   */
  async close(): Promise<void> {
    if (!this.useLegacyMode && this.checkout && this.history) {
      await this.checkout.close();
      await this.history.close();
    }
    // Legacy mode: no resources to release
  }

  // ========== Legacy Mode Helpers ==========

  private async readMergeStateFromFiles(): Promise<MergeState | undefined> {
    const { readMergeState } = await import("./merge-state-reader.js");
    return readMergeState(this.files, this.gitDir);
  }

  private async readRebaseStateFromFiles(): Promise<RebaseState | undefined> {
    const { readRebaseState } = await import("./rebase-state-reader.js");
    return readRebaseState(this.files, this.gitDir);
  }

  private async readCherryPickStateFromFiles(): Promise<CherryPickState | undefined> {
    const { readCherryPickState } = await import("./cherry-pick-state-reader.js");
    return readCherryPickState(this.files, this.gitDir);
  }

  private async readRevertStateFromFiles(): Promise<RevertState | undefined> {
    const { readRevertState } = await import("./revert-state-reader.js");
    return readRevertState(this.files, this.gitDir);
  }
}
