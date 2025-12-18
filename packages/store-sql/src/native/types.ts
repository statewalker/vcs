/**
 * Types for native SQL stores with query capabilities
 *
 * Native stores provide optimized relational storage with queryable fields
 * while still computing Git-compatible SHA-1 object IDs for interoperability.
 */

import type {
  BlobStore,
  CommitStore,
  GitStores,
  ObjectId,
  TagStore,
  TreeStore,
} from "@webrun-vcs/vcs";

/**
 * Extended CommitStore with SQL query capabilities
 *
 * Provides methods for querying commits by author, date range,
 * and commit ancestry using SQL's power for efficient lookups.
 */
export interface SqlNativeCommitStore extends CommitStore {
  /**
   * Find commits by author email
   *
   * @param email Author email to search for
   * @returns Async iterable of matching commit IDs (newest first)
   */
  findByAuthor(email: string): AsyncIterable<ObjectId>;

  /**
   * Find commits in a date range
   *
   * @param since Start of date range
   * @param until End of date range
   * @returns Async iterable of matching commit IDs (newest first)
   */
  findByDateRange(since: Date, until: Date): AsyncIterable<ObjectId>;

  /**
   * Get all ancestors of a commit using recursive CTE
   *
   * More efficient than walking the graph manually as it uses
   * a single SQL query with recursive CTE.
   *
   * @param id Commit ID to find ancestors for
   * @returns Async iterable of ancestor commit IDs
   */
  getAncestors(id: ObjectId): AsyncIterable<ObjectId>;

  /**
   * Get commit count in the store
   */
  count(): Promise<number>;
}

/**
 * Extended TreeStore with SQL query capabilities
 *
 * Provides methods for finding trees containing specific blobs
 * and building file paths across the tree structure.
 */
export interface SqlNativeTreeStore extends TreeStore {
  /**
   * Find trees containing a specific blob
   *
   * @param blobId Blob object ID to search for
   * @returns Async iterable of tree IDs containing the blob
   */
  findTreesWithBlob(blobId: ObjectId): AsyncIterable<ObjectId>;

  /**
   * Get tree count in the store
   */
  count(): Promise<number>;
}

/**
 * Extended BlobStore with SQL query capabilities
 */
export interface SqlNativeBlobStore extends BlobStore {
  /**
   * Get blob count in the store
   */
  count(): Promise<number>;

  /**
   * Get total size of all blobs in the store
   */
  totalSize(): Promise<number>;
}

/**
 * Extended TagStore with SQL query capabilities
 */
export interface SqlNativeTagStore extends TagStore {
  /**
   * Find tags by name pattern
   *
   * @param pattern LIKE pattern for tag name (e.g., "v1.%")
   * @returns Async iterable of matching tag IDs
   */
  findByNamePattern(pattern: string): AsyncIterable<ObjectId>;

  /**
   * Get tag count in the store
   */
  count(): Promise<number>;
}

/**
 * Collection of native SQL stores with query capabilities
 *
 * Extends GitStores with more specific store types that provide
 * additional query methods beyond the standard interface.
 */
export interface SqlNativeStores extends GitStores {
  readonly commits: SqlNativeCommitStore;
  readonly trees: SqlNativeTreeStore;
  readonly blobs: SqlNativeBlobStore;
  readonly tags: SqlNativeTagStore;
}
