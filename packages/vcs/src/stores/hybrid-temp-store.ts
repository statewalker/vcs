/**
 * Hybrid temporary content storage
 *
 * Composes two TempStores - uses small store until threshold,
 * then spills to large store. This allows memory-efficient handling
 * of large content while keeping small content fast.
 */

import type { TempContent, TempStore } from "../interfaces/temp-store.js";

/**
 * Hybrid temp store that spills to a backing store when content exceeds threshold
 *
 * Use cases:
 * - Small content stays in memory (fast)
 * - Large content spills to file system (memory efficient)
 */
export class HybridTempStore implements TempStore {
  /**
   * Create a hybrid temp store
   *
   * @param smallStore Store for content under threshold (typically MemoryTempStore)
   * @param largeStore Store for content over threshold (typically FileTempStore)
   * @param threshold Size in bytes before spilling (default 1MB)
   */
  constructor(
    private readonly smallStore: TempStore,
    private readonly largeStore: TempStore,
    private readonly threshold: number = 1024 * 1024,
  ) {}

  /**
   * Store content stream temporarily
   *
   * If content exceeds threshold during streaming, it spills to the large store.
   *
   * @param content Async iterable of content chunks
   * @returns Handle with size and ability to re-read content
   */
  async store(content: AsyncIterable<Uint8Array>): Promise<TempContent> {
    const chunks: Uint8Array[] = [];
    let size = 0;

    // Use explicit iterator to allow continuing iteration after spill
    const iterator = content[Symbol.asyncIterator]();

    while (true) {
      const { done, value: chunk } = await iterator.next();
      if (done) break;

      size += chunk.length;

      if (size > this.threshold) {
        // Spill: combine existing chunks with current chunk and remaining iterator
        return this.largeStore.store(this.combineWithRemaining(chunks, chunk, iterator));
      }

      chunks.push(chunk);
    }

    // Content fits under threshold - use small store
    return this.smallStore.store(this.toAsyncIterable(chunks));
  }

  /**
   * Combine already-buffered chunks with current and remaining content
   */
  private async *combineWithRemaining(
    buffered: Uint8Array[],
    current: Uint8Array,
    remaining: AsyncIterator<Uint8Array>,
  ): AsyncIterable<Uint8Array> {
    for (const chunk of buffered) {
      yield chunk;
    }
    yield current;

    // Continue consuming from the existing iterator
    while (true) {
      const { done, value } = await remaining.next();
      if (done) break;
      yield value;
    }
  }

  /**
   * Convert array of chunks to async iterable
   */
  private async *toAsyncIterable(chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
}
