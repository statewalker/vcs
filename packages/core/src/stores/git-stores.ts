/**
 * Collection of Git-compatible typed stores
 *
 * This interface bundles all typed store interfaces together.
 * Different backends may implement these stores differently:
 * - File-based: streaming through GitObjectStore
 * - SQL: structured tables with queryable fields
 * - Memory: in-memory maps with Git-compatible hashing
 *
 * All implementations produce identical Git object IDs for the same content.
 */

import type { BlobStore } from "./blob-store.js";
import type { CommitStore } from "./commit-store.js";
import type { GitObjectStore } from "./git-object-store.js";
import type { TagStore } from "./tag-store.js";
import type { TreeStore } from "./tree-store.js";

/**
 * Collection of Git-compatible typed stores
 *
 * Provides access to all object type stores through a single interface.
 * Use this when you need to work with multiple object types.
 */
export interface GitStores {
  /** Low-level Git object store for raw object access */
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
