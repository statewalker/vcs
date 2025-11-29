/**
 * Compression provider interface
 *
 * Abstracts compression/decompression operations to allow different implementations
 * (e.g., Node.js zlib, browser CompressionStream, WASM implementations)
 */

/**
 * Compression algorithm types
 */
export enum CompressionAlgorithm {
  /** Raw DEFLATE compression (RFC 1951) - no header/checksum */
  DEFLATE = "DEFLATE",
  /** ZLIB compression (RFC 1950) - deflate with 2-byte header and Adler-32 checksum */
  ZLIB = "ZLIB",
  /** GZIP compression (RFC 1952) - deflate with gzip header and CRC-32 checksum */
  GZIP = "GZIP",
  /** No compression */
  NONE = "NONE",
}

/**
 * Compression options
 */
export interface CompressionOptions {
  /** Compression level (0-9, where 0 = no compression, 9 = maximum compression) */
  level?: number;
  /** Algorithm to use */
  algorithm?: CompressionAlgorithm;
}

/**
 * Decompression options
 */
export interface DecompressionOptions {
  /** Expected algorithm (for validation) */
  algorithm?: CompressionAlgorithm;
  /** Maximum size to decompress (to prevent decompression bombs) */
  maxSize?: number;
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
 * Compression provider interface
 *
 * Implementations should handle:
 * - DEFLATE (raw deflate, used by Git)
 * - GZIP (deflate with header/footer)
 */
export interface CompressionProvider {
  /**
   * Compress data using specified algorithm
   *
   * @param data Data to compress
   * @param options Compression options
   * @returns Compressed data
   */
  compress(data: Uint8Array, options?: CompressionOptions): Promise<Uint8Array>;

  /**
   * Decompress data
   *
   * @param data Compressed data
   * @param options Decompression options
   * @returns Decompressed data
   */
  decompress(data: Uint8Array, options?: DecompressionOptions): Promise<Uint8Array>;

  /**
   * Synchronous compress (if supported)
   *
   * @param data Data to compress
   * @param options Compression options
   * @returns Compressed data
   * @throws Error if synchronous compression not supported
   */
  compressSync(data: Uint8Array, options?: CompressionOptions): Uint8Array;

  /**
   * Synchronous decompress (if supported)
   *
   * @param data Compressed data
   * @param options Decompression options
   * @returns Decompressed data
   * @throws Error if synchronous decompression not supported
   */
  decompressSync(data: Uint8Array, options?: DecompressionOptions): Uint8Array;

  /**
   * Check if synchronous operations are supported
   */
  supportsSyncOperations(): boolean;

  /**
   * Decompress data that may contain trailing bytes after the compressed stream.
   *
   * This is useful for formats like Git pack files where compressed objects
   * are stored contiguously without explicit length markers for compressed data.
   * The decompressor stops when the compressed stream ends.
   *
   * @param data Compressed data (may include trailing bytes)
   * @param options Decompression options
   * @returns Decompressed data and number of input bytes consumed
   */
  decompressPartial(
    data: Uint8Array,
    options?: DecompressionOptions,
  ): Promise<PartialDecompressionResult>;
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
