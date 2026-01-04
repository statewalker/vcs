/**
 * SQL-backed object storage with Git-compatible format
 *
 * Creates typed stores (BlobStore, TreeStore, CommitStore, TagStore)
 * that use Git-compatible serialization and SHA-1 hashing.
 */

import {
  type BlobStore,
  type CommitStore,
  GitBlobStore,
  GitCommitStore,
  type GitObjectStore,
  GitObjectStoreImpl,
  GitTagStore,
  GitTreeStore,
  MemoryVolatileStore,
  type TagStore,
  type TreeStore,
} from "@statewalker/vcs-core";
import { SqlRawStore } from "../binary-storage/sql-raw-store.js";
import type { DatabaseClient } from "../database-client.js";

/**
 * Collection of SQL-backed object stores
 */
export interface SqlObjectStores {
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
 * Options for creating SQL-backed object stores
 */
export interface CreateSqlObjectStoresOptions {
  /** Database client for SQL operations */
  db: DatabaseClient;
  /** Table name for raw objects (default: "raw_objects") */
  tableName?: string;
}

/**
 * Create SQL-backed object stores with Git-compatible format
 *
 * Uses the git-codec implementations from the vcs package to ensure
 * objects are serialized in Git format with correct SHA-1 IDs.
 *
 * @param options Configuration options
 * @returns Collection of typed object stores
 *
 * @example
 * ```typescript
 * const stores = createSqlObjectStores({
 *   db: sqliteClient,
 *   tableName: "git_objects"
 * });
 *
 * // Store a blob in Git format
 * const blobId = await stores.blobs.store(content);
 * ```
 */
export function createSqlObjectStores(options: CreateSqlObjectStoresOptions): SqlObjectStores {
  const { db, tableName = "raw_objects" } = options;

  const rawStore = new SqlRawStore(db, tableName);
  const volatileStore = new MemoryVolatileStore();

  const objects = new GitObjectStoreImpl(volatileStore, rawStore);

  return {
    objects,
    blobs: new GitBlobStore(objects),
    trees: new GitTreeStore(objects),
    commits: new GitCommitStore(objects),
    tags: new GitTagStore(objects),
  };
}

// Re-export git-codec stores for direct usage
export {
  GitBlobStore,
  GitCommitStore,
  type GitObjectStore,
  GitObjectStoreImpl,
  GitTagStore,
  GitTreeStore,
} from "@statewalker/vcs-core";
