/**
 * Git object store implementation
 *
 * Unified implementation for all Git object types (blob, commit, tree, tag).
 * Uses VolatileStore for buffering unknown-size content and RawStore for persistence.
 */

import { Sha1 } from "@webrun-vcs/utils/hash/sha1";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import type { RawStore } from "../../binary-storage/interfaces/raw-store.js";
import type { VolatileStore } from "../../binary-storage/volatile/volatile-store.js";
import { parseHeader, stripHeader } from "../../format/object-header.js";
import type { ObjectId, ObjectTypeString } from "../../interfaces/types.js";

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
 * Git object store
 *
 * This is the core implementation that handles:
 * - Header format ("type size\0content")
 * - SHA-1 hashing over complete object
 * - Two-phase storage for unknown-size content
 */
export class GitObjectStore {
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
  async store(type: ObjectTypeString, content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
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

    async function* generateObject(): AsyncIterable<Uint8Array> {
      for (const chunk of chunks) {
        yield chunk;
      }
    }

    await this.storage.store(id, generateObject());
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
    const firstChunk = await getFirstChunk(raw);

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

/**
 * Get the first chunk from an async iterable
 */
async function getFirstChunk(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array | undefined> {
  for await (const chunk of stream) {
    return chunk;
  }
  return undefined;
}
