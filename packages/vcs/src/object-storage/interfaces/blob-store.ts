/**
 * Blob (file content) storage interface
 *
 * Blobs are the simplest Git object type - just raw binary content
 * with no parsing or serialization needed. This interface provides
 * a thin wrapper over GitObjectStore for blob operations.
 */

import type { ObjectId } from "./types.js";

/**
 * Blob storage with streaming API
 *
 * Unlike commits/trees/tags, blobs don't have structured content
 * to serialize. They're passed through directly to GitObjectStore.
 */
export interface BlobStore {
  /**
   * Store blob with unknown size
   *
   * Uses TempStore internally to determine size before storage.
   *
   * @param content Sync or async iterable of blob content chunks
   * @returns ObjectId of the stored blob
   */
  store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId>;

  /**
   * Store blob with known size (optimized path)
   *
   * Direct streaming without temporary storage.
   *
   * @param size Content size in bytes
   * @param content Sync or async iterable of blob content chunks
   * @returns ObjectId of the stored blob
   */
  storeWithSize(
    size: number,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<ObjectId>;

  /**
   * Load blob content
   *
   * @param id ObjectId of the blob
   * @returns Async iterable of blob content chunks
   * @throws Error if blob not found
   */
  load(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Check if blob exists
   *
   * @param id ObjectId of the blob
   * @returns True if blob exists
   */
  has(id: ObjectId): Promise<boolean>;
}
