/**
 * HistoryStore interface - shared history storage (Part 1 of Three-Part Architecture)
 *
 * @deprecated Use {@link History} interface instead.
 *
 * Migration example:
 * ```typescript
 * // Before:
 * const commit = await historyStore.commits.loadCommit(commitId);
 * const tree = await historyStore.trees.loadTree(treeId);
 *
 * // After:
 * const commit = await history.commits.load(commitId);
 * const tree = await history.trees.load(treeId);
 * ```
 *
 * Key differences:
 * - HistoryStore uses old store types (BlobStore, TreeStore, etc.)
 * - History uses new store types (Blobs, Trees, etc.)
 * - Old: loadCommit/storeCommit/delete → New: load/store/remove
 *
 * This interface will be removed in a future version.
 *
 * @see History for the new interface
 * @see WorkingCopy for local checkout state management
 */

import type { StorageBackend } from "../backend/storage-backend.js";
import type { GCController } from "../storage/delta/gc-controller.js";
import type { BlobStore } from "./blobs/blob-store.js";
import type { CommitStore } from "./commits/commit-store.js";
import type { GitObjectStore } from "./objects/object-store.js";
import type { RefStore } from "./refs/ref-store.js";
import type { TagStore } from "./tags/tag-store.js";
import type { TreeStore } from "./trees/tree-store.js";

/**
 * HistoryStore configuration
 *
 * @deprecated Part of the deprecated HistoryStore interface.
 */
export interface HistoryStoreConfig {
  /** Repository name (optional) */
  name?: string;
  /** Whether this is a bare repository */
  bare?: boolean;
  /** Custom configuration options */
  [key: string]: unknown;
}

/**
 * HistoryStore interface
 *
 * @deprecated Use {@link History} interface instead.
 *
 * Combines object stores and shared refs into a unified repository interface.
 * Contains immutable history that can be shared across multiple working copies.
 *
 * This interface will be removed in a future version.
 *
 * @see History for the new interface
 * @see WorkingCopy for local checkout state (HEAD, staging, merge state)
 */
export interface HistoryStore {
  /** Unified Git object storage (raw objects with headers) */
  readonly objects: GitObjectStore;

  /** Commit object storage */
  readonly commits: CommitStore;

  /** Tree object storage */
  readonly trees: TreeStore;

  /** Blob object storage */
  readonly blobs: BlobStore;

  /** Tag object storage */
  readonly tags: TagStore;

  /** Reference storage for branches, tags, HEAD */
  readonly refs: RefStore;

  /** Repository configuration */
  readonly config: HistoryStoreConfig;

  /**
   * Storage backend for unified access (optional)
   *
   * Provides access to the underlying storage backend
   * for GC and delta operations.
   */
  readonly backend?: StorageBackend;

  /**
   * Garbage collection controller (optional)
   *
   * Provides GC operations like repacking, pruning unreachable objects,
   * and storage optimization.
   */
  readonly gc?: GCController;

  /**
   * Initialize repository structure
   *
   * Creates necessary storage structures (directories, tables, etc.).
   * Safe to call on already-initialized repositories.
   */
  initialize(): Promise<void>;

  /**
   * Close repository and release resources
   *
   * Call this when done with the repository to clean up
   * any open handles, connections, or temporary files.
   */
  close(): Promise<void>;

  /**
   * Check if repository is initialized
   *
   * @returns True if repository has been initialized
   */
  isInitialized(): Promise<boolean>;
}

/**
 * GitStores - Collection of Git object stores
 *
 * @deprecated Use {@link History} interface instead.
 *
 * A subset of HistoryStore containing only the immutable object stores
 * (without refs, config, or lifecycle methods).
 *
 * This interface will be removed in a future version.
 *
 * @see History for the new interface
 */
export interface GitStores {
  /** Unified Git object storage (raw objects with headers) */
  readonly objects: GitObjectStore;

  /** Commit object storage */
  readonly commits: CommitStore;

  /** Tree object storage */
  readonly trees: TreeStore;

  /** Blob object storage */
  readonly blobs: BlobStore;

  /** Tag object storage */
  readonly tags: TagStore;
}
