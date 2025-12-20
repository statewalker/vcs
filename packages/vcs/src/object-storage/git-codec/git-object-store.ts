/**
 * Git object store implementation
 *
 * Unified implementation for all Git object types (blob, commit, tree, tag).
 * Uses VolatileStore for buffering unknown-size content and RawStore for persistence.
 *
 * Git objects are stored with header: "type size\0content"
 * SHA-1 hash is computed over the full object (header + content).
 */

import { Sha1 } from "@webrun-vcs/utils/hash/sha1";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import type { RawStore } from "../../binary-storage/interfaces/raw-store.js";
import type { VolatileStore } from "../../binary-storage/volatile/volatile-store.js";
import { parseHeader, stripHeader } from "../../format/object-header.js";
import { newByteSplitter, readHeader } from "../../format/stream-utils.js";
import type { ObjectId, ObjectTypeString } from "../interfaces/index.js";

const encoder = new TextEncoder();

/**
 * Git object header information
 */
export interface GitObjectHeader {
  /** Object type */
  type: ObjectTypeString;
  /** Content size in bytes */
  size: number;
}

/**
 * Unified Git object storage interface
 *
 * Single implementation handles all object types (blob, commit, tree, tag).
 * The only difference between types is the header prefix string.
 * This eliminates the N×M implementation matrix (N types × M backends).
 *
 * Handles header format, SHA-1 hashing, and storage for all object types.
 * Uses TempStore internally for unknown-size content.
 */
export interface GitObjectStore {
  /**
   * Store content with unknown size
   *
   * Uses TempStore internally to buffer content and determine size
   * before computing the hash and writing the object.
   *
   * @param type Object type
   * @param content Async iterable of content chunks (without header)
   * @returns ObjectId (SHA-1 hash of header + content)
   */
  store(type: ObjectTypeString, content: AsyncIterable<Uint8Array>): Promise<ObjectId>;

  /**
   * Store content with known size (optimized path)
   *
   * Direct streaming without temporary storage. The caller must
   * provide the exact size; content will be verified.
   *
   * @param type Object type
   * @param size Content size in bytes
   * @param content Async iterable of content chunks (without header)
   * @returns ObjectId (SHA-1 hash of header + content)
   * @throws Error if actual content size doesn't match declared size
   */
  storeWithSize(
    type: ObjectTypeString,
    size: number,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ObjectId>;

  /**
   * Load object content (header stripped)
   *
   * @param id ObjectId of the object
   * @returns Async iterable of content chunks (without header)
   * @throws Error if object not found
   */
  load(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Load raw object including header
   *
   * @param id ObjectId of the object
   * @returns Async iterable of raw object chunks (with header)
   * @throws Error if object not found
   */
  loadRaw(id: ObjectId): AsyncIterable<Uint8Array>;

  /**
   * Get object header without loading content
   *
   * @param id ObjectId of the object
   * @returns Object type and content size
   * @throws Error if object not found
   */
  getHeader(id: ObjectId): Promise<GitObjectHeader>;

  /**
   * Check if object exists
   *
   * @param id ObjectId of the object
   * @returns True if object exists
   */
  has(id: ObjectId): Promise<boolean>;

  /**
   * Delete object
   *
   * @param id ObjectId of the object
   * @returns True if object was deleted, false if it didn't exist
   */
  delete(id: ObjectId): Promise<boolean>;

  /**
   * List all object IDs
   *
   * @returns Async iterable of all object IDs
   */
  list(): AsyncIterable<ObjectId>;
}

/**
 * Git object store
 *
 * This is the core implementation that handles:
 * - Header format ("type size\0content")
 * - SHA-1 hashing over complete object
 * - Two-phase storage for unknown-size content
 */
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
  async storeWithSize(
    type: ObjectTypeString,
    size: number,
    content: AsyncIterable<Uint8Array>,
  ): Promise<ObjectId> {
    const header = encoder.encode(`${type} ${size}\0`);
    const hasher = new Sha1();
    hasher.update(header);

    const chunks: Uint8Array[] = [header];
    let actualSize = 0;

    for await (const chunk of content) {
      hasher.update(chunk);
      chunks.push(chunk);
      actualSize += chunk.length;
    }

    if (actualSize !== size) {
      throw new Error(`Size mismatch: declared ${size} bytes but received ${actualSize} bytes`);
    }

    const id = bytesToHex(hasher.finalize());
    await this.storage.store(id, chunks);
    return id;
  }

  /**
   * Load object content (header stripped)
   */
  async *load(id: ObjectId): AsyncIterable<Uint8Array> {
    yield* stripHeader(this.storage.load(id));
  }

  /**
   * Load raw object including header
   */
  async *loadRaw(id: ObjectId): AsyncIterable<Uint8Array> {
    yield* this.storage.load(id);
  }

  /**
   * Get object header without loading full content
   */
  async getHeader(id: ObjectId): Promise<GitObjectHeader> {
    const raw = this.storage.load(id);

    const [firstChunk, it] = await readHeader(raw, newByteSplitter(0x00));
    await it.return?.(void 0); // Close the iterator to free resources
    if (!firstChunk) {
      throw new Error(`Object not found: ${id}`);
    }

    const parsed = parseHeader(firstChunk);
    return {
      type: parsed.type,
      size: parsed.size,
    };
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
