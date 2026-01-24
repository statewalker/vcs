/**
 * Type declarations for pako's internal zlib inflate module
 *
 * These declarations cover the low-level zlib API used for partial
 * decompression with exact byte tracking.
 */

declare module "pako/lib/zlib/inflate.js" {
  /**
   * z_stream structure used by zlib inflate functions
   */
  export interface ZStream {
    input: Uint8Array | null;
    next_in: number;
    avail_in: number;
    total_in: number;
    output: Uint8Array | null;
    next_out: number;
    avail_out: number;
    total_out: number;
    msg: string;
    state: unknown;
    data_type: number;
    adler: number;
  }

  /**
   * Initialize the internal stream state for decompression
   *
   * @param strm z_stream structure to initialize
   * @param windowBits Window size (negative for raw deflate, positive for zlib)
   * @returns Z_OK on success, error code otherwise
   */
  export function inflateInit2(strm: ZStream, windowBits: number): number;

  /**
   * Decompress data from the stream
   *
   * @param strm z_stream structure with input/output buffers set
   * @param flush Flush mode (Z_FINISH, Z_NO_FLUSH, etc.)
   * @returns Z_OK, Z_STREAM_END, Z_BUF_ERROR, or error code
   */
  export function inflate(strm: ZStream, flush: number): number;

  /**
   * Free dynamically allocated data structures for the stream
   *
   * @param strm z_stream structure to clean up
   * @returns Z_OK on success
   */
  export function inflateEnd(strm: ZStream): number;
}
