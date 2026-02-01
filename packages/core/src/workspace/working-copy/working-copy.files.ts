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
import type { Staging } from "../staging/index.js";
import type { StagingStore } from "../staging/types.js";
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
import type { Worktree } from "../worktree/index.js";
import type { WorktreeStore } from "../worktree/types.js";

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
  readonly stash: StashStore;
  readonly config: WorkingCopyConfig;

  // Internal state for legacy mode
  private _legacyWorktree?: WorktreeStore;
  private _legacyStaging?: StagingStore;
  private _worktreeAdapter?: Worktree;
  private _stagingAdapter?: Staging;
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
      this._legacyWorktree = options.worktree;
      this.stash = options.stash;
      this.config = options.config;
      this.files = options.files;
      this.gitDir = options.gitDir;
      this.useLegacyMode = false;
    } else {
      // Legacy positional arguments form
      this.repository = repositoryOrOptions;
      this._legacyWorktree = worktree;
      this._legacyStaging = staging;
      this.stash = stash as StashStore;
      this.config = config as WorkingCopyConfig;
      this.files = files as WorkingCopyFilesApi;
      this.gitDir = gitDir as string;
      this.useLegacyMode = true;
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
    // Use new interfaces when available
    if (!this.useLegacyMode && this.worktreeInterface && this.checkout) {
      const calculator = createStatusCalculator({
        worktree: this.worktreeInterface,
        staging: this.checkout.staging,
        trees: this.repository.trees,
        commits: this.repository.commits,
        refs: this.repository.refs,
        blobs: this.repository.blobs,
      });
      return calculator.calculateStatus(options);
    }

    // Legacy mode - adapt legacy stores to new interfaces
    const stagingAdapter = this.createStagingAdapter();
    const worktreeAdapter = this.createWorktreeAdapter();

    const calculator = createStatusCalculator({
      worktree: worktreeAdapter,
      staging: stagingAdapter,
      trees: this.repository.trees,
      commits: this.repository.commits,
      refs: this.repository.refs,
      blobs: this.repository.blobs,
    });

    return calculator.calculateStatus(options);
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
