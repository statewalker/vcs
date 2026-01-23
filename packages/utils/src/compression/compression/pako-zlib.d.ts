/**
 * Type declarations for pako's internal zlib inflate module.
 * These are not exposed in @types/pako, so we declare them here.
 */

declare module "pako/lib/zlib/inflate.js" {
  interface ZStream {
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

  export function inflateInit2(strm: ZStream, windowBits: number): number;
  export function inflate(strm: ZStream, flush: number): number;
  export function inflateEnd(strm: ZStream): number;
}
