/**
 * WorkingCopy interface - local checkout state
 *
 * A WorkingCopy links a working directory to a Repository.
 * It manages all local state: HEAD, staging area, merge state.
 * Multiple WorkingCopies can share a single Repository.
 *
 * Corresponds to Fossil's "checkout database" concept.
 *
 * @see Repository for shared history storage
 */

import type { ObjectId } from "./id/index.js";
import type { Repository } from "./repository.js";
import type { StagingStore } from "./staging/index.js";
import type { RepositoryStatus, StatusOptions } from "./status/index.js";
import type { RepositoryStateValue, StateCapabilities } from "./working-copy/repository-state.js";
import type { WorkingTreeIterator } from "./worktree/index.js";

/**
 * Working copy configuration
 *
 * Local configuration that may override repository-level settings.
 */
export interface WorkingCopyConfig {
  /** Custom configuration options */
  [key: string]: unknown;
}

/**
 * Stash operations interface
 *
 * Accessed via WorkingCopy, but storage is backend-dependent:
 * - Git file-based: stores in central refs/stash
 * - Other backends: may use per-working-copy storage
 *
 * @example Push, list, and pop
 * ```typescript
 * // Save current work
 * const id = await stash.push("WIP: fixing bug");
 *
 * // List all stashes
 * for await (const entry of stash.list()) {
 *   console.log(`stash@{${entry.index}}: ${entry.message}`);
 * }
 *
 * // Restore and remove
 * await stash.pop();
 * ```
 */
export interface StashStore {
  /** List all stash entries */
  list(): AsyncIterable<StashEntry>;
  /** Push current changes to stash */
  push(message?: string): Promise<ObjectId>;
  /** Pop most recent stash entry */
  pop(): Promise<void>;
  /** Apply stash entry without removing it */
  apply(index?: number): Promise<void>;
  /** Drop a stash entry */
  drop(index?: number): Promise<void>;
  /** Clear all stash entries */
  clear(): Promise<void>;
}

/**
 * A single stash entry
 */
export interface StashEntry {
  /** Stash index (0 = most recent) */
  readonly index: number;
  /** Commit ID of stashed state */
  readonly commitId: ObjectId;
  /** Stash message */
  readonly message: string;
  /** When the stash was created */
  readonly timestamp: number;
}

/**
 * Merge state when a merge is in progress
 */
export interface MergeState {
  /** Commit being merged into current branch */
  readonly mergeHead: ObjectId;
  /** Original HEAD before merge started */
  readonly origHead: ObjectId;
  /** Merge message (from MERGE_MSG) */
  readonly message?: string;
  /** Whether this is a squash merge */
  readonly squash?: boolean;
}

/**
 * Rebase state when a rebase is in progress
 */
export interface RebaseState {
  /** Type of rebase operation */
  readonly type: "rebase" | "rebase-merge" | "rebase-apply";
  /** Branch being rebased onto */
  readonly onto: ObjectId;
  /** Original branch being rebased */
  readonly head: ObjectId;
  /** Current step number */
  readonly current: number;
  /** Total number of steps */
  readonly total: number;
}

/**
 * Cherry-pick state when a cherry-pick is in progress
 */
export interface CherryPickState {
  /** Commit being cherry-picked */
  readonly cherryPickHead: ObjectId;
  /** Commit message (from MERGE_MSG) */
  readonly message?: string;
}

/**
 * Revert state when a revert is in progress
 */
export interface RevertState {
  /** Commit being reverted */
  readonly revertHead: ObjectId;
  /** Revert message (from MERGE_MSG) */
  readonly message?: string;
}

/**
 * WorkingCopy - a checked-out working directory
 *
 * Links to a Repository and adds local state.
 * Multiple WorkingCopies can share one Repository.
 *
 * @example Checking branch and status
 * ```typescript
 * const branch = await wc.getCurrentBranch();
 * console.log(`On branch: ${branch ?? "detached HEAD"}`);
 *
 * const status = await wc.getStatus();
 * if (!status.isClean) {
 *   console.log("Uncommitted changes:", status.files.length);
 * }
 * ```
 *
 * @example Detecting in-progress operations
 * ```typescript
 * if (await wc.hasOperationInProgress()) {
 *   const merge = await wc.getMergeState();
 *   if (merge) console.log(`Merging: ${merge.mergeHead}`);
 *
 *   const rebase = await wc.getRebaseState();
 *   if (rebase) console.log(`Rebasing: ${rebase.current}/${rebase.total}`);
 * }
 * ```
 *
 * @example Working with stash
 * ```typescript
 * await wc.stash.push("WIP: feature work");
 * for await (const entry of wc.stash.list()) {
 *   console.log(`stash@{${entry.index}}: ${entry.message}`);
 * }
 * await wc.stash.pop();
 * ```
 */
export interface WorkingCopy {
  // ============ Links ============

  /** The repository this working copy is linked to */
  readonly repository: Repository;

  /** Working tree filesystem access */
  readonly worktree: WorkingTreeIterator;

  /** Staging area (the index) */
  readonly staging: StagingStore;

  /** Stash operations (storage is backend-dependent) */
  readonly stash: StashStore;

  /** Working copy local configuration */
  readonly config: WorkingCopyConfig;

  // ============ HEAD Management ============

  /**
   * Get current HEAD commit ID
   *
   * @returns Commit ID or undefined if no commits yet
   */
  getHead(): Promise<ObjectId | undefined>;

  /**
   * Get current branch name
   *
   * @returns Branch name or undefined if detached HEAD
   */
  getCurrentBranch(): Promise<string | undefined>;

  /**
   * Set HEAD to a branch or commit
   *
   * @param target Branch name (refs/heads/...) or commit ID for detached HEAD
   */
  setHead(target: ObjectId | string): Promise<void>;

  /**
   * Check if HEAD is detached (pointing directly to commit, not branch)
   */
  isDetachedHead(): Promise<boolean>;

  // ============ In-Progress Operations ============

  /**
   * Get merge state if a merge is in progress
   */
  getMergeState(): Promise<MergeState | undefined>;

  /**
   * Get rebase state if a rebase is in progress
   */
  getRebaseState(): Promise<RebaseState | undefined>;

  /**
   * Get cherry-pick state if a cherry-pick is in progress
   */
  getCherryPickState(): Promise<CherryPickState | undefined>;

  /**
   * Get revert state if a revert is in progress
   */
  getRevertState(): Promise<RevertState | undefined>;

  /**
   * Check if any operation is in progress (merge, rebase, cherry-pick, etc.)
   */
  hasOperationInProgress(): Promise<boolean>;

  /**
   * Get current repository state.
   *
   * Detects in-progress operations like merge, rebase, cherry-pick, etc.
   */
  getState(): Promise<RepositoryStateValue>;

  /**
   * Get capability queries for current state.
   *
   * Determines what operations are allowed in the current state.
   */
  getStateCapabilities(): Promise<StateCapabilities>;

  // ============ Status ============

  /**
   * Calculate full repository status
   *
   * Compares HEAD, staging area, and working tree.
   */
  getStatus(options?: StatusOptions): Promise<RepositoryStatus>;

  // ============ Lifecycle ============

  /**
   * Refresh working copy state from storage
   *
   * Call after external changes to the repository.
   */
  refresh(): Promise<void>;

  /**
   * Close working copy and release resources
   */
  close(): Promise<void>;
}

/**
 * Options for opening a working copy
 */
export interface WorkingCopyOptions {
  /** Create if doesn't exist (default: true) */
  create?: boolean;
  /** Default branch for new repositories (default: "main") */
  defaultBranch?: string;
}

/**
 * Options for adding a new worktree
 */
export interface AddWorktreeOptions {
  /** Branch to check out (creates if doesn't exist) */
  branch?: string;
  /** Commit to check out (detached HEAD) */
  commit?: ObjectId;
  /** Force creation even if branch exists elsewhere */
  force?: boolean;
}

/**
 * Factory for creating working copies
 */
export interface WorkingCopyFactory {
  /**
   * Open or create a working copy at the given path
   *
   * @param worktreePath Path to working directory
   * @param repositoryPath Path to repository (.git directory or bare repo)
   * @param options Creation options
   */
  openWorkingCopy(
    worktreePath: string,
    repositoryPath: string,
    options?: WorkingCopyOptions,
  ): Promise<WorkingCopy>;

  /**
   * Create additional worktree for existing repository
   *
   * Similar to `git worktree add`.
   *
   * @param repository Existing repository
   * @param worktreePath Path for new working directory
   * @param options Worktree options
   */
  addWorktree(
    repository: Repository,
    worktreePath: string,
    options?: AddWorktreeOptions,
  ): Promise<WorkingCopy>;
}
