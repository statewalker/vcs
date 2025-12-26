import type { DeltaStore } from "../delta/index.js";

/**
 * Raw byte storage interface
 *
 * Low-level storage abstraction for storing bytes by key.
 * This is the foundation layer for Git object storage.
 *
 * Implementations handle compression internally:
 * - Git-compatible stores apply ZLIB compression
 * - Other stores may use different compression or none
 *
 * Higher-level APIs receive/provide uncompressed data.
 */
export interface RawStore {
  /**
   * Store byte stream under key
   *
   * If content already exists under this key, it is replaced.
   * The stream is fully consumed before returning.
   *
   * @param key Storage key (typically object ID)
   * @param content Async iterable of content chunks
   * @returns Number of bytes stored (may differ from input if compressed)
   */
  store(key: string, content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<number>;

  /**
   * Load byte stream by key
   *
   * Returns an async iterable that yields the stored content.
   * Throws if the key does not exist.
   *
   * @param key Storage key
   * @param options Optional range to load (offset and length in bytes)
   * @param options.offset byte offset (inclusive); defaults to 0
   * @param options.length Number of bytes to read  (from offset); defaults to rest of content
   * @returns Async iterable of content chunks
   * @throws Error if key not found
   */
  load(key: string, options?: { offset?: number; length?: number }): AsyncGenerator<Uint8Array>;

  /**
   * Check if key exists
   *
   * @param key Storage key
   * @returns True if content exists for this key
   */
  has(key: string): Promise<boolean>;

  /**
   * Delete content by key
   *
   * @param key Storage key
   * @returns True if content was deleted, false if key didn't exist
   */
  delete(key: string): Promise<boolean>;

  /**
   * List all keys
   *
   * @returns Async iterable of all storage keys
   */
  keys(): AsyncIterable<string>;

  /**
   * Get content size for a key
   *
   * Returns the uncompressed content size.
   *
   * @param key Storage key
   * @returns Content size in bytes, or -1 if key not found
   */
  size(key: string): Promise<number>;
}

/**
 * Binary storage combining raw and delta stores
 *
 * This is the main abstraction for binary object storage.
 * It combines raw byte storage with delta compression support.
 */
export interface BinStore {
  /** Store name identifier */
  readonly name: string;
  /** Raw byte storage */
  readonly raw: RawStore;
  /** Delta-compressed storage */
  readonly delta: DeltaStore;
  /** Flush pending writes to persistent storage */
  flush(): Promise<void>;
  /** Close backend and release resources */
  close(): Promise<void>;
  /** Refresh backend state (clear caches, etc.) */
  refresh(): Promise<void>;
}
