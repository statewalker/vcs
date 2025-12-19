/**
 * Handle to volatile (temporarily buffered) content
 *
 * Volatile content is short-lived - it exists only during object creation
 * to buffer streaming content and compute its size before the final
 * storage operation.
 */
export interface VolatileContent {
  /** Total size of stored content in bytes */
  readonly size: number;

  /**
   * Read stored content as stream
   *
   * Can be called multiple times to re-read the content.
   *
   * @returns Async iterable of content chunks
   */
  read(): AsyncIterable<Uint8Array>;

  /**
   * Release resources (delete temp file, free memory)
   *
   * After dispose is called, read() should not be called.
   */
  dispose(): Promise<void>;
}

/**
 * Volatile content storage interface
 *
 * Buffers streaming content and computes size during storage.
 * The name "volatile" reflects its purpose: short-lived streaming
 * buffers that exist only during object creation.
 *
 * Implementations:
 * - MemoryVolatileStore: Buffers in memory (vcs package, for small content)
 * - FileVolatileStore: Writes to temp files (store-files package, for large content)
 * - HybridVolatileStore: Memory until threshold, then spills to file
 */
export interface VolatileStore {
  /**
   * Store content stream temporarily
   *
   * The content is fully consumed and stored. Computes size during storage.
   * Returns a handle with size and ability to re-read the content.
   *
   * @param content Async iterable of content chunks
   * @returns Handle with size and ability to re-read content
   */
  store(content: AsyncIterable<Uint8Array>): Promise<VolatileContent>;
}
