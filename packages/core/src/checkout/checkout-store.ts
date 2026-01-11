/**
 * CheckoutStore interface - local checkout state (Part 3 of Three-Part Architecture)
 *
 * A CheckoutStore manages local checkout state including:
 * - HEAD reference (current branch or detached commit)
 * - Staging area (index)
 * - In-progress operation state (merge, rebase, cherry-pick, revert)
 * - Stash operations
 *
 * This is the "checked out" state that:
 * - Is local to each working copy
 * - Tracks what branch/commit is checked out
 * - Manages the staging area for commits
 * - Stores in-progress operation state
 *
 * Multiple CheckoutStores can share a single HistoryStore.
 *
 * @see HistoryStore for shared history storage (Part 1)
 * @see WorktreeStore for filesystem access (Part 2)
 */

import type { ObjectId } from "../common/id/index.js";
import type { StagingStore } from "../staging/index.js";
import type { RepositoryStateValue, StateCapabilities } from "../working-copy/repository-state.js";
import type {
  CherryPickState,
  MergeState,
  RebaseState,
  RevertState,
  StashStore,
} from "../working-copy.js";

/**
 * CheckoutStore configuration
 */
export interface CheckoutStoreConfig {
  /** Custom configuration options */
  [key: string]: unknown;
}

/**
 * CheckoutStore interface - manages local checkout state
 *
 * Contains all the mutable local state for a working copy:
 * - HEAD (current branch or commit)
 * - Staging area (index)
 * - In-progress operations (merge, rebase, etc.)
 * - Stash
 *
 * @example Checking branch and HEAD
 * ```typescript
 * const branch = await checkout.getCurrentBranch();
 * console.log(`On branch: ${branch ?? "detached HEAD"}`);
 *
 * const head = await checkout.getHead();
 * console.log(`HEAD commit: ${head}`);
 * ```
 *
 * @example Detecting in-progress operations
 * ```typescript
 * if (await checkout.hasOperationInProgress()) {
 *   const state = await checkout.getState();
 *   console.log(`Operation in progress: ${state}`);
 * }
 * ```
 */
export interface CheckoutStore {
  // ============ Linked Stores ============

  /** Staging area (the index) */
  readonly staging: StagingStore;

  /** Stash operations */
  readonly stash: StashStore;

  /** Checkout configuration */
  readonly config: CheckoutStoreConfig;

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
   * @returns Branch name (e.g., "main") or undefined if detached HEAD
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

  // ============ Lifecycle ============

  /**
   * Refresh checkout state from storage
   *
   * Call after external changes to the repository.
   */
  refresh(): Promise<void>;

  /**
   * Close checkout store and release resources
   */
  close(): Promise<void>;
}
