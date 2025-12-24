import { Sha1 } from "@webrun-vcs/utils/hash/sha1";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import type { RawStore } from "../binary/raw-store.js";
import type { VolatileStore } from "../binary/volatile-store.js";
import type { ObjectId } from "../id/index.js";
import { loadWithHeader } from "./load-with-header.js";
import { encodeObjectHeader } from "./object-header.js";
import type { GitObjectHeader, GitObjectStore } from "./object-store.js";
import type { ObjectTypeString } from "./object-types.js";

export class GitObjectStoreImpl implements GitObjectStore {
  /**
   * Create a Git object store
   *
   * @param volatile Volatile storage for buffering unknown-size content
   * @param storage Raw storage backend for persisted objects
   */
  constructor(
    private readonly volatile: VolatileStore,
    private readonly storage: RawStore,
  ) {}

  /**
   * Store content with unknown size
   *
   * Uses VolatileStore to buffer content and determine size before
   * computing hash and storing the object.
   */
  async store(
    type: ObjectTypeString,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<ObjectId> {
    const buffered = await this.volatile.store(content);
    try {
      return await this.storeWithSize(type, buffered.size, buffered.read());
    } finally {
      await buffered.dispose();
    }
  }

  /**
   * Store content with known size (optimized path)
   *
   * Computes hash while streaming content to storage.
   * Use this when content size is known upfront (e.g., commits, trees, tags).
   */
  private async storeWithSize(
    type: ObjectTypeString,
    size: number,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ObjectId> {
    // Move content to a termporary storage (volatile)
    // to compute hash and size of the full content (header + body).
    const header = encodeObjectHeader(type, size);
    const hasher = new Sha1();
    const fullContent = (async function* prependedStream(
      content: AsyncIterable<Uint8Array>,
    ): AsyncIterable<Uint8Array> {
      hasher.update(header);
      yield header;
      for await (const chunk of content) {
        hasher.update(chunk);
        yield chunk;
      }
    })(content);
    let id: ObjectId;
    // Store the full content in volatile storage first
    const bufferedWithHash = await this.volatile.store(fullContent);
    try {
      // Compute final hash
      id = bytesToHex(hasher.finalize());
      // Compress and store in raw storage
      const bufferedContent = bufferedWithHash.read();
      await this.storage.store(id, bufferedContent);
    } finally {
      await bufferedWithHash.dispose();
    }

    return id;
  }

  /**
   * Load object content (header stripped)
   */
  async *load(id: ObjectId): AsyncGenerator<Uint8Array> {
    const [, content] = await this.loadWithHeader(id);
    yield* content;
  }

  /**
   * Get object header and content stream
   * @param id ObjectId of the object
   * @returns Tuple of object header and async iterable of content chunks
   * @throws Error if object not found
   */
  async loadWithHeader(id: ObjectId): Promise<[GitObjectHeader, AsyncGenerator<Uint8Array>]> {
    const raw = this.loadRaw(id);
    return await loadWithHeader(raw);
  }

  /**
   * Load raw object including header
   */
  async *loadRaw(id: ObjectId): AsyncGenerator<Uint8Array> {
    yield* this.storage.load(id);
  }

  /**
   * Get object header without loading full content
   */
  async getHeader(id: ObjectId): Promise<GitObjectHeader> {
    const [header, content] = await this.loadWithHeader(id);
    await content?.return?.(void 0); // Close the iterator to free resources
    return header;
  }

  /**
   * Check if object exists
   */
  has(id: ObjectId): Promise<boolean> {
    return this.storage.has(id);
  }

  /**
   * Delete object
   */
  delete(id: ObjectId): Promise<boolean> {
    return this.storage.delete(id);
  }

  /**
   * List all object IDs
   */
  async *list(): AsyncIterable<ObjectId> {
    yield* this.storage.keys();
  }
}
