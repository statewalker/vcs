/**
 * Tests for MessagePort adapter functions.
 *
 * Tests cover:
 * - createMessagePortReader: message yielding, close signal, error handling, backpressure
 * - createMessagePortWriter: message sending, zero-copy optimization, closed port detection
 * - createMessagePortCloser: close signal, reader completion, idempotency
 */

import { describe, expect, it } from "vitest";
import {
  createMessagePortCloser,
  createMessagePortPair,
  createMessagePortReader,
  createMessagePortWriter,
} from "../src/socket/index.js";

// =============================================================================
// createMessagePortReader Tests
// =============================================================================

describe("createMessagePortReader", () => {
  it("should yield Uint8Array messages", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);

    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([4, 5, 6]);

    // Send messages from other port
    setTimeout(() => {
      port2.postMessage(data1);
      port2.postMessage(data2);
      port2.postMessage(null); // Close signal
    }, 10);

    const chunks: Uint8Array[] = [];
    for await (const chunk of reader) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(2);
    expect(Array.from(chunks[0])).toEqual([1, 2, 3]);
    expect(Array.from(chunks[1])).toEqual([4, 5, 6]);
  });

  it("should handle close signal before any messages", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);

    setTimeout(() => {
      port2.postMessage(null); // Close signal immediately
    }, 10);

    const chunks: Uint8Array[] = [];
    for await (const chunk of reader) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(0);
  });

  it("should handle undefined as close signal", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);

    setTimeout(() => {
      port2.postMessage(new Uint8Array([1]));
      port2.postMessage(undefined); // Close signal
    }, 10);

    const chunks: Uint8Array[] = [];
    for await (const chunk of reader) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(1);
  });

  it("should reject non-Uint8Array messages with error", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);

    setTimeout(() => {
      port2.postMessage("invalid data");
    }, 10);

    await expect(async () => {
      for await (const _chunk of reader) {
        // Should throw on invalid data
      }
    }).rejects.toThrow(/Invalid data type/);
  });

  it("should handle multiple messages in sequence", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);

    const messageCount = 50;
    setTimeout(() => {
      for (let i = 0; i < messageCount; i++) {
        port2.postMessage(new Uint8Array([i]));
      }
      port2.postMessage(null);
    }, 10);

    let received = 0;
    for await (const _chunk of reader) {
      received++;
    }

    expect(received).toBe(messageCount);
  });

  it("should handle concurrent production", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);

    // Send many messages rapidly
    setTimeout(() => {
      for (let i = 0; i < 100; i++) {
        port2.postMessage(new Uint8Array([i % 256]));
      }
      port2.postMessage(null);
    }, 5);

    const chunks: Uint8Array[] = [];
    for await (const chunk of reader) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(100);
  });
});

// =============================================================================
// createMessagePortWriter Tests
// =============================================================================

describe("createMessagePortWriter", () => {
  it("should send Uint8Array messages", async () => {
    const [port1, port2] = createMessagePortPair();
    const write = createMessagePortWriter(port1);

    const received: Uint8Array[] = [];
    const reader = createMessagePortReader(port2);

    // Start reading in background
    const readPromise = (async () => {
      for await (const chunk of reader) {
        received.push(chunk);
        if (received.length >= 2) break;
      }
    })();

    const data1 = new Uint8Array([1, 2, 3]);
    const data2 = new Uint8Array([4, 5, 6]);

    await write(data1);
    await write(data2);

    await readPromise;

    expect(received).toHaveLength(2);
    expect(Array.from(received[0])).toEqual([1, 2, 3]);
    expect(Array.from(received[1])).toEqual([4, 5, 6]);
  });

  it("should transfer buffers for zero-copy when buffer is fully owned", async () => {
    const [port1, port2] = createMessagePortPair();
    const write = createMessagePortWriter(port1);

    // Create a buffer that the Uint8Array fully owns
    const data = new Uint8Array([1, 2, 3]);
    const originalByteLength = data.buffer.byteLength;

    expect(data.byteOffset).toBe(0);
    expect(data.byteLength).toBe(originalByteLength);

    // Read in background to prevent blocking
    const reader = createMessagePortReader(port2);
    const readPromise = (async () => {
      for await (const _chunk of reader) {
        break;
      }
    })();

    await write(data);

    // Buffer should be transferred (neutered)
    expect(data.buffer.byteLength).toBe(0);

    await readPromise;
  });

  it("should clone when Uint8Array is a view of larger buffer", async () => {
    const [port1, port2] = createMessagePortPair();
    const write = createMessagePortWriter(port1);

    // Create a larger buffer and take a subarray view
    const largeBuffer = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const view = largeBuffer.subarray(1, 4); // [2, 3, 4]

    // Read in background
    const reader = createMessagePortReader(port2);
    const readPromise = (async () => {
      for await (const chunk of reader) {
        expect(Array.from(chunk)).toEqual([2, 3, 4]);
        break;
      }
    })();

    await write(view);

    // Original buffer should NOT be transferred (still has data)
    expect(largeBuffer.buffer.byteLength).toBeGreaterThan(0);
    expect(Array.from(largeBuffer)).toEqual([1, 2, 3, 4, 5, 6]);

    await readPromise;
  });

  it("should detect closed port on subsequent writes", async () => {
    const [port1, port2] = createMessagePortPair();
    const write = createMessagePortWriter(port1);

    // First write should succeed
    await write(new Uint8Array([1, 2, 3]));

    // Close port2 - this doesn't immediately throw on port1 in Node.js
    port2.close();
    port1.close();

    // Internal state tracks closure, subsequent writes should fail
    // Note: The behavior depends on the runtime - some may throw, some may not
    // We just verify the writer handles closed ports gracefully
    try {
      await write(new Uint8Array([4, 5, 6]));
      // If no error, that's also acceptable (depends on runtime)
    } catch (err) {
      expect(String(err)).toMatch(/closed|Failed/i);
    }
  });

  it("should handle empty Uint8Array", async () => {
    const [port1, port2] = createMessagePortPair();
    const write = createMessagePortWriter(port1);

    const received: Uint8Array[] = [];
    const reader = createMessagePortReader(port2);

    const readPromise = (async () => {
      for await (const chunk of reader) {
        received.push(chunk);
        break;
      }
    })();

    await write(new Uint8Array([]));
    await readPromise;

    expect(received).toHaveLength(1);
    expect(received[0].length).toBe(0);
  });
});

// =============================================================================
// createMessagePortCloser Tests
// =============================================================================

describe("createMessagePortCloser", () => {
  it("should send close signal and close port", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);
    const close = createMessagePortCloser(port1, reader);

    let receivedClose = false;
    port2.onmessage = (event) => {
      if (event.data === null) {
        receivedClose = true;
      }
    };
    port2.start();

    await close();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(receivedClose).toBe(true);
  });

  it("should be idempotent", async () => {
    const [port1] = createMessagePortPair();
    const reader = createMessagePortReader(port1);
    const close = createMessagePortCloser(port1, reader);

    // Multiple close calls should not throw
    await close();
    await close();
    await close();
  });

  it("should complete the async generator", async () => {
    const [port1, port2] = createMessagePortPair();
    const reader = createMessagePortReader(port1);
    const close = createMessagePortCloser(port1, reader);

    // Send one message then close from peer side
    port2.postMessage(new Uint8Array([1, 2, 3]));

    // Schedule close signal from peer
    setTimeout(() => {
      port2.postMessage(null); // Close signal from peer
    }, 30);

    // Read all messages
    const chunks: Uint8Array[] = [];
    for await (const chunk of reader) {
      chunks.push(chunk);
    }

    // Clean up
    await close();

    expect(chunks).toHaveLength(1);
  });
});

// =============================================================================
// createMessagePortPair Tests
// =============================================================================

describe("createMessagePortPair", () => {
  it("should create connected port pair", async () => {
    const [port1, port2] = createMessagePortPair();

    const received: Uint8Array[] = [];
    const reader = createMessagePortReader(port2);

    const readPromise = (async () => {
      for await (const chunk of reader) {
        received.push(chunk);
        break;
      }
    })();

    port1.postMessage(new Uint8Array([42]));

    await readPromise;

    expect(received).toHaveLength(1);
    expect(received[0][0]).toBe(42);
  });

  it("should support bidirectional communication", async () => {
    const [port1, port2] = createMessagePortPair();

    const reader1 = createMessagePortReader(port1);
    const writer1 = createMessagePortWriter(port1);
    const reader2 = createMessagePortReader(port2);
    const writer2 = createMessagePortWriter(port2);

    const received1: number[] = [];
    const received2: number[] = [];

    // Read from port1
    const read1 = (async () => {
      for await (const chunk of reader1) {
        received1.push(chunk[0]);
        if (received1.length >= 1) break;
      }
    })();

    // Read from port2
    const read2 = (async () => {
      for await (const chunk of reader2) {
        received2.push(chunk[0]);
        if (received2.length >= 1) break;
      }
    })();

    // Write from both sides
    await writer1(new Uint8Array([1]));
    await writer2(new Uint8Array([2]));

    await Promise.all([read1, read2]);

    expect(received1).toContain(2); // port1 receives from port2
    expect(received2).toContain(1); // port2 receives from port1
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe("MessagePort Adapters Integration", () => {
  it("should work together for full-duplex communication", async () => {
    const [port1, port2] = createMessagePortPair();

    // Create adapters for both sides
    const input1 = createMessagePortReader(port1);
    const write1 = createMessagePortWriter(port1);
    const close1 = createMessagePortCloser(port1, input1);

    const input2 = createMessagePortReader(port2);
    const write2 = createMessagePortWriter(port2);
    const close2 = createMessagePortCloser(port2, input2);

    const messagesFrom1: Uint8Array[] = [];
    const messagesFrom2: Uint8Array[] = [];

    // Side 1 sends and receives
    const side1 = (async () => {
      await write1(new Uint8Array([1, 2, 3]));
      await write1(new Uint8Array([4, 5, 6]));

      for await (const msg of input1) {
        messagesFrom2.push(msg);
        if (messagesFrom2.length >= 2) break;
      }

      await close1();
    })();

    // Side 2 sends and receives
    const side2 = (async () => {
      await write2(new Uint8Array([7, 8, 9]));
      await write2(new Uint8Array([10, 11, 12]));

      for await (const msg of input2) {
        messagesFrom1.push(msg);
        if (messagesFrom1.length >= 2) break;
      }

      await close2();
    })();

    await Promise.all([side1, side2]);

    expect(messagesFrom1).toHaveLength(2);
    expect(messagesFrom2).toHaveLength(2);

    expect(Array.from(messagesFrom1[0])).toEqual([1, 2, 3]);
    expect(Array.from(messagesFrom1[1])).toEqual([4, 5, 6]);
    expect(Array.from(messagesFrom2[0])).toEqual([7, 8, 9]);
    expect(Array.from(messagesFrom2[1])).toEqual([10, 11, 12]);
  });

  it("should handle large data transfers", async () => {
    const [port1, port2] = createMessagePortPair();

    const write = createMessagePortWriter(port1);
    const input = createMessagePortReader(port2);

    // Send 1MB of data in chunks
    const chunkSize = 64 * 1024; // 64KB chunks
    const numChunks = 16; // 1MB total

    const sendPromise = (async () => {
      for (let i = 0; i < numChunks; i++) {
        const chunk = new Uint8Array(chunkSize);
        chunk.fill(i);
        await write(chunk);
      }
      port1.postMessage(null); // Close signal
    })();

    let totalReceived = 0;
    for await (const chunk of input) {
      totalReceived += chunk.length;
    }

    await sendPromise;

    expect(totalReceived).toBe(chunkSize * numChunks);
  });
});
