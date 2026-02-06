/**
 * Git blob store implementation
 *
 * Thin wrapper over GitObjectStore for blob operations.
 * Blobs are the simplest object type - just raw binary content.
 * Implements both BlobStore (legacy) and Blobs (new) interfaces.
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import type { BlobStore } from "./blob-store.js";
import type { Blobs } from "./blobs.js";

/**
 * Git blob store implementation
 *
 * Delegates all operations to GitObjectStore with "blob" type.
 * Implements both BlobStore (legacy) and Blobs (new) interfaces.
 */
export class GitBlobStore implements BlobStore, Blobs {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store blob with unknown size
   */
  store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.objects.store("blob", content);
  }

  /**
   * Load blob content (Blobs interface)
   * Returns undefined if blob doesn't exist.
   */
  async load(id: ObjectId): Promise<AsyncIterable<Uint8Array> | undefined> {
    if (!(await this.objects.has(id))) {
      return undefined;
    }
    const self = this;
    return (async function* () {
      yield* self.loadContent(id);
    })();
  }

  /**
   * Load blob content (internal implementation)
   */
  private async *loadContent(id: ObjectId): AsyncGenerator<Uint8Array> {
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
   * Remove blob (new interface)
   */
  async remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  /**
   * Check if blob exists
   */
  has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }

  /**
   * List all blob object IDs
   *
   * Iterates over all objects in storage and yields only those
   * that are blobs. Used for GC and storage analysis.
   */
  async *keys(): AsyncGenerator<ObjectId> {
    for await (const id of this.objects.list()) {
      try {
        const header = await this.objects.getHeader(id);
        if (header.type === "blob") {
          yield id;
        }
      } catch {
        // Skip objects that can't be read (corrupted, etc.)
      }
    }
  }

  /**
   * Get blob size in bytes
   */
  async size(id: ObjectId): Promise<number> {
    const header = await this.objects.getHeader(id);
    if (header.type !== "blob") {
      throw new Error(`Object ${id} is not a blob (found type: ${header.type})`);
    }
    return header.size;
  }

  /**
   * Delete a blob from storage (legacy interface)
   */
  delete(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }
}
