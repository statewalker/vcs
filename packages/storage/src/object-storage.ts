import type { ObjectId } from "./types.js";

/**
 * Core object storage interface
 *
 * Provides content-addressable storage with streaming support.
 * This is the minimal interface that all storage backends must implement.
 *
 * The interface is intentionally simple - delta compression, caching,
 * and other optimizations are handled by implementations or wrappers.
 */
export interface ObjectStorage {
  /**
   * Store object content
   *
   * Content is hashed to produce the ObjectId. If an object with the
   * same hash already exists, this is a no-op (deduplication).
   *
   * @param data Async iterable of content chunks
   * @returns ObjectId (content hash in hex)
   */
  store(data: AsyncIterable<Uint8Array>): Promise<ObjectId>;

  /**
   * Load object content by ID
   *
   * @param id Object ID (content hash)
   * @returns Async iterable of content chunks
   * @throws Error if object not found
   */
  load(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Check if object exists
   *
   * @param id Object ID
   * @returns True if object exists
   */
  has(id: ObjectId): Promise<boolean>;

  /**
   * Delete object
   *
   * @param id Object ID
   * @returns True if object was deleted, false if not found
   */
  delete(id: ObjectId): Promise<boolean>;

  /**
   * Get the size of an object in bytes
   *
   * Returns the uncompressed content size, not the on-disk storage size.
   * This matches Git's behavior where object size refers to content length.
   *
   * @param id Object ID to query
   * @returns Size in bytes, or -1 if object does not exist
   */
  getSize(id: ObjectId): Promise<number>;

  /**
   * Iterate over all object IDs in storage
   *
   * Yields object IDs in an implementation-defined order. No guarantees
   * are made about ordering or consistency during concurrent modifications.
   *
   * @returns AsyncGenerator yielding ObjectIds
   */
  listObjects(): AsyncGenerator<ObjectId>;
}
