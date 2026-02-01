/**
 * In-memory WorkingCopy implementation for testing.
 *
 * Provides a fast, isolated WorkingCopy without filesystem access.
 * Useful for unit tests that need to verify WorkingCopy-dependent code
 * without dealing with actual file operations.
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
import type { Staging } from "../staging/index.js";
import type { StagingStore } from "../staging/types.js";
import type { RepositoryStatus, StatusOptions } from "../status/index.js";
import type {
  CherryPickState,
  MergeState,
  RebaseState,
  RevertState,
  StashStore,
  WorkingCopy,
  WorkingCopyConfig,
} from "../working-copy.js";
import type { Worktree } from "../worktree/index.js";
import type { WorktreeStore } from "../worktree/types.js";
import {
  getStateCapabilities,
  RepositoryState,
  type RepositoryStateValue,
  type StateCapabilities,
} from "./repository-state.js";
import { MemoryStashStore } from "./stash-store.memory.js";

/**
 * Options for MemoryWorkingCopy
 */
export interface MemoryWorkingCopyOptions {
  /** Legacy HistoryStore */
  repository: HistoryStore;
  /** Legacy WorktreeStore */
  worktree: WorktreeStore;
  /** Staging store */
  staging: StagingStore;
  /** Optional stash store */
  stash?: StashStore;
  /** Optional configuration */
  config?: WorkingCopyConfig;
  /** Optional History interface (new architecture) */
  history?: History;
  /** Optional Checkout interface (new architecture) */
  checkout?: Checkout;
  /** Optional Worktree interface (new architecture) */
  worktreeInterface?: Worktree;
}

/**
 * In-memory WorkingCopy implementation.
 *
 * Stores HEAD, merge state, and rebase state in memory.
 * Provides test helpers for setting these states directly.
 *
 * Can optionally use new architecture interfaces (History, Checkout, Worktree)
 * if provided, otherwise manages state internally.
 */
export class MemoryWorkingCopy implements WorkingCopy {
  private headRef = "refs/heads/main";
  private headCommit: ObjectId | undefined;
  private _mergeState: MergeState | undefined;
  private _rebaseState: RebaseState | undefined;
  private _cherryPickState: CherryPickState | undefined;
  private _revertState: RevertState | undefined;
  private _repositoryState: RepositoryStateValue = RepositoryState.SAFE;

  // New architecture components (optional)
  readonly history?: History;
  readonly checkout?: Checkout;
  readonly worktreeInterface?: Worktree;

  // Legacy properties
  readonly repository: HistoryStore;
  readonly stash: StashStore;
  readonly config: WorkingCopyConfig;

  // Internal legacy stores
  private _legacyWorktree?: WorktreeStore;
  private _legacyStaging?: StagingStore;
  private _worktreeAdapter?: Worktree;
  private _stagingAdapter?: Staging;

  constructor(options: MemoryWorkingCopyOptions);
  /** @deprecated Use options object instead */
  constructor(
    repository: HistoryStore,
    worktree: WorktreeStore,
    staging: StagingStore,
    stash?: StashStore,
    config?: WorkingCopyConfig,
  );
  constructor(
    repositoryOrOptions: HistoryStore | MemoryWorkingCopyOptions,
    worktree?: WorktreeStore,
    staging?: StagingStore,
    stash?: StashStore,
    config?: WorkingCopyConfig,
  ) {
    if (typeof repositoryOrOptions === "object" && "repository" in repositoryOrOptions) {
      // Options object form
      const options = repositoryOrOptions;
      this.repository = options.repository;
      this._legacyWorktree = options.worktree;
      this._legacyStaging = options.staging;
      this.stash = options.stash ?? new MemoryStashStore();
      this.config = options.config ?? {};
      this.history = options.history;
      this.checkout = options.checkout;
      this.worktreeInterface = options.worktreeInterface;
    } else {
      // Legacy positional arguments form
      this.repository = repositoryOrOptions;
      this._legacyWorktree = worktree;
      this._legacyStaging = staging;
      this.stash = stash ?? new MemoryStashStore();
      this.config = config ?? {};
    }
  }

  /**
   * Worktree - delegates to worktreeInterface or creates adapter from legacy
   */
  get worktree(): Worktree {
    if (this.worktreeInterface) {
      return this.worktreeInterface;
    }
    // Legacy mode - create adapter if needed
    if (!this._worktreeAdapter && this._legacyWorktree) {
      this._worktreeAdapter = this.createWorktreeAdapter();
    }
    return this._worktreeAdapter as Worktree;
  }

  /**
   * Staging area - delegates to checkout or creates adapter from legacy
   */
  get staging(): Staging {
    if (this.checkout) {
      return this.checkout.staging;
    }
    // Legacy mode - create adapter if needed
    if (!this._stagingAdapter && this._legacyStaging) {
      this._stagingAdapter = this.createStagingAdapter();
    }
    return this._stagingAdapter as Staging;
  }

  /**
   * Create a Staging adapter from legacy StagingStore.
   * @internal
   */
  private createStagingAdapter(): Staging {
    if (!this._legacyStaging) {
      throw new Error("Legacy staging store not available");
    }
    const legacyStaging = this._legacyStaging;
    return {
      getEntryCount: () => legacyStaging.getEntryCount(),
      hasEntry: (path) => legacyStaging.hasEntry(path),
      getEntry: (path, stage) =>
        stage !== undefined
          ? legacyStaging.getEntryByStage(path, stage)
          : legacyStaging.getEntry(path),
      getEntries: (path) => legacyStaging.getEntries(path),
      setEntry: () => Promise.reject(new Error("setEntry not supported in legacy adapter")),
      removeEntry: () => Promise.reject(new Error("removeEntry not supported in legacy adapter")),
      entries: (opts) =>
        opts?.prefix ? legacyStaging.listEntriesUnder(opts.prefix) : legacyStaging.listEntries(),
      hasConflicts: () => legacyStaging.hasConflicts(),
      getConflictedPaths: async () => {
        const paths: string[] = [];
        for await (const path of legacyStaging.getConflictPaths()) {
          paths.push(path);
        }
        return paths;
      },
      resolveConflict: () =>
        Promise.reject(new Error("resolveConflict not supported in legacy adapter")),
      writeTree: (trees) =>
        legacyStaging.writeTree(
          trees as unknown as import("../../history/trees/tree-store.js").TreeStore,
        ),
      readTree: (trees, treeId) =>
        legacyStaging.readTree(
          trees as unknown as import("../../history/trees/tree-store.js").TreeStore,
          treeId,
        ),
      createBuilder: () => {
        const b = legacyStaging.builder();
        return {
          add: (e) => b.add(e),
          keep: (s, c) => b.keep(s, c),
          addTree: (t, id, p, st) =>
            b.addTree(
              t as unknown as import("../../history/trees/tree-store.js").TreeStore,
              id,
              p,
              st,
            ),
          finish: () => b.finish(),
        };
      },
      createEditor: () => {
        const e = legacyStaging.editor();
        return {
          add: (ed) => e.add(ed),
          remove: (p) => e.remove(p),
          upsert: () => {
            throw new Error("upsert not supported in legacy adapter");
          },
          finish: () => e.finish(),
        };
      },
      read: () => legacyStaging.read(),
      write: () => legacyStaging.write(),
      isOutdated: () => legacyStaging.isOutdated(),
      getUpdateTime: () => legacyStaging.getUpdateTime(),
      clear: () => legacyStaging.clear(),
    };
  }

  /**
   * Create a Worktree adapter from legacy WorktreeStore.
   * @internal
   */
  private createWorktreeAdapter(): Worktree {
    if (!this._legacyWorktree) {
      throw new Error("Legacy worktree store not available");
    }
    const legacyWorktree = this._legacyWorktree;
    return {
      walk: (opts) => legacyWorktree.walk(opts),
      getEntry: (path) => legacyWorktree.getEntry(path),
      computeHash: (path) => legacyWorktree.computeHash(path),
      readContent: (path) => legacyWorktree.readContent(path),
      exists: async (path) => (await legacyWorktree.getEntry(path)) !== undefined,
      isIgnored: async (path) => (await legacyWorktree.getEntry(path))?.isIgnored ?? false,
      writeContent: () => Promise.reject(new Error("writeContent not supported in legacy adapter")),
      remove: () => Promise.reject(new Error("remove not supported in legacy adapter")),
      mkdir: () => Promise.reject(new Error("mkdir not supported in legacy adapter")),
      rename: () => Promise.reject(new Error("rename not supported in legacy adapter")),
      checkoutTree: () => Promise.reject(new Error("checkoutTree not supported in legacy adapter")),
      checkoutPaths: () =>
        Promise.reject(new Error("checkoutPaths not supported in legacy adapter")),
      getRoot: () => "",
      refreshIgnore: () => Promise.resolve(),
    };
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
   * Get cherry-pick state if a cherry-pick is in progress.
   */
  async getCherryPickState(): Promise<CherryPickState | undefined> {
    return this._cherryPickState;
  }

  /**
   * Get revert state if a revert is in progress.
   */
  async getRevertState(): Promise<RevertState | undefined> {
    return this._revertState;
  }

  /**
   * Check if any operation is in progress.
   */
  async hasOperationInProgress(): Promise<boolean> {
    return (
      this._mergeState !== undefined ||
      this._rebaseState !== undefined ||
      this._cherryPickState !== undefined ||
      this._revertState !== undefined
    );
  }

  /**
   * Get current repository state.
   */
  async getState(): Promise<RepositoryStateValue> {
    return this._repositoryState;
  }

  /**
   * Get capability queries for current state.
   */
  async getStateCapabilities(): Promise<StateCapabilities> {
    return getStateCapabilities(this._repositoryState);
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

  /**
   * Set cherry-pick state directly (for testing).
   */
  setCherryPickState(state: CherryPickState | undefined): void {
    this._cherryPickState = state;
  }

  /**
   * Set revert state directly (for testing).
   */
  setRevertState(state: RevertState | undefined): void {
    this._revertState = state;
  }

  /**
   * Set repository state directly (for testing).
   */
  setRepositoryState(state: RepositoryStateValue): void {
    this._repositoryState = state;
  }
}

/**
 * Create a MemoryWorkingCopy instance.
 */
export function createMemoryWorkingCopy(options: MemoryWorkingCopyOptions): MemoryWorkingCopy;
/** @deprecated Use options object instead */
export function createMemoryWorkingCopy(
  repository: HistoryStore,
  worktree: WorktreeStore,
  staging: StagingStore,
  stash?: StashStore,
  config?: WorkingCopyConfig,
): MemoryWorkingCopy;
export function createMemoryWorkingCopy(
  repositoryOrOptions: HistoryStore | MemoryWorkingCopyOptions,
  worktree?: WorktreeStore,
  staging?: StagingStore,
  stash?: StashStore,
  config?: WorkingCopyConfig,
): MemoryWorkingCopy {
  if (typeof repositoryOrOptions === "object" && "repository" in repositoryOrOptions) {
    return new MemoryWorkingCopy(repositoryOrOptions);
  }
  return new MemoryWorkingCopy(
    repositoryOrOptions,
    worktree as WorktreeStore,
    staging as StagingStore,
    stash,
    config,
  );
}
