/**
 * Key-value based RawStorage implementation
 *
 * Wraps any KVStore to implement the RawStorage interface.
 * Stores binary content directly in the key-value store.
 */

import type { RawStorage } from "@webrun-vcs/vcs";
import type { KVStore } from "./kv-store.js";

/**
 * Collect async iterable to Uint8Array
 */
async function collect(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of input) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * KV-based storage implementation
 *
 * Stores content directly in the key-value store.
 * Uses optional prefix to namespace keys.
 */
export class KvRawStorage implements RawStorage {
  /**
   * Create KV-based storage
   *
   * @param kv Key-value store backend
   * @param prefix Optional key prefix for namespacing (default: "objects/")
   */
  constructor(
    private readonly kv: KVStore,
    private readonly prefix: string = "objects/",
  ) {}

  /**
   * Build full key with prefix
   */
  private key(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * Store byte stream under key
   */
  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    const bytes = await collect(content);
    await this.kv.set(this.key(key), bytes);
  }

  /**
   * Load byte stream by key
   */
  async *load(key: string): AsyncIterable<Uint8Array> {
    const bytes = await this.kv.get(this.key(key));
    if (!bytes) {
      throw new Error(`Key not found: ${key}`);
    }
    yield bytes;
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    return this.kv.has(this.key(key));
  }

  /**
   * Delete content by key
   */
  async delete(key: string): Promise<boolean> {
    return this.kv.delete(this.key(key));
  }

  /**
   * List all keys (without prefix)
   */
  async *keys(): AsyncIterable<string> {
    for await (const fullKey of this.kv.list(this.prefix)) {
      yield fullKey.slice(this.prefix.length);
    }
  }
}
