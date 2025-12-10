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
export interface ObjectStore {
  /**
   * Store object content
   *
   * Content is hashed to produce the object ID. If an object with the
   * same hash already exists, this is a no-op (deduplication).
   *
   * Accepts both sync and async iterables, allowing use with:
   * - Sync generators: `function* () { yield chunk; }`
   * - Async generators: `async function* () { yield chunk; }`
   * - Arrays: `[chunk1, chunk2]` (arrays are Iterable)
   * - Single chunks wrapped: `[chunk]`
   *
   * @param data Sync or async iterable of content chunks
   * @returns Object ID (content hash in hex)
   */
  store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId>;

  /**
   * Load object content by ID
   *
   * @param id Object ID (content hash)
   * @param params Optional parameters:
   *   - offset: start reading from this byte offset (default: 0)
   *   - length: read up to this many bytes (default: until end)
   * @returns Async iterable of content chunks
   * @throws Error if object not found
   */
  load(id: ObjectId, params?: { offset?: number; length?: number }): AsyncIterable<Uint8Array>;

  /**
   * Get object size
   *
   * @param id Object ID
   * @returns Size in bytes, or -1 if object not found
   */
  getSize(id: ObjectId): Promise<number>;

  /**
   * Check if object exists
   *
   * @param id Object ID
   * @returns True if object exists, false otherwise
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
   * Iterate over all object IDs in storage
   *
   * Yields object IDs in an implementation-defined order. No guarantees
   * are made about ordering or consistency during concurrent modifications.
   *
   * @returns AsyncGenerator yielding ObjectIds
   */
  listObjects(): AsyncGenerator<ObjectId>;
}
