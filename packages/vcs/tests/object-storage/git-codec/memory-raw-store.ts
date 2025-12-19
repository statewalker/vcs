/**
 * In-memory RawStore implementation for testing
 */

import type { RawStore } from "../../../src/binary-storage/interfaces/raw-store.js";
import { collect } from "../../../src/format/stream-utils.js";

/**
 * Simple in-memory storage for testing the new RawStore interface
 */
export class MemoryRawStore implements RawStore {
  private readonly data = new Map<string, Uint8Array>();

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    const bytes = await collect(content);
    this.data.set(key, bytes);
    return bytes.length;
  }

  async *load(key: string): AsyncIterable<Uint8Array> {
    const bytes = this.data.get(key);
    if (!bytes) {
      throw new Error(`Key not found: ${key}`);
    }
    yield bytes;
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async *keys(): AsyncIterable<string> {
    for (const key of this.data.keys()) {
      yield key;
    }
  }

  async size(key: string): Promise<number | undefined> {
    const bytes = this.data.get(key);
    return bytes?.length;
  }

  /** Get stored data for inspection */
  getData(): Map<string, Uint8Array> {
    return this.data;
  }
}
