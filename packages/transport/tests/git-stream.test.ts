/**
 * Tests for Git stream abstractions.
 * Tests the transport-agnostic stream interfaces.
 */

import { describe, expect, it } from "vitest";
import {
  BufferedOutputStream,
  createBidirectionalStream,
  createInputStreamFromAsyncIterable,
  createInputStreamFromBytes,
  createOutputStreamFromWritable,
} from "../src/streams/git-stream.js";

// Helper to create async iterable from chunks
async function* chunksToAsyncIterable(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

// Helper to create string from bytes
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Helper to create bytes from string
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

describe("GitInputStream", () => {
  describe("createInputStreamFromAsyncIterable", () => {
    it("should iterate over chunks", async () => {
      const chunks = [stringToBytes("hello"), stringToBytes("world")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      const result: Uint8Array[] = [];
      for await (const chunk of stream) {
        result.push(chunk);
      }

      expect(result.length).toBe(2);
      expect(bytesToString(result[0])).toBe("hello");
      expect(bytesToString(result[1])).toBe("world");
    });

    it("should read exact number of bytes", async () => {
      const chunks = [stringToBytes("hello world")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      const result = await stream.read(5);
      expect(bytesToString(result)).toBe("hello");
    });

    it("should buffer remaining bytes after read", async () => {
      const chunks = [stringToBytes("hello world")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      await stream.read(5); // Read "hello"
      const remaining = await stream.read(6); // Read " world"
      expect(bytesToString(remaining)).toBe(" world");
    });

    it("should accumulate data across chunks for read", async () => {
      const chunks = [stringToBytes("hel"), stringToBytes("lo ")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      const result = await stream.read(6);
      expect(bytesToString(result)).toBe("hello ");
    });

    it("should return less than n bytes at end of stream", async () => {
      const chunks = [stringToBytes("hi")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      const result = await stream.read(10);
      expect(bytesToString(result)).toBe("hi");
    });

    it("should return empty when reading after stream end", async () => {
      const chunks = [stringToBytes("hi")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      await stream.read(2); // Read all
      const result = await stream.read(5);
      expect(result.length).toBe(0);
    });

    it("should report hasMore correctly", async () => {
      const chunks = [stringToBytes("hello")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      expect(await stream.hasMore()).toBe(true);
      await stream.read(5);
      expect(await stream.hasMore()).toBe(false);
    });

    it("should handle empty stream", async () => {
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable([]));

      expect(await stream.hasMore()).toBe(false);
      const result = await stream.read(5);
      expect(result.length).toBe(0);
    });

    it("should close stream properly", async () => {
      const chunks = [stringToBytes("hello")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      await stream.close();
      expect(await stream.hasMore()).toBe(false);
    });

    it("should handle multiple small reads", async () => {
      const chunks = [stringToBytes("abcdefghij")];
      const stream = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));

      expect(bytesToString(await stream.read(2))).toBe("ab");
      expect(bytesToString(await stream.read(3))).toBe("cde");
      expect(bytesToString(await stream.read(4))).toBe("fghi");
      expect(bytesToString(await stream.read(1))).toBe("j");
      expect((await stream.read(1)).length).toBe(0);
    });
  });

  describe("createInputStreamFromBytes", () => {
    it("should iterate over data", async () => {
      const data = stringToBytes("hello world");
      const stream = createInputStreamFromBytes(data);

      const result: Uint8Array[] = [];
      for await (const chunk of stream) {
        result.push(chunk);
      }

      expect(result.length).toBe(1);
      expect(bytesToString(result[0])).toBe("hello world");
    });

    it("should read exact bytes", async () => {
      const data = stringToBytes("hello world");
      const stream = createInputStreamFromBytes(data);

      const result = await stream.read(5);
      expect(bytesToString(result)).toBe("hello");
    });

    it("should track offset correctly", async () => {
      const data = stringToBytes("hello world");
      const stream = createInputStreamFromBytes(data);

      await stream.read(6);
      const remaining = await stream.read(5);
      expect(bytesToString(remaining)).toBe("world");
    });

    it("should report hasMore correctly", async () => {
      const data = stringToBytes("hi");
      const stream = createInputStreamFromBytes(data);

      expect(await stream.hasMore()).toBe(true);
      await stream.read(2);
      expect(await stream.hasMore()).toBe(false);
    });

    it("should handle empty data", async () => {
      const stream = createInputStreamFromBytes(new Uint8Array(0));

      expect(await stream.hasMore()).toBe(false);
      expect((await stream.read(5)).length).toBe(0);
    });

    it("should close properly", async () => {
      const data = stringToBytes("hello");
      const stream = createInputStreamFromBytes(data);

      await stream.close();
      expect(await stream.hasMore()).toBe(false);
    });
  });
});

describe("GitOutputStream", () => {
  describe("createOutputStreamFromWritable", () => {
    it("should write data to writable", async () => {
      const written: Uint8Array[] = [];
      const stream = createOutputStreamFromWritable(async (data) => {
        written.push(data);
      });

      await stream.write(stringToBytes("hello"));
      await stream.write(stringToBytes("world"));

      expect(written.length).toBe(2);
      expect(bytesToString(written[0])).toBe("hello");
      expect(bytesToString(written[1])).toBe("world");
    });

    it("should call flush without error", async () => {
      const stream = createOutputStreamFromWritable(async () => {});
      await expect(stream.flush()).resolves.toBeUndefined();
    });

    it("should call close callback", async () => {
      let closeCalled = false;
      const stream = createOutputStreamFromWritable(
        async () => {},
        async () => {
          closeCalled = true;
        },
      );

      await stream.close();
      expect(closeCalled).toBe(true);
    });

    it("should handle close without callback", async () => {
      const stream = createOutputStreamFromWritable(async () => {});
      await expect(stream.close()).resolves.toBeUndefined();
    });
  });
});

describe("BufferedOutputStream", () => {
  it("should buffer writes", async () => {
    const stream = new BufferedOutputStream();

    await stream.write(stringToBytes("hello"));
    await stream.write(stringToBytes(" "));
    await stream.write(stringToBytes("world"));

    const data = stream.getData();
    expect(bytesToString(data)).toBe("hello world");
  });

  it("should return empty data when nothing written", () => {
    const stream = new BufferedOutputStream();
    const data = stream.getData();
    expect(data.length).toBe(0);
  });

  it("should throw when writing after close", async () => {
    const stream = new BufferedOutputStream();
    await stream.close();

    await expect(stream.write(stringToBytes("test"))).rejects.toThrow("Stream is closed");
  });

  it("should iterate over buffered chunks", async () => {
    const stream = new BufferedOutputStream();

    await stream.write(stringToBytes("chunk1"));
    await stream.write(stringToBytes("chunk2"));
    await stream.write(stringToBytes("chunk3"));

    const chunks: string[] = [];
    for await (const chunk of stream) {
      chunks.push(bytesToString(chunk));
    }

    expect(chunks).toEqual(["chunk1", "chunk2", "chunk3"]);
  });

  it("should handle flush without error", async () => {
    const stream = new BufferedOutputStream();
    await stream.write(stringToBytes("test"));
    await expect(stream.flush()).resolves.toBeUndefined();
  });
});

describe("GitBidirectionalStream", () => {
  describe("createBidirectionalStream", () => {
    it("should create bidirectional stream from input and output", async () => {
      const inputData = stringToBytes("input data");
      const input = createInputStreamFromBytes(inputData);

      const written: Uint8Array[] = [];
      const output = createOutputStreamFromWritable(async (data) => {
        written.push(data);
      });

      const bidir = createBidirectionalStream(input, output);

      // Read from input
      const readData = await bidir.input.read(10);
      expect(bytesToString(readData)).toBe("input data");

      // Write to output
      await bidir.output.write(stringToBytes("output"));
      expect(bytesToString(written[0])).toBe("output");
    });

    it("should close both streams", async () => {
      let inputClosed = false;
      let outputClosed = false;

      // Create a custom input that tracks close
      const inputData = stringToBytes("test");
      const inputIterator = (async function* () {
        yield inputData;
      })()[Symbol.asyncIterator]();

      const input = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              return inputIterator.next();
            },
          };
        },
        async read(_n: number) {
          return inputData;
        },
        async hasMore() {
          return true;
        },
        async close() {
          inputClosed = true;
        },
      };

      const output = createOutputStreamFromWritable(
        async () => {},
        async () => {
          outputClosed = true;
        },
      );

      const bidir = createBidirectionalStream(input, output);
      await bidir.close();

      expect(inputClosed).toBe(true);
      expect(outputClosed).toBe(true);
    });
  });
});

describe("Stream integration scenarios", () => {
  it("should handle Git protocol-like communication", async () => {
    // Simulate a simple request-response protocol
    // "want abcd\n" is 10 bytes, + 4 for length = 14 = 0x000e
    const requestChunks = [
      stringToBytes("000ewant abcd\n"),
      stringToBytes("0000"), // flush
      stringToBytes("0009done\n"),
    ];

    const input = createInputStreamFromAsyncIterable(chunksToAsyncIterable(requestChunks));

    // Read packet length (4 bytes)
    const lenBytes = await input.read(4);
    expect(bytesToString(lenBytes)).toBe("000e");

    // Parse length and read rest of packet
    const len = parseInt(bytesToString(lenBytes), 16);
    const packetData = await input.read(len - 4);
    expect(bytesToString(packetData)).toBe("want abcd\n");

    // Read flush packet
    const flush = await input.read(4);
    expect(bytesToString(flush)).toBe("0000");

    // Read done packet
    const doneLen = await input.read(4);
    expect(bytesToString(doneLen)).toBe("0009");
    const done = await input.read(5);
    expect(bytesToString(done)).toBe("done\n");
  });

  it("should handle binary data correctly", async () => {
    // Create binary data with null bytes and high bytes
    const binaryData = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x01, 0xfe, 0x50, 0x41, 0x43, 0x4b]); // Includes PACK signature

    const stream = createInputStreamFromBytes(binaryData);

    const result = await stream.read(10);
    expect(result.length).toBe(10);
    expect(result[0]).toBe(0x00);
    expect(result[1]).toBe(0xff);
    expect(result[6]).toBe(0x50); // P
    expect(result[7]).toBe(0x41); // A
    expect(result[8]).toBe(0x43); // C
    expect(result[9]).toBe(0x4b); // K
  });

  it("should handle large data across multiple reads", async () => {
    // Create large data (10KB)
    const largeData = new Uint8Array(10240);
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    const stream = createInputStreamFromBytes(largeData);

    // Read in chunks
    let totalRead = 0;
    const chunks: Uint8Array[] = [];
    while (await stream.hasMore()) {
      const chunk = await stream.read(1024);
      if (chunk.length === 0) break;
      chunks.push(chunk);
      totalRead += chunk.length;
    }

    expect(totalRead).toBe(10240);

    // Verify data integrity
    let offset = 0;
    for (const chunk of chunks) {
      for (let i = 0; i < chunk.length; i++) {
        expect(chunk[i]).toBe((offset + i) % 256);
      }
      offset += chunk.length;
    }
  });
});
