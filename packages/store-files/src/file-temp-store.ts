/**
 * File-based temporary content storage
 *
 * Stores temporary content in files, allowing for memory-efficient
 * handling of large content that exceeds available memory.
 */

import { type FilesApi, joinPath } from "@statewalker/webrun-files";
import type { TempContent, TempStore } from "@webrun-vcs/vcs";

/**
 * File-based temporary storage
 *
 * Writes content to temporary files which can be re-read multiple times.
 * Files are deleted when dispose() is called.
 */
export class FileTempStore implements TempStore {
  private counter = 0;

  /**
   * Create file-based temp store
   *
   * @param files FilesApi for file operations
   * @param tempDir Directory for temporary files
   */
  constructor(
    private readonly files: FilesApi,
    private readonly tempDir: string,
  ) {}

  /**
   * Store content stream temporarily
   */
  async store(content: AsyncIterable<Uint8Array>): Promise<TempContent> {
    const tempPath = joinPath(this.tempDir, `temp-${Date.now()}-${this.counter++}`);

    // Ensure temp directory exists
    await this.files.mkdir(this.tempDir);

    // Track size while writing
    let size = 0;
    const chunks: Uint8Array[] = [];

    for await (const chunk of content) {
      size += chunk.length;
      chunks.push(chunk);
    }

    // Write all chunks to file
    await this.files.write(tempPath, chunks);

    let disposed = false;

    return {
      size,
      read: () => {
        if (disposed) {
          throw new Error("TempContent already disposed");
        }
        return this.readFile(tempPath);
      },
      dispose: async () => {
        if (!disposed) {
          disposed = true;
          try {
            await this.files.remove(tempPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      },
    };
  }

  /**
   * Read file as async iterable
   */
  private async *readFile(path: string): AsyncIterable<Uint8Array> {
    const bytes = await this.files.readFile(path);
    yield bytes;
  }
}
