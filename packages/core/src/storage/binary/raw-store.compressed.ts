/**
 * Compressed RawStore wrapper
 *
 * Wraps any RawStore with zlib deflate/inflate compression.
 * Content is compressed on store() and decompressed on load().
 *
 * This is useful for Git-compatible loose object storage where
 * objects are stored compressed on disk.
 */

import { deflate, inflate, slice } from "@statewalker/vcs-utils";
import type { RawStore } from "./raw-store.js";

/**
 * Options for CompressedRawStore
 */
export interface CompressedRawStoreOptions {
  /**
   * Use raw DEFLATE (no zlib header) instead of ZLIB format.
   * Git uses ZLIB format (raw: false), which is the default.
   */
  raw?: boolean;
}

/**
 * RawStore wrapper that adds zlib compression
 *
 * Compresses content before delegating to the underlying store.
 * Decompresses content when loading from the underlying store.
 *
 * Example usage for Git loose objects:
 * ```typescript
 * const files = new FileRawStore(filesApi, ".git/objects");
 * const compressed = new CompressedRawStore(files);
 * // Objects are now stored compressed in .git/objects/XX/YYYY...
 * ```
 */
export class CompressedRawStore implements RawStore {
  private readonly raw: boolean;

  /**
   * Create a compressed raw store wrapper
   *
   * @param inner The underlying store to wrap
   * @param options Compression options
   */
  constructor(
    private readonly inner: RawStore,
    options?: CompressedRawStoreOptions,
  ) {
    this.raw = options?.raw ?? false;
  }

  /**
   * Store byte stream with compression
   *
   * Content is deflated before being stored in the underlying store.
   *
   * @param key Storage key
   * @param content Uncompressed content stream
   * @returns Number of compressed bytes stored
   */
  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    const compressed = deflate(content, { raw: this.raw });
    return this.inner.store(key, compressed);
  }

  /**
   * Load byte stream with decompression
   *
   * Content is inflated after loading from the underlying store.
   *
   * @param key Storage key
   * @param options Range options (applied to decompressed content)
   * @returns Decompressed content stream
   */
  async *load(
    key: string,
    options?: { offset?: number; length?: number },
  ): AsyncGenerator<Uint8Array> {
    // Load compressed data from underlying store
    const compressed = this.inner.load(key);

    // Decompress
    const decompressed = inflate(compressed, { raw: this.raw });

    // Apply range if specified
    if (options?.offset || options?.length) {
      yield* slice(decompressed, options.offset ?? 0, options.length);
    } else {
      yield* decompressed;
    }
  }

  /**
   * Check if key exists in underlying store
   */
  async has(key: string): Promise<boolean> {
    return this.inner.has(key);
  }

  /**
   * Delete content by key from underlying store
   */
  async delete(key: string): Promise<boolean> {
    return this.inner.delete(key);
  }

  /**
   * List all keys from underlying store
   */
  async *keys(): AsyncIterable<string> {
    yield* this.inner.keys();
  }

  /**
   * Get uncompressed content size for a key
   *
   * Note: This requires reading and decompressing the content to get the
   * actual uncompressed size. For performance, consider caching sizes
   * if you need to call this frequently.
   *
   * @param key Storage key
   * @returns Uncompressed content size, or -1 if key not found
   */
  async size(key: string): Promise<number> {
    if (!(await this.inner.has(key))) {
      return -1;
    }
    // Must decompress to get actual size
    try {
      const content = this.load(key);
      let length = 0;
      for await (const chunk of content) {
        length += chunk.length;
      }
      return length;
    } catch {
      return -1;
    }
  }
}

/**
 * Create a compressed raw store wrapper
 *
 * @param store The underlying store to wrap
 * @param options Compression options
 */
export function createCompressedRawStore(
  store: RawStore,
  options?: CompressedRawStoreOptions,
): CompressedRawStore {
  return new CompressedRawStore(store, options);
}
