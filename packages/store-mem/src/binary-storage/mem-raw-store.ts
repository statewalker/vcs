/**
 * In-memory RawStore implementation
 *
 * Simple implementation that stores all content in memory.
 * Implements the new RawStore interface from binary-storage.
 */

import type { RawStore } from "@webrun-vcs/vcs/binary-storage";

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
 * In-memory storage implementation
 *
 * Stores content in a Map with string keys and Uint8Array values.
 */
export class MemRawStore implements RawStore {
  private readonly data = new Map<string, Uint8Array>();

  /**
   * Store byte stream under key
   *
   * @returns Number of bytes stored
   */
  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    const bytes = await collect(content);
    this.data.set(key, bytes);
    return bytes.length;
  }

  /**
   * Load byte stream by key
   */
  async *load(key: string): AsyncIterable<Uint8Array> {
    const bytes = this.data.get(key);
    if (!bytes) {
      throw new Error(`Key not found: ${key}`);
    }
    yield bytes;
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  /**
   * Delete content by key
   */
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  /**
   * List all keys
   */
  async *keys(): AsyncIterable<string> {
    for (const key of this.data.keys()) {
      yield key;
    }
  }

  /**
   * Get content size for a key
   */
  async size(key: string): Promise<number | undefined> {
    const bytes = this.data.get(key);
    return bytes?.length;
  }

  /**
   * Clear all stored data
   */
  clear(): void {
    this.data.clear();
  }

  /**
   * Get number of stored items
   */
  get count(): number {
    return this.data.size;
  }
}
