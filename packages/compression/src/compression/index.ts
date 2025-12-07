/**
 * Compression module
 *
 * Provides streaming and block-based compression/decompression operations.
 * By default uses Web Compression Streams API.
 *
 * Use setCompression() to override with custom implementations (e.g., Node.js zlib).
 *
 * Primary API:
 * - Streaming: deflate(), inflate() - for large data or incremental processing
 * - Block: compressBlock(), decompressBlock() - for complete buffers
 */

import {
  type ByteStream,
  type CompressBlockFunction,
  CompressionError,
  type CompressionImplementation,
  type DecompressBlockFunction,
  type DeflateFunction,
  type InflateFunction,
  type StreamingCompressionOptions,
} from "./types.js";
import { collectStream, streamFromBuffer } from "./utils.js";
import { deflateWeb, inflateWeb } from "./web-streams.js";

// Re-export types
export * from "./types.js";
export * from "./utils.js";

// Current implementations (default to web-based)
let _deflate: DeflateFunction = deflateWeb;
let _inflate: InflateFunction = inflateWeb;

let _compressBlock: CompressBlockFunction | null = null;
let _decompressBlock: DecompressBlockFunction | null = null;

/**
 * Set custom compression implementation
 *
 * This allows overriding the default web-based compression with
 * platform-specific implementations (e.g., Node.js zlib for better performance).
 *
 * @example
 * ```ts
 * import { setCompression } from "@webrun-vcs/compression";
 * import { createNodeCompression } from "@webrun-vcs/compression/compression-node";
 *
 * setCompression(createNodeCompression());
 * ```
 */
export function setCompression(impl: Partial<CompressionImplementation>): void {
  if (impl.deflate) _deflate = impl.deflate;
  if (impl.inflate) _inflate = impl.inflate;
  if (impl.compressBlock) _compressBlock = impl.compressBlock;
  if (impl.decompressBlock) _decompressBlock = impl.decompressBlock;
}

/**
 * Compress a byte stream using DEFLATE
 *
 * @param stream Input byte stream
 * @param options Compression options (raw: true for raw DEFLATE, false for ZLIB)
 * @returns Compressed byte stream
 */
export function deflate(stream: ByteStream, options?: StreamingCompressionOptions): ByteStream {
  return _deflate(stream, options);
}

/**
 * Decompress a byte stream using INFLATE
 *
 * @param stream Compressed byte stream
 * @param options Decompression options (raw: true for raw DEFLATE, false for ZLIB)
 * @returns Decompressed byte stream
 */
export function inflate(stream: ByteStream, options?: StreamingCompressionOptions): ByteStream {
  return _inflate(stream, options);
}

/**
 * Compress a data block using DEFLATE
 *
 * @param data Data to compress
 * @param options Compression options (raw: true for raw DEFLATE, false for ZLIB)
 * @returns Compressed data
 */
export async function compressBlock(
  data: Uint8Array,
  options?: StreamingCompressionOptions,
): Promise<Uint8Array> {
  try {
    // Use custom implementation if set
    if (_compressBlock) {
      return await _compressBlock(data, options);
    }
    // Fall back to streaming implementation
    const stream = streamFromBuffer(data);
    return await collectStream(deflate(stream, options));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new CompressionError(`Compression failed: ${err.message}`, err);
  }
}

/**
 * Decompress a data block using INFLATE
 *
 * @param data Compressed data
 * @param options Decompression options (raw: true for raw DEFLATE, false for ZLIB)
 * @returns Decompressed data
 */
export async function decompressBlock(
  data: Uint8Array,
  options?: StreamingCompressionOptions,
): Promise<Uint8Array> {
  try {
    // Use custom implementation if set
    if (_decompressBlock) {
      return await _decompressBlock(data, options);
    }
    // Fall back to streaming implementation
    const stream = streamFromBuffer(data);
    return await collectStream(inflate(stream, options));
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    throw new CompressionError(`Decompression failed: ${err.message}`, err);
  }
}
