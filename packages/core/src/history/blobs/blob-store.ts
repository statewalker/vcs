/**
 * Blob (file content) storage interface
 *
 * Blobs are the simplest Git object type - just raw binary content
 * with no parsing or serialization needed.
 */

import type { ObjectId } from "../../common/id/index.js";

/**
 * Blob storage with streaming API
 *
 * Blobs are raw binary content with no internal structure.
 * Content is stored and retrieved as opaque byte streams.
 */
export interface BlobStore {
  /**
   * Store blob content
   *
   * @param content Sync or async iterable of blob content chunks
   * @returns ObjectId of the stored blob
   */
  store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId>;

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

  /**
   * List all blob object IDs
   *
   * Enumerates all blobs in storage. Used for garbage collection
   * and storage analysis. Only returns blobs, not other object types.
   *
   * @returns Async iterable of blob ObjectIds
   */
  keys(): AsyncIterable<ObjectId>;

  /**
   * Get blob size in bytes
   *
   * Returns the size of the blob content without loading the full content.
   * Used for delta candidate selection and storage analysis.
   *
   * @param id ObjectId of the blob
   * @returns Size in bytes
   * @throws Error if blob not found
   */
  size(id: ObjectId): Promise<number>;

  /**
   * Delete a blob from storage
   *
   * Removes a blob permanently. Used by garbage collection to remove
   * unreachable objects.
   *
   * Note: Callers must ensure the blob is not referenced by any tree
   * or used as a delta base before deletion.
   *
   * @param id ObjectId of the blob to delete
   * @returns True if the blob was deleted, false if it didn't exist
   */
  delete(id: ObjectId): Promise<boolean>;
}
