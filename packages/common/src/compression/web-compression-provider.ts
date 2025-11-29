/**
 * Web Compression Streams API provider
 *
 * Uses the browser's native CompressionStream API (available in modern browsers)
 * @see https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream
 *
 * Format mapping:
 * - DEFLATE (raw) -> "deflate-raw" (may not be supported in all browsers)
 * - ZLIB (with header) -> "deflate" (Web API's "deflate" is actually zlib format)
 * - GZIP -> "gzip"
 */

import {
  CompressionAlgorithm,
  CompressionError,
  type CompressionOptions,
  type CompressionProvider,
  type DecompressionOptions,
  type PartialDecompressionResult,
} from "./types.js";

/**
 * Map our algorithm enum to Web Compression Stream format
 */
function algorithmToFormat(algorithm: CompressionAlgorithm): CompressionFormat {
  switch (algorithm) {
    case CompressionAlgorithm.GZIP:
      return "gzip";
    case CompressionAlgorithm.ZLIB:
      // Web API's "deflate" format is actually zlib (with header)
      return "deflate";
    case CompressionAlgorithm.DEFLATE:
      // Raw deflate - may not be supported in all browsers
      return "deflate-raw" as CompressionFormat;
    default:
      return "deflate";
  }
}

/**
 * Compression provider using Web Compression Streams API
 *
 * Note: This is async-only. For synchronous operations, use a different provider.
 *
 * Important: The Web Compression Streams API has limited support for:
 * - Raw DEFLATE ("deflate-raw") - not available in all browsers
 * - Partial decompression with trailing data - not well supported
 */
export class WebCompressionProvider implements CompressionProvider {
  async compress(data: Uint8Array, options?: CompressionOptions): Promise<Uint8Array> {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.ZLIB;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    try {
      const format = algorithmToFormat(algorithm);
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
    const algorithm = options?.algorithm ?? CompressionAlgorithm.ZLIB;

    if (algorithm === CompressionAlgorithm.NONE) {
      return data;
    }

    try {
      const format = algorithmToFormat(algorithm);
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

  async decompressPartial(
    data: Uint8Array,
    options?: DecompressionOptions,
  ): Promise<PartialDecompressionResult> {
    const algorithm = options?.algorithm ?? CompressionAlgorithm.ZLIB;

    if (algorithm === CompressionAlgorithm.NONE) {
      return { data, bytesRead: data.length };
    }

    // Web Compression Streams API doesn't handle trailing data well.
    // For partial decompression, we try to decompress and handle errors.
    // This is a best-effort implementation - for reliable partial decompression
    // with trailing data (like Git pack files), use NodeCompressionProvider.

    try {
      const format = algorithmToFormat(algorithm);
      const stream = new DecompressionStream(format);
      const writer = stream.writable.getWriter();

      // Write data - this may error if there's trailing data
      writer.write(data as unknown as BufferSource).catch(() => {
        // Ignore write errors - they may be due to trailing data
      });
      writer.close().catch(() => {
        // Ignore close errors - they may be due to trailing data
      });

      const chunks: Uint8Array[] = [];
      const reader = stream.readable.getReader();
      let totalSize = 0;

      try {
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
      } catch {
        // Reader may error due to trailing data - that's OK if we got data
        if (chunks.length === 0) {
          throw new CompressionError(
            "Web decompression failed - no data decompressed. " +
              "Consider using NodeCompressionProvider for partial decompression with trailing data.",
          );
        }
      }

      // Combine chunks
      const result = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }

      // Web API doesn't tell us how many bytes were consumed
      // Return full input length as an approximation
      return { data: result, bytesRead: data.length };
    } catch (error) {
      if (error instanceof CompressionError) throw error;
      throw new CompressionError(
        `Web partial decompression failed: ${error}. ` +
          "Consider using NodeCompressionProvider for partial decompression.",
        error,
      );
    }
  }
}
