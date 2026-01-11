/**
 * Git blob store implementation
 *
 * Thin wrapper over GitObjectStore for blob operations.
 * Blobs are the simplest object type - just raw binary content.
 */

import type { ObjectId } from "../common/id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import type { BlobStore } from "./blob-store.js";

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
    return this.objects.store("blob", content);
  }

  /**
   * Load blob content
   */
  async *load(id: ObjectId): AsyncGenerator<Uint8Array> {
    const [header, content] = await this.objects.loadWithHeader(id);
    try {
      if (header.type !== "blob") {
        throw new Error(`Object ${id} is not a blob (found type: ${header.type})`);
      }
      yield* content;
    } catch (err) {
      content?.return?.(void 0);
      throw err;
    }
  }

  /**
   * Check if blob exists
   */
  has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }
}
