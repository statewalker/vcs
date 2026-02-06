/**
 * Memory-backed object storage with Git-compatible IDs
 *
 * Creates typed stores that compute Git-compatible SHA-1 object IDs
 * using the git-codec implementations from the vcs package.
 *
 * The stores implement both legacy interfaces (BlobStore, TreeStore, etc.)
 * and new interfaces (Blobs, Trees, etc.) for backward compatibility.
 */

import type { Blobs, Commits, Tags, Trees } from "@statewalker/vcs-core";
import {
  GitBlobStore,
  GitCommitStore,
  type GitObjectStore,
  GitObjectStoreImpl,
  GitTagStore,
  GitTreeStore,
  MemoryRawStorage,
} from "@statewalker/vcs-core";

/**
 * Collection of memory-backed object stores
 *
 * The stores implement both legacy and new interfaces.
 */
export interface MemoryObjectStores {
  /** Low-level Git object store */
  objects: GitObjectStore;
  /** Blob (file content) store - implements both BlobStore and Blobs */
  blobs: Blobs;
  /** Tree (directory) store - implements both TreeStore and Trees */
  trees: Trees;
  /** Commit store - implements both CommitStore and Commits */
  commits: Commits;
  /** Tag store - implements both TagStore and Tags */
  tags: Tags;
}

/**
 * Options for creating memory object stores
 */
export interface CreateMemoryObjectStoresOptions {
  /**
   * Optional RawStorage to use for persistence
   * If not provided, a new MemoryRawStorage is created
   */
  storage?: MemoryRawStorage;
}

/**
 * Create memory-backed object stores with Git-compatible IDs
 *
 * Uses the git-codec implementations from the vcs package to ensure
 * object IDs are computed identically to native Git.
 *
 * @param options Configuration options
 * @returns Collection of typed object stores
 *
 * @example
 * ```typescript
 * const stores = createMemoryObjectStores();
 *
 * // Store a blob
 * const blobId = await stores.blobs.store(content);
 *
 * // Store a commit
 * const commitId = await stores.commits.storeCommit({
 *   tree: treeId,
 *   parents: [],
 *   author: { name: "Test", email: "test@test.com", timestamp: 123, tzOffset: "+0000" },
 *   committer: { name: "Test", email: "test@test.com", timestamp: 123, tzOffset: "+0000" },
 *   message: "Initial commit"
 * });
 * ```
 */
export function createMemoryObjectStores(
  options: CreateMemoryObjectStoresOptions = {},
): MemoryObjectStores {
  const storage = options.storage ?? new MemoryRawStorage();
  const objects = new GitObjectStoreImpl({ storage });

  return {
    objects,
    blobs: new GitBlobStore(objects),
    trees: new GitTreeStore(objects),
    commits: new GitCommitStore(objects),
    tags: new GitTagStore(objects),
  };
}
