/**
 * Compression types and utilities
 */

/**
 * Byte stream type - AsyncGenerator yielding Uint8Array chunks
 */
export type ByteStream = AsyncGenerator<Uint8Array, void, unknown>;

/**
 * Options for streaming compression/decompression
 */
export interface StreamingCompressionOptions {
  /** true = raw DEFLATE (no header/checksum), false = ZLIB format (default) */
  raw?: boolean;
  /** Compression level (0-9, where 0 = no compression, 9 = maximum compression) */
  level?: number;
}

/**
 * Result of partial decompression
 */
export interface PartialDecompressionResult {
  /** Decompressed data */
  data: Uint8Array;
  /** Number of compressed bytes consumed from input */
  bytesRead: number;
}

/**
 * Error thrown when compression/decompression fails
 */
export class CompressionError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CompressionError";
  }
}

/**
 * Function types for compression operations
 */
export type DeflateFunction = (
  stream: ByteStream,
  options?: StreamingCompressionOptions,
) => ByteStream;

export type InflateFunction = (
  stream: ByteStream,
  options?: StreamingCompressionOptions,
) => ByteStream;

export type CompressBlockFunction = (
  data: Uint8Array,
  options?: StreamingCompressionOptions,
) => Promise<Uint8Array>;

export type DecompressBlockFunction = (
  data: Uint8Array,
  options?: StreamingCompressionOptions,
) => Promise<Uint8Array>;

export type DecompressBlockPartialFunction = (
  data: Uint8Array,
  options?: StreamingCompressionOptions,
) => Promise<PartialDecompressionResult>;

/**
 * Compression implementation interface for setCompression
 */
export interface CompressionImplementation {
  deflate: DeflateFunction;
  inflate: InflateFunction;
  compressBlock: CompressBlockFunction;
  decompressBlock: DecompressBlockFunction;
  decompressBlockPartial?: DecompressBlockPartialFunction;
}
