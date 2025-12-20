export async function* mapStream<T, U>(
  iterable: AsyncIterable<T> | Iterable<T>,
  fn: (item: T) => U,
): AsyncGenerator<U> {
  for await (const item of iterable) {
    yield fn(item);
  }
}

/**
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
 * Splits an async iterable stream into two separate async generators.
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
 * @returns A tuple containing the header as a Uint8Array and an async generator for the remaining data.
 */
export async function readHeader(
  input: AsyncIterable<Uint8Array>,
  getHeaderEnd: (block: Uint8Array) => number,
): Promise<[header: Uint8Array, rest: AsyncGenerator<Uint8Array>]> {
  let header: Uint8Array | null = null;
  let iterator: AsyncGenerator<Uint8Array> = (async function* () {})();
  for await (const it of splitStream(input, getHeaderEnd)) {
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
 * @returns A tuple containing the header as a Uint8Array and an async generator for the remaining data.
 */
export async function readAhead(
  input: AsyncIterable<Uint8Array>,
  getHeaderEnd: (block: Uint8Array) => number,
): Promise<[header: Uint8Array, stream: AsyncGenerator<Uint8Array>]> {
  const [header, rest] = await readHeader(input, getHeaderEnd);
  async function* combinedStream(): AsyncGenerator<Uint8Array> {
    yield header;
    yield* rest;
  }
  return [header, combinedStream()];
}
/**
 * Collects all chunks from an async iterable into a single Uint8Array.
 * @param input The input async iterable stream
 * @returns A Uint8Array containing all collected data
 */
export async function collect(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  for await (const chunk of input) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Creates a stateful header detector that can find a delimiter spanning multiple blocks.
 * The returned function maintains internal state across calls to detect delimiters
 * that are split across block boundaries.
 *
 * @param delimiter The byte sequence to search for
 * @returns A function that takes a block and returns the end position of the delimiter
 *          in that block if found, or -1 if not found yet
 */
export function newHeaderDetector(delimiter: Uint8Array): (block: Uint8Array) => number {
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
