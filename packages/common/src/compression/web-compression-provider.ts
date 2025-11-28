/**
 * Web Compression Streams API provider
 *
 * Uses the browser's native CompressionStream API (available in modern browsers)
 * @see https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream
 */

import {
  CompressionAlgorithm,
  CompressionError,
  type CompressionOptions,
  type CompressionProvider,
  type DecompressionOptions,
} from "./types.js";

/**
 * Compression provider using Web Compression Streams API
 *
 * Note: This is async-only. For synchronous operations, use a different provider.
 */
export class WebCompressionProvider implements CompressionProvider {
  async compress(data: Uint8Array, options?: CompressionOptions): Promise<Uint8Array> {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.DEFLATE;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    try {
      // Map our algorithm enum to CompressionStream format
      const format = algorithm === CompressionAlgorithm.GZIP ? "gzip" : "deflate";

      const stream = new CompressionStream(format);
      const writer = stream.writable.getWriter();
      writer.write(data as unknown as BufferSource);
      writer.close();

      const chunks: Uint8Array[] = [];
      const reader = stream.readable.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks
      const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;
    } catch (error) {
      throw new CompressionError(`Web compression failed: ${error}`, error);
    }
  }

  async decompress(data: Uint8Array, options?: DecompressionOptions): Promise<Uint8Array> {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.DEFLATE;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    try {
      // Map our algorithm enum to DecompressionStream format
      const format = algorithm === CompressionAlgorithm.GZIP ? "gzip" : "deflate";

      const stream = new DecompressionStream(format);
      const writer = stream.writable.getWriter();
      writer.write(data as unknown as BufferSource);
      writer.close();

      const chunks: Uint8Array[] = [];
      const reader = stream.readable.getReader();
      let totalSize = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalSize += value.length;

        // Check max size limit
        if (options?.maxSize && totalSize > options.maxSize) {
          throw new CompressionError(
            `Decompressed size (${totalSize}) exceeds maximum allowed (${options.maxSize})`,
          );
        }

        chunks.push(value);
      }

      // Combine chunks
      const result = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      return result;
    } catch (error) {
      if (error instanceof CompressionError) throw error;
      throw new CompressionError(`Web decompression failed: ${error}`, error);
    }
  }

  compressSync(_data: Uint8Array, _options?: CompressionOptions): Uint8Array {
    throw new Error("WebCompressionProvider does not support synchronous compression");
  }

  decompressSync(_data: Uint8Array, _options?: DecompressionOptions): Uint8Array {
    throw new Error("WebCompressionProvider does not support synchronous decompression");
  }

  supportsSyncOperations(): boolean {
    return false;
  }
}
