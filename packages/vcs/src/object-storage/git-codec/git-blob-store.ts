/**
 * Git blob store implementation
 *
 * Thin wrapper over GitObjectStore for blob operations.
 * Blobs are the simplest object type - just raw binary content.
 */

import type { BlobStore, ObjectId } from "../interfaces/index.js";
import type { GitObjectStore } from "./git-object-store.js";

/**
 * Convert sync or async iterable to async iterable
 */
function toAsyncIterable(
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  // Check if it's already async iterable
  if (Symbol.asyncIterator in content) {
    return content as AsyncIterable<Uint8Array>;
  }
  // Convert sync iterable to async
  const syncContent = content as Iterable<Uint8Array>;
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of syncContent) {
        yield chunk;
      }
    },
  };
}

/**
 * Git blob store implementation
 *
 * Delegates all operations to GitObjectStore with "blob" type.
 */
export class GitBlobStore implements BlobStore {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store blob with unknown size
   */
  store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.objects.store("blob", toAsyncIterable(content));
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
