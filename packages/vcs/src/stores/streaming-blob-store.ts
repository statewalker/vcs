/**
 * Streaming blob store adapter
 *
 * Thin wrapper over GitObjectStore for blob operations.
 * Blobs are the simplest object type - just raw binary content.
 */

import type { BlobStore } from "../interfaces/blob-store.js";
import type { GitObjectStore } from "../interfaces/git-object-store.js";
import type { ObjectId } from "../interfaces/types.js";

/**
 * Streaming blob store implementation
 *
 * Delegates all operations to GitObjectStore with "blob" type.
 */
export class StreamingBlobStore implements BlobStore {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store blob with unknown size
   */
  store(content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    return this.objects.store("blob", content);
  }

  /**
   * Store blob with known size (optimized path)
   */
  storeWithSize(size: number, content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    return this.objects.storeWithSize("blob", size, content);
  }

  /**
   * Load blob content
   */
  load(id: ObjectId): AsyncIterable<Uint8Array> {
    return this.objects.load(id);
  }

  /**
   * Check if blob exists
   */
  has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }
}
