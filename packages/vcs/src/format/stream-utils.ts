/**
 * Stream utilities for Git object format handling
 *
 * Provides generic streaming primitives used by format modules for
 * encoding/decoding Git objects with minimal buffering.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Concatenate two Uint8Arrays into new array.
 *
 * Used by decoders for buffering partial entries at chunk boundaries.
 */
export function concat(
  a: Uint8Array<ArrayBufferLike>,
  b: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(a.length + b.length);
  result.set(a, 0);
  result.set(b, a.length);
  return result;
}

/**
 * Check if input is async iterable.
 */
export function isAsyncIterable<T>(input: unknown): input is AsyncIterable<T> {
  return input !== null && typeof input === "object" && Symbol.asyncIterator in input;
}

/**
 * Normalize sync or async iterable to async iterable.
 *
 * Used by encode functions and store implementations to accept both
 * sync and async iterables uniformly.
 */
export function asAsyncIterable<T>(input: AsyncIterable<T> | Iterable<T>): AsyncIterable<T> {
  if (isAsyncIterable(input)) {
    return input;
  }
  // Convert sync iterable to async
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of input as Iterable<T>) {
        yield item;
      }
    },
  };
}

/**
 * Collect async iterable items into array.
 *
 * Used by tests and helper functions like entriesToCommit.
 */
export async function toArray<T>(input: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of input) {
    result.push(item);
  }
  return result;
}

/**
 * Collect async stream chunks into single Uint8Array.
 *
 * Used by storage backends that cannot stream to their underlying storage
 * (e.g., MemoryRawStorage, SqlRawStorage).
 *
 * Use sparingly - prefer streaming where possible.
 */
export async function collect(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for await (const chunk of input) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Read a line (until LF) from buffer at offset.
 *
 * Returns null if no complete line available.
 * Handles both LF and CRLF line endings.
 */
export function readLine(data: Uint8Array, offset: number): { line: string; next: number } | null {
  const LF = 0x0a;
  const CR = 0x0d;

  let pos = offset;
  while (pos < data.length && data[pos] !== LF) {
    pos++;
  }

  if (pos >= data.length) return null;

  let lineEnd = pos;
  if (lineEnd > offset && data[lineEnd - 1] === CR) {
    lineEnd--;
  }

  return {
    line: decoder.decode(data.subarray(offset, lineEnd)),
    next: pos + 1,
  };
}

/**
 * Encode text as line with LF terminator.
 */
export function encodeLine(text: string): Uint8Array {
  return encoder.encode(`${text}\n`);
}

/**
 * Encode string to UTF-8 bytes.
 */
export function encodeString(text: string): Uint8Array {
  return encoder.encode(text);
}

/**
 * Decode UTF-8 bytes to string.
 */
export function decodeString(data: Uint8Array): string {
  return decoder.decode(data);
}
