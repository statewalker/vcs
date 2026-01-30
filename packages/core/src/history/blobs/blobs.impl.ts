/**
 * Blobs implementation using RawStorage
 *
 * This implementation stores blob content DIRECTLY in RawStorage WITHOUT Git object headers.
 * The SHA-1 hash is computed WITH the "blob <size>\0" prefix for Git compatibility,
 * but only the raw content is stored.
 *
 * This approach provides:
 * 1. Git-compatible object IDs (same as git hash-object)
 * 2. Efficient storage (no header overhead)
 * 3. Streaming support for large files
 */

import { Sha1 } from "@statewalker/vcs-utils/hash/sha1";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import type { ObjectId } from "../../common/id/index.js";
import type { RawStorage } from "../../storage/raw/raw-storage.js";
import type { BlobContent, Blobs } from "./blobs.js";

/**
 * Storage-agnostic Blobs implementation
 *
 * Stores blob content directly in RawStorage without Git object headers.
 * The SHA-1 hash is computed as if headers were present (for Git compatibility).
 */
export class BlobsImpl implements Blobs {
  constructor(private readonly storage: RawStorage) {}

  /**
   * Store blob content
   *
   * Content is collected to compute the size, then hashed with the Git blob
   * header prefix, but stored WITHOUT the header.
   *
   * @param content Blob content as byte stream
   * @returns SHA-1 hash of the blob content (computed with "blob <size>\0" prefix)
   */
  async store(content: BlobContent | Iterable<Uint8Array>): Promise<ObjectId> {
    // Collect content to compute size and hash
    const chunks: Uint8Array[] = [];
    let totalSize = 0;

    for await (const chunk of toAsyncIterable(content)) {
      chunks.push(chunk);
      totalSize += chunk.length;
    }

    // Compute SHA-1 with Git blob header ("blob <size>\0" + content)
    const id = computeBlobHash(chunks, totalSize);

    // Check if already exists (content-addressed deduplication)
    if (await this.storage.has(id)) {
      return id;
    }

    // Store raw content (no headers)
    await this.storage.store(id, toAsyncIterable(chunks));

    return id;
  }

  /**
   * Load blob content
   *
   * Returns a streaming AsyncIterable to avoid loading large files
   * entirely into memory.
   *
   * @param id Blob object ID
   * @returns Streaming content if found, undefined otherwise
   */
  async load(id: ObjectId): Promise<BlobContent | undefined> {
    if (!(await this.storage.has(id))) {
      return undefined;
    }

    // Return streaming content from storage
    return this.storage.load(id);
  }

  /**
   * Check if blob exists
   *
   * @param id Blob object ID
   * @returns True if blob exists
   */
  has(id: ObjectId): Promise<boolean> {
    return this.storage.has(id);
  }

  /**
   * Remove a blob
   *
   * @param id Blob object ID
   * @returns True if blob was removed, false if it didn't exist
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.storage.remove(id);
  }

  /**
   * Iterate over all stored blob IDs
   *
   * @returns AsyncIterable of all blob object IDs
   */
  async *keys(): AsyncIterable<ObjectId> {
    yield* this.storage.keys();
  }

  /**
   * Get blob size without loading content
   *
   * @param id Blob object ID
   * @returns Size in bytes, or -1 if blob not found
   */
  size(id: ObjectId): Promise<number> {
    return this.storage.size(id);
  }
}

/**
 * Compute SHA-1 hash with Git blob header
 *
 * Hash is computed as: SHA1("blob <size>\0" + content)
 * This ensures Git-compatible object IDs.
 *
 * @param chunks Content chunks
 * @param size Total content size in bytes
 * @returns 40-character hex SHA-1 hash
 */
function computeBlobHash(chunks: Uint8Array[], size: number): ObjectId {
  const header = new TextEncoder().encode(`blob ${size}\0`);
  const hasher = new Sha1();

  hasher.update(header);
  for (const chunk of chunks) {
    hasher.update(chunk);
  }

  return bytesToHex(hasher.finalize());
}

/**
 * Convert sync or async iterable to async iterable
 *
 * This utility allows the store() method to accept both sync and async
 * iterables for convenience.
 */
async function* toAsyncIterable(
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  if (Symbol.asyncIterator in content) {
    yield* content as AsyncIterable<Uint8Array>;
  } else {
    for (const chunk of content as Iterable<Uint8Array>) {
      yield chunk;
    }
  }
}

/**
 * Create a Blobs instance backed by RawStorage
 *
 * @param storage RawStorage implementation to use for persistence
 * @returns Blobs instance
 *
 * @example
 * ```typescript
 * import { MemoryRawStorage } from "../storage/raw/index.js";
 * import { createBlobs } from "./blobs.impl.js";
 *
 * const storage = new MemoryRawStorage();
 * const blobs = createBlobs(storage);
 *
 * const id = await blobs.store([new TextEncoder().encode("Hello, World!")]);
 * const content = await blobs.load(id);
 * ```
 */
export function createBlobs(storage: RawStorage): Blobs {
  return new BlobsImpl(storage);
}
