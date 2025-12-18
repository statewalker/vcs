/**
 * Temporary content storage for two-phase streaming
 *
 * When storing Git objects with unknown size, content must be buffered
 * to determine the size before the header can be written. TempStore
 * provides an abstraction for this buffering that can be implemented
 * with memory, files, or a hybrid approach.
 */

/**
 * Handle to temporarily stored content
 */
export interface TempContent {
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
 * Temporary content storage interface
 *
 * Implementations:
 * - MemoryTempStore: Buffers in memory (simple, for small content)
 * - FileTempStore: Writes to temp files (for large content)
 * - HybridTempStore: Memory until threshold, then spills to file
 */
export interface TempStore {
  /**
   * Store content stream temporarily
   *
   * The content is fully consumed and stored. Returns a handle
   * with the total size and ability to re-read the content.
   *
   * @param content Async iterable of content chunks
   * @returns Handle with size and ability to re-read content
   */
  store(content: AsyncIterable<Uint8Array>): Promise<TempContent>;
}
