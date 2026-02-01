/**
 * File-based CheckoutStore implementation.
 *
 * Manages local checkout state for a Git working directory.
 * Reads and writes Git state files (HEAD, MERGE_HEAD, etc.)
 */

import type { ObjectId } from "../../common/id/index.js";
import type { RefStore } from "../../history/refs/index.js";
import type { StagingStore } from "../staging/index.js";
import {
  type CherryPickStateFilesApi,
  readCherryPickState,
} from "../working-copy/cherry-pick-state-reader.js";
import { type MergeStateFilesApi, readMergeState } from "../working-copy/merge-state-reader.js";
import { type RebaseStateFilesApi, readRebaseState } from "../working-copy/rebase-state-reader.js";
import {
  getStateCapabilities,
  type RepositoryStateValue,
  type StateCapabilities,
} from "../working-copy/repository-state.js";
import {
  detectRepositoryState,
  type StateDetectorFilesApi,
} from "../working-copy/repository-state-detector.js";
import { type RevertStateFilesApi, readRevertState } from "../working-copy/revert-state-reader.js";
import type {
  CherryPickState,
  MergeState,
  RebaseState,
  RevertState,
  StashStore,
} from "../working-copy.js";
import type { CheckoutStore, CheckoutStoreConfig } from "./types.js";

/**
 * Files API subset needed for FileCheckoutStore
 */
export interface CheckoutStoreFilesApi
  extends MergeStateFilesApi,
    RebaseStateFilesApi,
    CherryPickStateFilesApi,
    RevertStateFilesApi,
    StateDetectorFilesApi {}

/**
 * Git-compatible CheckoutStore implementation.
 *
 * Manages checkout state including HEAD, staging area, merge/rebase state, and stash.
 * Uses the RefStore for HEAD management and files for operation state.
 */
export class FileCheckoutStore implements CheckoutStore {
  constructor(
    readonly staging: StagingStore,
    readonly stash: StashStore,
    readonly config: CheckoutStoreConfig,
    private readonly refs: RefStore,
    private readonly files: CheckoutStoreFilesApi,
    private readonly gitDir: string,
  ) {}

  /**
   * Get current HEAD commit ID.
   */
  async getHead(): Promise<ObjectId | undefined> {
    const ref = await this.refs.resolve("HEAD");
    return ref?.objectId;
  }

  /**
   * Get current branch name.
   * Returns undefined if HEAD is detached.
   */
  async getCurrentBranch(): Promise<string | undefined> {
    const headRef = await this.refs.get("HEAD");
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
      await this.refs.setSymbolic("HEAD", ref);
    } else {
      // Direct reference to commit (detached HEAD)
      await this.refs.set("HEAD", target);
    }
  }

  /**
   * Check if HEAD is detached (pointing directly to commit, not branch).
   */
  async isDetachedHead(): Promise<boolean> {
    const headRef = await this.refs.get("HEAD");
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
   * Refresh checkout store state from storage.
   */
  async refresh(): Promise<void> {
    await this.staging.read();
  }

  /**
   * Close checkout store and release resources.
   */
  async close(): Promise<void> {
    // Release resources if needed
  }
}

/**
 * Options for creating a FileCheckoutStore
 */
export interface CreateFileCheckoutStoreOptions {
  /** Staging store */
  staging: StagingStore;
  /** Stash store */
  stash: StashStore;
  /** RefStore for HEAD management */
  refs: RefStore;
  /** Files API for reading state files */
  files: CheckoutStoreFilesApi;
  /** Path to .git directory */
  gitDir: string;
  /** Optional configuration */
  config?: CheckoutStoreConfig;
}

/**
 * Create a FileCheckoutStore instance.
 */
export function createFileCheckoutStore(
  options: CreateFileCheckoutStoreOptions,
): FileCheckoutStore {
  return new FileCheckoutStore(
    options.staging,
    options.stash,
    options.config ?? {},
    options.refs,
    options.files,
    options.gitDir,
  );
}
