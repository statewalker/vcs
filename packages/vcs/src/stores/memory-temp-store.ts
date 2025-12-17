/**
 * In-memory temporary content storage
 *
 * Simple implementation that buffers all content in memory.
 * Best for small content or when memory is not constrained.
 */

import type { TempContent, TempStore } from "../interfaces/temp-store.js";

/**
 * Memory-based temporary storage
 *
 * Stores content in memory arrays. The stored content can be
 * re-read multiple times until disposed.
 */
export class MemoryTempStore implements TempStore {
  /**
   * Store content stream temporarily in memory
   *
   * @param content Async iterable of content chunks
   * @returns Handle with size and ability to re-read content
   */
  async store(content: AsyncIterable<Uint8Array>): Promise<TempContent> {
    const chunks: Uint8Array[] = [];
    let size = 0;

    for await (const chunk of content) {
      chunks.push(chunk);
      size += chunk.length;
    }

    let disposed = false;

    return {
      size,
      read() {
        if (disposed) {
          throw new Error("TempContent already disposed");
        }
        return (async function* () {
          for (const c of chunks) {
            yield c;
          }
        })();
      },
      async dispose() {
        disposed = true;
        chunks.length = 0;
      },
    };
  }
}
