/**
 * In-memory RawStore implementation for testing
 */

import { slice } from "@webrun-vcs/utils";
import type { RawStore } from "../raw-store.js";

/**
 * Simple in-memory storage for testing the new RawStore interface
 */
export class MemoryRawStore implements RawStore {
  private readonly data = new Map<string, Uint8Array[]>();

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of content) {
      chunks.push(chunk);
      size += chunk.length;
    }
    this.data.set(key, chunks);
    return size;
  }

  async *load(
    key: string,
    options?: { offset?: number; length?: number },
  ): AsyncGenerator<Uint8Array> {
    const bytes = this.data.get(key);
    if (!bytes) {
      throw new Error(`Key not found: ${key}`);
    }
    if (options?.offset || options?.length) {
      yield* slice(bytes, options.offset ?? 0, options.length);
    } else {
      yield* bytes;
    }
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

  async size(key: string): Promise<number> {
    const chunks = this.data.get(key);
    if (!chunks) return -1;
    return chunks.reduce((total, chunk) => total + chunk.length, 0);
  }

  /** Get stored data for inspection */
  getData(): Map<string, Uint8Array[]> {
    return this.data;
  }
}
