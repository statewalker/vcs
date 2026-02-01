import { deflate, inflate } from "@statewalker/vcs-utils";
import { Sha1 } from "@statewalker/vcs-utils/hash/sha1";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import type { ObjectId } from "../../common/id/index.js";
import type { VolatileStore } from "../../storage/binary/volatile-store.js";
import { MemoryVolatileStore } from "../../storage/binary/volatile-store.memory.js";
import type { RawStorage } from "../../storage/raw/raw-storage.js";
import { loadWithHeader } from "./load-with-header.js";
import { encodeObjectHeader } from "./object-header.js";
import type { GitObjectHeader, GitObjectStore, GitObjectStoreOptions } from "./object-store.js";
import type { ObjectTypeString } from "./object-types.js";

/**
 * Git object store implementation using RawStorage
 *
 * This implementation uses the new RawStorage interface for storing Git objects.
 * It supports optional compression (needed for Git-compatible file storage).
 */
export class GitObjectStoreImpl implements GitObjectStore {
  private readonly volatile: VolatileStore;
  private readonly storage: RawStorage;
  private readonly compress: boolean;

  /**
   * Create a Git object store
   *
   * @param options Configuration options including storage backend
   */
  constructor(options: GitObjectStoreOptions) {
    this.storage = options.storage;
    this.volatile = options.volatile ?? new MemoryVolatileStore();
    this.compress = options.compress ?? false;
  }

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
    // Build the Git object: header + content, computing hash as we go
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

    // Store the full content in volatile storage first to compute hash
    const bufferedWithHash = await this.volatile.store(fullContent);
    let id: ObjectId;
    try {
      // Compute final hash
      id = bytesToHex(hasher.finalize());

      // Get content stream to store
      let contentToStore: AsyncIterable<Uint8Array> = bufferedWithHash.read();

      // Apply compression if needed
      if (this.compress) {
        contentToStore = deflate(contentToStore, { raw: false });
      }

      // Store in raw storage
      await this.storage.store(id, contentToStore);
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
    let content: AsyncIterable<Uint8Array> = this.storage.load(id);

    // Decompress if compression is enabled
    if (this.compress) {
      content = inflate(content, { raw: false });
    }

    yield* content;
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
   * Remove object
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.storage.remove(id);
  }

  /**
   * List all object IDs
   */
  async *list(): AsyncIterable<ObjectId> {
    yield* this.storage.keys();
  }
}
