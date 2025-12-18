/**
 * In-memory RawStorage implementation for testing
 */

import type { RawStorage } from "../../src/interfaces/raw-storage.js";
import { collect } from "../../src/format/stream-utils.js";

/**
 * Simple in-memory storage for testing
 */
export class MemoryRawStorage implements RawStorage {
  private readonly data = new Map<string, Uint8Array>();

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    const bytes = await collect(content);
    this.data.set(key, bytes);
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

  /** Get stored data for inspection */
  getData(): Map<string, Uint8Array> {
    return this.data;
  }
}
