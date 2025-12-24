/**
 * Repository interface - the main entry point for VCS operations
 *
 * A Repository combines all stores (objects, refs, staging) into a single
 * coherent interface. Implementations may use different backends:
 * - File-based: .git directory structure
 * - SQL: database tables
 * - Memory: in-memory for testing
 */

import type { BlobStore } from "./blob-store.js";
import type { CommitStore } from "./commit-store.js";
import type { RefStore } from "./ref-store.js";
import type { TagStore } from "./tag-store.js";
import type { TreeStore } from "./tree-store.js";

/**
 * Repository configuration
 */
export interface RepositoryConfig {
  /** Repository name (optional) */
  name?: string;
  /** Whether this is a bare repository */
  bare?: boolean;
  /** Custom configuration options */
  [key: string]: unknown;
}

/**
 * Repository interface
 *
 * Combines all stores into a unified repository interface.
 * This is the main entry point for VCS operations.
 */
export interface Repository {
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
  readonly config: RepositoryConfig;

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
