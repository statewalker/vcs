/**
 * Stream utilities for Git object format handling
 *
 * Provides generic streaming primitives used by format modules for
 * encoding/decoding Git objects with minimal buffering.
 */

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
 * Encode string to UTF-8 bytes.
 */
export function encodeString(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

/**
 * Decode UTF-8 bytes to string.
 */
export function decodeString(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

/**
 * Maps items from an async or sync iterable using a transform function.
 */
export async function* mapStream<T, U>(
  iterable: AsyncIterable<T> | Iterable<T>,
  fn: (item: T) => U,
): AsyncGenerator<U> {
  for await (const item of iterable) {
    yield fn(item);
  }
}

/**
 * Converts an async stream of Uint8Array chunks into lines.
 * Handles both LF and CRLF line endings.
 *
 * @param input The input async iterable stream
 */
export async function* toLines(input: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of input) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split("\n");
    // Keep the last partial line in buffer
    buffer = lines.pop() || "";
    for (const line of lines) {
      yield trimEnd(line, "\r");
    }
  }
  if (buffer.length > 0) {
    yield trimEnd(buffer, "\r");
  }
  function trimEnd(str: string, char: string[1]): string {
    return str.endsWith(char) ? str.slice(0, -char.length) : str;
  }
}

/**
 * Splits an async iterable stream into multiple async generators.
 * The `split` function determines the split point within each block.
 * When a split point is found - the returned split position value is
 * more or equal to zero - the current generator interrupts and a new
 * one starts.
 * @param input The input async iterable stream
 * @param split Function that determines the split point within each block.
 * @param finishOnEnd If true, all generators will finish when the input ends. Otherwise, the last generator may remain open.
 */
export async function* splitStream(
  input: AsyncIterable<Uint8Array>,
  split: (block: Uint8Array) => number,
  finishOnEnd = false,
): AsyncGenerator<AsyncGenerator<Uint8Array>> {
  const iterator = (async function* () {
    yield* input;
  })();

  let lastBlock: Uint8Array | null = null;
  let finished = false;
  try {
    while (!finished || lastBlock !== null) {
      yield readNextGenerator();
    }
  } finally {
    if (finishOnEnd) {
      finished = true;
    }
  }
  async function* readNextGenerator(): AsyncGenerator<Uint8Array> {
    while (!finished) {
      if (lastBlock !== null) {
        yield lastBlock;
        lastBlock = null;
        continue;
      }
      const slot = await iterator.next();
      if (slot.done) {
        finished = true;
        break;
      }
      const splitPoint = split(slot.value);
      if (splitPoint >= 0) {
        // Split point found
        lastBlock = slot.value.subarray(splitPoint);
        yield slot.value.subarray(0, splitPoint);
        // Stop current generator and start a new one
        break;
      } else {
        // No split point, yield entire block
        yield slot.value;
      }
    }
  }
}

/**
 * Reads a header from an async iterable stream.
 * @param input the input async iterable stream
 * @param getHeaderEnd  function that determines the end of the header within a block.
 * @param maxLength Optional maximum length for the header. If exceeded, an error is thrown. 
 * No limit if zero or negative. Default is -1.
 * @returns A tuple containing the header as a Uint8Array and an async generator for the remaining data.
 */
export async function readHeader(
  input: AsyncIterable<Uint8Array>,
  getHeaderEnd: (block: Uint8Array) => number,
  maxLength = -1,
): Promise<[header: Uint8Array, rest: AsyncGenerator<Uint8Array>]> {
  let header: Uint8Array | null = null;
  let iterator: AsyncGenerator<Uint8Array> = (async function* () {})();
  let len = 0;
  const getSplitPos = maxLength > 0 ? (block: Uint8Array) => {
    const endPos = getHeaderEnd(block);
    if (endPos < 0 || endPos > block.length) {
      len += block.length;
      if (len > maxLength) {
        throw new Error(`Header exceeds maximum length of ${maxLength} bytes`);
      }
    }
    return endPos;
  } : getHeaderEnd;
  for await (const it of splitStream(input, getSplitPos)) {
    if (header === null) {
      header = await collect(it);
    } else {
      iterator = it;
      break;
    }
  }
  return [header || new Uint8Array(0), iterator];
}

/**
 * Reads ahead from an async iterable stream and returns the header and a combined stream (header + rest).
 *
 * @param input The input async iterable stream
 * @param getHeaderEnd Function that determines the end of the header within a block.
 * @param maxLength Optional maximum length for the header. If exceeded, an error is thrown.
 * @returns A tuple containing the header as a Uint8Array and an async generator for the remaining data.
 */
export async function readAhead(
  input: AsyncIterable<Uint8Array>,
  getHeaderEnd: (block: Uint8Array) => number,
  maxLength = -1,
): Promise<[header: Uint8Array, stream: AsyncGenerator<Uint8Array>]> {
  const [header, rest] = await readHeader(input, getHeaderEnd, maxLength);
  async function* combinedStream(): AsyncGenerator<Uint8Array> {
    yield header;
    yield* rest;
  }
  return [header, combinedStream()];
}

/**
 * Creates a simple byte splitter that looks for a single byte delimiter.
 * @param char 
 * @returns 
 */
export function newByteSplitter(char: number): (block: Uint8Array) => number {
  return (block: Uint8Array): number => {
    for (let i = 0; i < block.length; i++) {
      if (block[i] === char) {
        return i + 1; // Include the delimiter in the split
      }
    }
    return -1; // No split point found
  };
}

/**
 * Creates a stateful splitter that can find a delimiter spanning multiple blocks.
 * The returned function maintains internal state across calls to detect delimiters
 * that are split across block boundaries.
 *
 * @param delimiter The byte sequence to search for
 * @returns A function that takes a block and returns the end position of the delimiter
 *          in that block if found, or -1 if not found yet
 */
export function newSplitter(delimiter: Uint8Array): (block: Uint8Array) => number {
  // Buffer to hold the tail of previous blocks (up to delimiter.length - 1 bytes)
  // This allows detecting delimiters that span block boundaries
  let buffer = new Uint8Array(0);

  return (block: Uint8Array): number => {
    const combinedLength = buffer.length + block.length;
    for (let i = 0; i <= combinedLength - delimiter.length; i++) {
      let match = true;
      for (let j = 0; j < delimiter.length; j++) {
        const byte = delimiter[j];
        if (i + j < buffer.length) {
          if (buffer[i + j] !== byte) {
            match = false;
            break;
          }
        } else {
          const blockIndex = i + j - buffer.length;
          if (block[blockIndex] !== byte) {
            match = false;
            break;
          }
        }
      }
      if (match) {
        // Found! Calculate position in original block where delimiter ends
        const endInCombined = i + delimiter.length;
        const endInBlock = endInCombined - buffer.length;
        buffer = new Uint8Array(0);
        return endInBlock;
      }
    }

    // No match found, save last (delimiter.length - 1) bytes as potential partial match
    const keepLen = Math.min(delimiter.length - 1, combinedLength);
    if (keepLen <= 0) {
      buffer = new Uint8Array(0);
    } else if (keepLen <= block.length) {
      // All bytes we need are in the current block
      buffer = block.slice(block.length - keepLen);
    } else {
      // Need bytes from both buffer and block
      const bytesFromBuffer = keepLen - block.length;
      const newBuffer = new Uint8Array(keepLen);
      newBuffer.set(buffer.slice(buffer.length - bytesFromBuffer), 0);
      newBuffer.set(block, bytesFromBuffer);
      buffer = newBuffer;
    }

    return -1;
  };
}
