/**
 * Raw byte storage interface
 *
 * Low-level storage abstraction for storing bytes by key.
 * This is the foundation layer for GitObjectStore implementations.
 *
 * Implementations:
 * - MemoryRawStorage: In-memory Map<string, Uint8Array>
 * - FileRawStorage: File system with Git loose object paths
 * - SqlRawStorage: SQL database blob storage
 * - KvRawStorage: Key-value store
 */
export interface RawStorage {
  /**
   * Store byte stream under key
   *
   * If content already exists under this key, it is replaced.
   * The stream is fully consumed before returning.
   *
   * @param key Storage key (typically object ID)
   * @param content Async iterable of content chunks
   */
  store(key: string, content: AsyncIterable<Uint8Array>): Promise<void>;

  /**
   * Load byte stream by key
   *
   * Returns an async iterable that yields the stored content.
   * Throws if the key does not exist.
   *
   * @param key Storage key
   * @returns Async iterable of content chunks
   * @throws Error if key not found
   */
  load(key: string): AsyncIterable<Uint8Array>;

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
}
