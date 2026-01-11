/**
 * Blob (file content) storage interface
 *
 * Blobs are the simplest Git object type - just raw binary content
 * with no parsing or serialization needed.
 */

import type { ObjectId } from "../common/id/index.js";

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
}
