/**
 * Memory-backed object storage with Git-compatible IDs
 *
 * Creates typed stores (BlobStore, TreeStore, CommitStore, TagStore)
 * that compute Git-compatible SHA-1 object IDs using the git-codec
 * implementations from the vcs package.
 */

import type { BlobStore, CommitStore, TagStore, TreeStore } from "@webrun-vcs/vcs";
import { MemoryVolatileStore } from "@webrun-vcs/vcs/binary-storage";
import {
  GitBlobStore,
  GitCommitStore,
  GitObjectStore,
  GitTagStore,
  GitTreeStore,
} from "@webrun-vcs/vcs/object-storage";
import { MemRawStore } from "../binary-storage/index.js";

/**
 * Collection of memory-backed object stores
 */
export interface MemoryObjectStores {
  /** Low-level Git object store */
  objects: GitObjectStore;
  /** Blob (file content) store */
  blobs: BlobStore;
  /** Tree (directory) store */
  trees: TreeStore;
  /** Commit store */
  commits: CommitStore;
  /** Tag store */
  tags: TagStore;
}

/**
 * Options for creating memory object stores
 */
export interface CreateMemoryObjectStoresOptions {
  /**
   * Optional RawStore to use for persistence
   * If not provided, a new MemRawStore is created
   */
  rawStore?: MemRawStore;
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
  const rawStore = options.rawStore ?? new MemRawStore();
  const volatileStore = new MemoryVolatileStore();

  const objects = new GitObjectStore(volatileStore, rawStore);

  return {
    objects,
    blobs: new GitBlobStore(objects),
    trees: new GitTreeStore(objects),
    commits: new GitCommitStore(objects),
    tags: new GitTagStore(objects),
  };
}
