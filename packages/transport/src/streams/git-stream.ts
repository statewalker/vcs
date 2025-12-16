/**
 * Abstract stream interfaces for Git protocol transport.
 *
 * These abstractions allow the Git protocol handlers to work
 * with different transport mechanisms (TCP, SSH, HTTP, etc.)
 * in a transport-agnostic way.
 *
 * Designed for isomorphic use (browser + Node.js).
 *
 * Based on JGit's stream abstractions and protocol design.
 */

/**
 * Abstract readable stream for Git protocol.
 * Provides async iteration over incoming data.
 */
export interface GitInputStream {
  /**
   * Read data from the stream.
   * Returns chunks of data as they become available.
   */
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;

  /**
   * Read exactly n bytes from the stream.
   * Blocks until n bytes are available or stream ends.
   *
   * @param n - Number of bytes to read
   * @returns Exactly n bytes, or less if stream ended
   */
  read(n: number): Promise<Uint8Array>;

  /**
   * Check if more data is available.
   */
  hasMore(): Promise<boolean>;

  /**
   * Close the stream.
   */
  close(): Promise<void>;
}

/**
 * Abstract writable stream for Git protocol.
 */
export interface GitOutputStream {
  /**
   * Write data to the stream.
   *
   * @param data - Data to write
   */
  write(data: Uint8Array): Promise<void>;

  /**
   * Flush any buffered data.
   */
  flush(): Promise<void>;

  /**
   * Close the stream.
   */
  close(): Promise<void>;
}

/**
 * Bidirectional stream for Git protocol communication.
 */
export interface GitBidirectionalStream {
  /** Input stream for reading */
  input: GitInputStream;
  /** Output stream for writing */
  output: GitOutputStream;

  /**
   * Close both streams.
   */
  close(): Promise<void>;
}

/**
 * Options for creating a Git transport connection.
 */
export interface GitTransportOptions {
  /** Timeout for connection in milliseconds */
  timeout?: number;
  /** Extra environment variables (for SSH) */
  environment?: Record<string, string>;
}

/**
 * Abstract transport connector.
 * Creates bidirectional streams for Git protocol communication.
 */
export interface GitTransportConnector {
  /**
   * Connect to a Git repository at the given URL.
   *
   * @param url - Repository URL (git://, ssh://, file://, etc.)
   * @param options - Connection options
   * @returns Bidirectional stream for protocol communication
   */
  connect(url: string, options?: GitTransportOptions): Promise<GitBidirectionalStream>;
}

/**
 * Create a GitInputStream from an AsyncIterable.
 */
export function createInputStreamFromAsyncIterable(
  source: AsyncIterable<Uint8Array>,
): GitInputStream {
  const iterator = source[Symbol.asyncIterator]();
  let buffer = new Uint8Array(0);
  let done = false;

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (buffer.length > 0) {
            const data = buffer;
            buffer = new Uint8Array(0);
            return { value: data, done: false };
          }

          if (done) {
            return { value: undefined, done: true };
          }

          const result = await iterator.next();
          if (result.done) {
            done = true;
            return { value: undefined, done: true };
          }

          return { value: result.value, done: false };
        },
      };
    },

    async read(n: number): Promise<Uint8Array> {
      // Accumulate data until we have n bytes
      const chunks: Uint8Array[] = [];
      let totalLength = 0;

      // First use any buffered data
      if (buffer.length > 0) {
        if (buffer.length >= n) {
          const result = buffer.subarray(0, n);
          buffer = buffer.subarray(n);
          return result;
        }
        chunks.push(buffer);
        totalLength = buffer.length;
        buffer = new Uint8Array(0);
      }

      // Read more data until we have n bytes
      while (totalLength < n && !done) {
        const result = await iterator.next();
        if (result.done) {
          done = true;
          break;
        }
        chunks.push(result.value);
        totalLength += result.value.length;
      }

      // Combine chunks
      const combined = concatBytes(chunks);

      // Return exactly n bytes, buffer the rest
      if (combined.length > n) {
        buffer = new Uint8Array(combined.subarray(n));
        return new Uint8Array(combined.subarray(0, n));
      }

      return combined;
    },

    async hasMore(): Promise<boolean> {
      if (buffer.length > 0) return true;
      if (done) return false;

      // Peek ahead
      const result = await iterator.next();
      if (result.done) {
        done = true;
        return false;
      }

      buffer = new Uint8Array(result.value);
      return true;
    },

    async close(): Promise<void> {
      if (iterator.return) {
        await iterator.return();
      }
      done = true;
    },
  };
}

/**
 * Create a GitOutputStream from a WritableStream.
 */
export function createOutputStreamFromWritable(
  write: (data: Uint8Array) => Promise<void>,
  close?: () => Promise<void>,
): GitOutputStream {
  return {
    write,
    async flush(): Promise<void> {
      // Default implementation - no buffering
    },
    async close(): Promise<void> {
      if (close) {
        await close();
      }
    },
  };
}

/**
 * Create a bidirectional stream from individual streams.
 */
export function createBidirectionalStream(
  input: GitInputStream,
  output: GitOutputStream,
): GitBidirectionalStream {
  return {
    input,
    output,
    async close(): Promise<void> {
      await Promise.all([input.close(), output.close()]);
    },
  };
}

/**
 * Buffered output stream that accumulates writes.
 */
export class BufferedOutputStream implements GitOutputStream {
  private buffer: Uint8Array[] = [];
  private closed = false;

  async write(data: Uint8Array): Promise<void> {
    if (this.closed) {
      throw new Error("Stream is closed");
    }
    this.buffer.push(data);
  }

  async flush(): Promise<void> {
    // No-op for buffered stream - data stays in buffer
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /**
   * Get all buffered data.
   */
  getData(): Uint8Array {
    return concatBytes(this.buffer);
  }

  /**
   * Get buffered data as async iterable.
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
    for (const chunk of this.buffer) {
      yield chunk;
    }
  }
}

/**
 * Create a GitInputStream from a Uint8Array.
 */
export function createInputStreamFromBytes(data: Uint8Array): GitInputStream {
  let offset = 0;
  let closed = false;

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<Uint8Array>> {
          if (closed || offset >= data.length) {
            return { value: undefined, done: true };
          }
          const chunk = data.subarray(offset);
          offset = data.length;
          return { value: chunk, done: false };
        },
      };
    },

    async read(n: number): Promise<Uint8Array> {
      if (closed || offset >= data.length) {
        return new Uint8Array(0);
      }
      const end = Math.min(offset + n, data.length);
      const chunk = data.subarray(offset, end);
      offset = end;
      return chunk;
    },

    async hasMore(): Promise<boolean> {
      return !closed && offset < data.length;
    },

    async close(): Promise<void> {
      closed = true;
    },
  };
}

/**
 * Concatenate byte arrays.
 */
function concatBytes(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}
