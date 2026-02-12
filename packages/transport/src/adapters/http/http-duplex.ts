/**
 * HTTP-based Duplex implementation.
 *
 * Creates a bidirectional byte stream from HTTP request/response.
 * Used for Git smart HTTP protocol where request body is input
 * and response body is output.
 */

import type { Duplex } from "../../api/duplex.js";

/**
 * Options for creating a simple duplex.
 */
export interface SimpleDuplexOptions {
  /** Optional callback when close() is called */
  onClose?: () => void | Promise<void>;
}

/**
 * Creates a Duplex from an async iterable input and a writer function.
 *
 * This is the basic building block for HTTP duplexes, where:
 * - Input comes from request body (client) or response body (server)
 * - Output goes to response body (server) or is collected (client)
 *
 * @param input - Async iterable of incoming chunks
 * @param writer - Function to write outgoing chunks
 * @returns Duplex interface
 */
export function createSimpleDuplex(
  input: AsyncIterable<Uint8Array>,
  writer: (data: Uint8Array) => void,
): Duplex {
  return {
    [Symbol.asyncIterator]: () => input[Symbol.asyncIterator](),
    write: writer,
  };
}

/**
 * HTTP request body adapter.
 *
 * Wraps a ReadableStream (from fetch Response) as an async iterable.
 */
export async function* readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Collects all chunks from an async iterable into a single Uint8Array.
 */
export async function collectChunks(chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of chunks) {
    parts.push(chunk);
    totalLength += chunk.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

/**
 * Buffer writer that collects all writes into an array.
 *
 * Used for HTTP client to collect response data.
 */
export class BufferWriter {
  private chunks: Uint8Array[] = [];

  write(data: Uint8Array): void {
    this.chunks.push(data);
  }

  getChunks(): Uint8Array[] {
    return this.chunks;
  }

  async toUint8Array(): Promise<Uint8Array> {
    return collectChunks(this.iterate());
  }

  async *iterate(): AsyncIterable<Uint8Array> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

/**
 * Creates a Duplex for an HTTP client request.
 *
 * The client writes request body data, then reads response body data.
 * Since HTTP is half-duplex, we collect all writes first, send the request,
 * then return the response as the readable side.
 *
 * @param sendRequest - Function that sends HTTP request and returns response body
 * @returns Object with duplex for writing and getResponse for reading after send
 */
export function createHttpClientDuplex(
  sendRequest: (body: Uint8Array) => Promise<ReadableStream<Uint8Array>>,
): {
  writer: BufferWriter;
  sendAndGetReadable: () => Promise<AsyncIterable<Uint8Array>>;
} {
  const writer = new BufferWriter();

  return {
    writer,
    async sendAndGetReadable(): Promise<AsyncIterable<Uint8Array>> {
      const body = await writer.toUint8Array();
      const responseStream = await sendRequest(body);
      return readableStreamToAsyncIterable(responseStream);
    },
  };
}
