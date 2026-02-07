/**
 * Git blob store implementation
 *
 * Thin wrapper over GitObjectStore for blob operations.
 * Blobs are the simplest object type - just raw binary content.
 *
 * @module
 */

import type { ObjectId } from "../../common/id/index.js";
import type { Blobs } from "../../history/blobs/blobs.js";
import type { GitObjectStore } from "../../history/objects/object-store.js";

/**
 * Git blob store implementation
 *
 * Wraps GitObjectStore to provide blob-specific operations.
 * Implements the Blobs interface for use with History.
 */
export class GitBlobs implements Blobs {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store blob content
   *
   * Content is serialized with Git object header and stored.
   *
   * @param content Blob content as byte stream
   * @returns ObjectId (SHA-1 hash)
   */
  store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.objects.store("blob", content);
  }

  /**
   * Load blob content
   *
   * Returns undefined if blob doesn't exist.
   *
   * @param id Blob object ID
   * @returns Streaming content if found, undefined otherwise
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
   * Remove blob from storage
   *
   * @param id Blob object ID
   * @returns True if removed, false if didn't exist
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  /**
   * Check if blob exists
   *
   * @param id Blob object ID
   * @returns True if blob exists
   */
  has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }

  /**
   * Iterate over all blob object IDs
   *
   * Filters objects by type, yielding only blobs.
   *
   * @returns AsyncIterable of blob ObjectIds
   */
  async *keys(): AsyncIterable<ObjectId> {
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
   *
   * @param id Blob object ID
   * @returns Size in bytes
   * @throws Error if blob not found or not a blob type
   */
  async size(id: ObjectId): Promise<number> {
    const header = await this.objects.getHeader(id);
    if (header.type !== "blob") {
      throw new Error(`Object ${id} is not a blob (found type: ${header.type})`);
    }
    return header.size;
  }
}

/**
 * Create a GitBlobs instance
 *
 * @param objects GitObjectStore to wrap
 * @returns GitBlobs instance
 */
export function createGitBlobs(objects: GitObjectStore): Blobs {
  return new GitBlobs(objects);
}
