/**
 * SimpleHistory - A simple HistoryStore implementation for testing
 *
 * Wraps individual stores (BlobStore, TreeStore, etc.) into a HistoryStore interface.
 * Used for creating WorkingCopy instances in tests without a full storage backend.
 *
 * Note: This implements the legacy HistoryStore interface which is what
 * MemoryWorkingCopy and commands currently require. The new History interface
 * will be adopted once commands migrate away from the legacy types.
 */

import type {
  BlobStore,
  CommitStore,
  GitObjectStore,
  HistoryStore,
  HistoryStoreConfig,
  RefStore,
  TagStore,
  TreeStore,
} from "@statewalker/vcs-core";

/**
 * Options for creating a SimpleHistory
 */
export interface SimpleHistoryOptions {
  /** Object store for raw Git objects */
  objects: GitObjectStore;
  /** Blob storage */
  blobs: BlobStore;
  /** Tree storage */
  trees: TreeStore;
  /** Commit storage */
  commits: CommitStore;
  /** Tag storage */
  tags: TagStore;
  /** Reference storage */
  refs: RefStore;
  /** Optional configuration */
  config?: HistoryStoreConfig;
}

/**
 * Simple in-memory HistoryStore implementation for testing.
 *
 * Wraps individual stores without requiring a full storage backend.
 * Does not support GC operations.
 */
export class SimpleHistory implements HistoryStore {
  readonly objects: GitObjectStore;
  readonly blobs: BlobStore;
  readonly trees: TreeStore;
  readonly commits: CommitStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
  readonly config: HistoryStoreConfig;

  private _initialized = false;

  constructor(options: SimpleHistoryOptions) {
    this.objects = options.objects;
    this.blobs = options.blobs;
    this.trees = options.trees;
    this.commits = options.commits;
    this.tags = options.tags;
    this.refs = options.refs;
    this.config = options.config ?? {};
  }

  async initialize(): Promise<void> {
    if ("initialize" in this.refs && typeof this.refs.initialize === "function") {
      await this.refs.initialize();
    }
    this._initialized = true;
  }

  async close(): Promise<void> {
    // No resources to clean up
  }

  async isInitialized(): Promise<boolean> {
    return this._initialized;
  }
}

/**
 * Create a SimpleHistory from individual stores
 */
export function createSimpleHistory(options: SimpleHistoryOptions): SimpleHistory {
  return new SimpleHistory(options);
}

// Backward compatibility aliases

/**
 * @deprecated Use SimpleHistoryOptions instead
 */
export type SimpleHistoryStoreOptions = SimpleHistoryOptions;

/**
 * @deprecated Use createSimpleHistory instead
 */
export function createSimpleHistoryStore(options: SimpleHistoryOptions): HistoryStore {
  return new SimpleHistory(options);
}

/**
 * @deprecated Use SimpleHistory instead
 */
export const SimpleHistoryStore = SimpleHistory;
