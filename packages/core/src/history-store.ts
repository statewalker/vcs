/**
 * HistoryStore interface - shared history storage (Part 1 of Three-Part Architecture)
 *
 * A HistoryStore contains immutable objects (commits, trees, blobs, tags)
 * and shared refs (branches, remote tracking refs).
 *
 * For local checkout state (HEAD, staging, merge state), use WorkingCopy.
 * Multiple WorkingCopies can share a single HistoryStore.
 *
 * Implementations may use different backends:
 * - File-based: .git directory structure
 * - SQL: database tables
 * - Memory: in-memory for testing
 *
 * @see WorkingCopy for local checkout state management
 */

import type { BlobStore } from "./blob/blob-store.js";
import type { CommitStore } from "./commits/commit-store.js";
import type { GCController } from "./delta/gc-controller.js";
import type { RawStoreWithDelta } from "./delta/raw-store-with-delta.js";
import type { GitObjectStore } from "./objects/object-store.js";
import type { RefStore } from "./refs/ref-store.js";
import type { TagStore } from "./tags/tag-store.js";
import type { TreeStore } from "./trees/tree-store.js";

/**
 * HistoryStore configuration
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
 * Combines object stores and shared refs into a unified repository interface.
 * Contains immutable history that can be shared across multiple working copies.
 *
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
   * Delta storage for garbage collection (optional)
   *
   * Provides access to the underlying delta-aware storage
   * for running GCController operations.
   */
  readonly deltaStorage?: RawStoreWithDelta;

  /**
   * Garbage collection controller (optional)
   *
   * Provides GC operations like repacking, pruning unreachable objects,
   * and storage optimization. Created from deltaStorage when available.
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
 * A subset of HistoryStore containing only the immutable object stores
 * (without refs, config, or lifecycle methods).
 * Useful for transport and storage operations that work with raw objects.
 *
 * @see HistoryStore for full repository interface with refs and lifecycle
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

// Backward compatibility aliases
/** @deprecated Use HistoryStore instead */
export type Repository = HistoryStore;
/** @deprecated Use HistoryStoreConfig instead */
export type RepositoryConfig = HistoryStoreConfig;
