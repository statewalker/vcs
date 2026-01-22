import { afterEach, describe, expect, it } from "vitest";

import {
  createAwaitAckFunction,
  createPortStream,
  createPortStreamPair,
  type PortStream,
  readStream,
  sendWithAcknowledgement,
  wrapNativePort,
  writeStream,
} from "../../src/streams/port-stream";
import { splitStream } from "../../src/streams/split-stream";

// Track created resources for cleanup
const channels: MessageChannel[] = [];
const ports: PortStream[] = [];

function createChannel(): MessageChannel {
  const channel = new MessageChannel();
  channels.push(channel);
  return channel;
}

function createPair(): [PortStream, PortStream] {
  const [a, b] = createPortStreamPair();
  ports.push(a, b);
  return [a, b];
}

afterEach(() => {
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  channels.length = 0;

  for (const port of ports) {
    port.close();
  }
  ports.length = 0;
});

describe("writeStream() and readStream()", () => {
  // Helper to create Uint8Array from numbers
  function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
  }

  // Helper to collect all chunks
  async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
    const result: Uint8Array[] = [];
    for await (const chunk of stream) {
      result.push(chunk);
    }
    return result;
  }

  // =============================================================================
  // Basic functionality
  // =============================================================================

  it("should send and receive empty stream", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    const sendPromise = writeStream(port1, []);
    const received = await collect(readStream(port2));

    await sendPromise;
    expect(received).toEqual([]);
  });

  it("should send and receive single block", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1, 2, 3, 4, 5);
    }

    const sendPromise = writeStream(port1, input());
    const received = await collect(readStream(port2));

    await sendPromise;
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(bytes(1, 2, 3, 4, 5));
  });

  it("should send and receive multiple blocks", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1, 2);
      yield bytes(3, 4);
      yield bytes(5);
    }

    const sendPromise = writeStream(port1, input());
    const received = await collect(readStream(port2));

    await sendPromise;
    expect(received).toHaveLength(3);
    expect(received[0]).toEqual(bytes(1, 2));
    expect(received[1]).toEqual(bytes(3, 4));
    expect(received[2]).toEqual(bytes(5));
  });

  // =============================================================================
  // Backpressure
  // =============================================================================

  it("should implement backpressure - sender waits for receiver", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const sendOrder: string[] = [];
    const receiveOrder: string[] = [];

    async function* input(): AsyncGenerator<Uint8Array> {
      sendOrder.push("send-1");
      yield bytes(1);
      sendOrder.push("send-2");
      yield bytes(2);
      sendOrder.push("send-3");
      yield bytes(3);
      sendOrder.push("done");
    }

    const sendPromise = writeStream(port1, input());

    // Receive with delays
    for await (const chunk of readStream(port2)) {
      receiveOrder.push(`recv-${chunk[0]}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    await sendPromise;

    // With backpressure, send should interleave with receive
    expect(sendOrder).toEqual(["send-1", "send-2", "send-3", "done"]);
    expect(receiveOrder).toEqual(["recv-1", "recv-2", "recv-3"]);
  });

  // =============================================================================
  // PortStream interface
  // =============================================================================

  it("should work with createPortStream", async () => {
    const channel = createChannel();
    const stream1 = createPortStream(wrapNativePort(channel.port1));
    const stream2 = createPortStream(wrapNativePort(channel.port2));
    ports.push(stream1, stream2);

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1, 2, 3);
      yield bytes(4, 5);
    }

    const sendPromise = stream1.send(input());
    const received = await collect(stream2.receive());

    await sendPromise;
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(bytes(1, 2, 3));
    expect(received[1]).toEqual(bytes(4, 5));
  });

  it("should work with createPortStreamPair", async () => {
    const [stream1, stream2] = createPair();

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(10, 20);
      yield bytes(30);
    }

    const sendPromise = stream1.send(input());
    const received = await collect(stream2.receive());

    await sendPromise;
    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(bytes(10, 20));
    expect(received[1]).toEqual(bytes(30));
  });

  // =============================================================================
  // Data integrity
  // =============================================================================

  it("should preserve large data blocks", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const largeBlock = new Uint8Array(64 * 1024);
    for (let i = 0; i < largeBlock.length; i++) {
      largeBlock[i] = i % 256;
    }

    async function* input(): AsyncGenerator<Uint8Array> {
      yield largeBlock;
    }

    const sendPromise = writeStream(port1, input());
    const received = await collect(readStream(port2));

    await sendPromise;
    expect(received).toHaveLength(1);
    expect(received[0].length).toBe(largeBlock.length);
    expect(received[0]).toEqual(largeBlock);
  });

  it("should handle many small blocks", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const blockCount = 100;

    async function* input(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < blockCount; i++) {
        yield bytes(i % 256);
      }
    }

    const sendPromise = writeStream(port1, input());
    const received = await collect(readStream(port2));

    await sendPromise;
    expect(received).toHaveLength(blockCount);
    for (let i = 0; i < blockCount; i++) {
      expect(received[i]).toEqual(bytes(i % 256));
    }
  });

  // =============================================================================
  // ACK timeout
  // =============================================================================

  it("should timeout if receiver does not acknowledge", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);

    // Don't set up a receiver, just let messages go unacknowledged
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1, 2, 3);
    }

    const sendPromise = writeStream(port1, input(), {
      ackTimeout: 50,
    });

    // Should timeout because no receiver
    await expect(sendPromise).rejects.toThrow(/Timeout waiting for acknowledgement/);
  });

  // =============================================================================
  // Chunk size option (byte-based sub-stream splitting)
  // =============================================================================

  it("should split stream based on chunkSize bytes", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    // Send 100 bytes with chunkSize=30
    // Should trigger ACK after every 30 bytes
    const data = new Uint8Array(100);
    for (let i = 0; i < data.length; i++) {
      data[i] = i;
    }

    async function* input(): AsyncGenerator<Uint8Array> {
      yield data;
    }

    const sendPromise = writeStream(port1, input(), {
      chunkSize: 30,
    });
    const received = await collect(readStream(port2));

    await sendPromise;

    // Should receive the split blocks: 30 + 30 + 30 + 10
    expect(received).toHaveLength(4);
    expect(received[0].length).toBe(30);
    expect(received[1].length).toBe(30);
    expect(received[2].length).toBe(30);
    expect(received[3].length).toBe(10);

    // Verify data integrity
    const reconstructed = new Uint8Array(100);
    let offset = 0;
    for (const chunk of received) {
      reconstructed.set(chunk, offset);
      offset += chunk.length;
    }
    expect(reconstructed).toEqual(data);
  });

  it("should use default chunkSize of 64KB", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    // Send 100 bytes - should all go in one sub-stream since < 64KB
    const data = new Uint8Array(100);
    for (let i = 0; i < data.length; i++) {
      data[i] = i;
    }

    async function* input(): AsyncGenerator<Uint8Array> {
      yield data;
    }

    const sendPromise = writeStream(port1, input());
    const received = await collect(readStream(port2));

    await sendPromise;

    // Should receive exactly 1 block since it's under the default chunkSize
    expect(received).toHaveLength(1);
    expect(received[0].length).toBe(100);
    expect(received[0]).toEqual(data);
  });

  it("should work with chunkSize=1 (byte-by-byte)", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1, 2, 3, 4, 5);
    }

    const sendPromise = writeStream(port1, input(), {
      chunkSize: 1,
    });
    const received = await collect(readStream(port2));

    await sendPromise;

    // Should receive 5 single-byte chunks
    expect(received).toHaveLength(5);
    expect(received.map((c) => c[0])).toEqual([1, 2, 3, 4, 5]);
  });

  // =============================================================================
  // Binary protocol format
  // =============================================================================

  it("should use 9-byte header binary message format", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const receivedRaw: ArrayBuffer[] = [];

    // Intercept raw messages to verify format
    channel.port2.addEventListener("message", (event) => {
      receivedRaw.push(event.data);
    });
    channel.port2.start();

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(0xab, 0xcd);
    }

    const sendPromise = writeStream(port1, input());
    const received = await collect(readStream(port2));

    await sendPromise;

    // Check that we received the data correctly
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(bytes(0xab, 0xcd));

    // Verify raw message format (DATA message with 9-byte header)
    // Format: [type=3, id=4 bytes LE, length=4 bytes LE, payload]
    const dataMsg = receivedRaw.find((buf) => new Uint8Array(buf)[0] === 3);
    expect(dataMsg).toBeDefined();
    if (dataMsg) {
      const view = new DataView(dataMsg);
      expect(view.getUint8(0)).toBe(3); // DATA type
      expect(view.getUint32(1, true)).toBe(0); // ID (little-endian)
      expect(view.getUint32(5, true)).toBe(2); // Length (little-endian)
      expect(new Uint8Array(dataMsg, 9)[0]).toBe(0xab);
      expect(new Uint8Array(dataMsg, 9)[1]).toBe(0xcd);
    }
  });

  // =============================================================================
  // Byte-based sub-stream splitting
  // =============================================================================

  it("should request ACK after chunkSize bytes", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const messageTypes: number[] = [];

    // Intercept messages to track REQUEST_ACK messages
    channel.port2.addEventListener("message", (event) => {
      const type = new Uint8Array(event.data)[0];
      messageTypes.push(type);
    });
    channel.port2.start();

    // Send 5 bytes with chunkSize=2
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      yield bytes(2);
      yield bytes(3);
      yield bytes(4);
      yield bytes(5);
    }

    const sendPromise = writeStream(port1, input(), { chunkSize: 2 });
    await collect(readStream(port2));
    await sendPromise;

    // Count REQUEST_ACK messages (type=1)
    const requestAckCount = messageTypes.filter((t) => t === 1).length;
    // With 5 bytes and chunkSize=2: sub-streams of [2, 2, 1] bytes = 3 sub-streams
    // ACKs are sent BETWEEN sub-streams (2) + final ACK (1) = 3 REQUEST_ACKs
    expect(requestAckCount).toBe(3);
  });

  it("should handle large chunkSize (bigger than stream)", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const messageTypes: number[] = [];

    channel.port2.addEventListener("message", (event) => {
      const type = new Uint8Array(event.data)[0];
      messageTypes.push(type);
    });
    channel.port2.start();

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      yield bytes(2);
    }

    // chunkSize=100 but only 2 bytes - should send 1 REQUEST_ACK + final ACK
    const sendPromise = writeStream(port1, input(), { chunkSize: 100 });
    const received = await collect(readStream(port2));
    await sendPromise;

    expect(received).toHaveLength(2);
    // Should have: DATA, DATA, REQUEST_ACK (final), END
    const requestAckCount = messageTypes.filter((t) => t === 1).length;
    expect(requestAckCount).toBe(1); // Only final ACK
  });

  it("should handle backpressure with byte-based batching", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const events: string[] = [];

    async function* input(): AsyncGenerator<Uint8Array> {
      events.push("send-1");
      yield bytes(1);
      events.push("send-2");
      yield bytes(2);
      events.push("send-3"); // This should wait for ACK of sub-stream 1
      yield bytes(3);
      events.push("send-4");
      yield bytes(4);
      events.push("done");
    }

    const sendPromise = writeStream(port1, input(), { chunkSize: 2 });

    // Receive with delays to verify backpressure
    for await (const chunk of readStream(port2)) {
      events.push(`recv-${chunk[0]}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    await sendPromise;

    // Verify order
    expect(events).toContain("send-1");
    expect(events).toContain("send-2");
    expect(events).toContain("recv-1");
    expect(events).toContain("recv-2");
    expect(events).toContain("send-3");
    expect(events).toContain("send-4");
    expect(events).toContain("recv-3");
    expect(events).toContain("recv-4");
    expect(events).toContain("done");
  });
});

// =============================================================================
// splitStream with large blocks tests (task 1)
// =============================================================================

describe("splitStream with large blocks", () => {
  function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
  }

  async function* toAsyncIterable(arrays: Uint8Array[]): AsyncGenerator<Uint8Array> {
    for (const arr of arrays) {
      yield arr;
    }
  }

  it("should split block exactly at chunk boundary", async () => {
    const chunkSize = 10;
    const block = new Uint8Array(10).fill(42);
    let loadedSize = 0;

    const stream = splitStream(toAsyncIterable([block]), (b) => {
      const pos = Math.min(chunkSize, loadedSize + b.length) - loadedSize;
      if (pos < b.length) {
        loadedSize = 0;
        return pos;
      }
      loadedSize += b.length;
      return -1;
    });

    const substreams: Uint8Array[][] = [];
    for await (const sub of stream) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of sub) {
        chunks.push(chunk);
      }
      substreams.push(chunks);
    }

    expect(substreams.length).toBe(1); // Exactly 10 bytes = 1 sub-stream
  });

  it("should split single block larger than chunkSize", async () => {
    const chunkSize = 64 * 1024;
    const largeBlock = new Uint8Array(100_000).fill(42);
    let loadedSize = 0;

    const stream = splitStream(toAsyncIterable([largeBlock]), (b) => {
      const pos = Math.min(chunkSize, loadedSize + b.length) - loadedSize;
      if (pos < b.length) {
        loadedSize = 0;
        return pos;
      }
      loadedSize += b.length;
      return -1;
    });

    const substreams: Uint8Array[][] = [];
    for await (const sub of stream) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of sub) {
        chunks.push(chunk);
      }
      substreams.push(chunks);
    }

    expect(substreams.length).toBe(2); // 100KB / 64KB = 1.56, so 2 sub-streams
  });

  it("should split multiple large blocks", async () => {
    const chunkSize = 30;
    const block1 = new Uint8Array(50).fill(1);
    const block2 = new Uint8Array(50).fill(2);
    let loadedSize = 0;

    const stream = splitStream(toAsyncIterable([block1, block2]), (b) => {
      const pos = Math.min(chunkSize, loadedSize + b.length) - loadedSize;
      if (pos < b.length) {
        loadedSize = 0;
        return pos;
      }
      loadedSize += b.length;
      return -1;
    });

    const substreams: Uint8Array[][] = [];
    for await (const sub of stream) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of sub) {
        chunks.push(chunk);
      }
      substreams.push(chunks);
    }

    // 100 bytes total / 30 byte chunks = 4 sub-streams (30 + 30 + 30 + 10)
    expect(substreams.length).toBe(4);
  });

  it("should handle mixed sizes correctly", async () => {
    const chunkSize = 20;
    const blocks = [bytes(5, 5, 5), bytes(10, 10), bytes(25, 25, 25, 25, 25)]; // 3 + 2 + 5 = 10 items
    let loadedSize = 0;

    const stream = splitStream(toAsyncIterable(blocks), (b) => {
      const pos = Math.min(chunkSize, loadedSize + b.length) - loadedSize;
      if (pos < b.length) {
        loadedSize = 0;
        return pos;
      }
      loadedSize += b.length;
      return -1;
    });

    const substreams: Uint8Array[][] = [];
    for await (const sub of stream) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of sub) {
        chunks.push(chunk);
      }
      substreams.push(chunks);
    }

    // Total: 3 + 2 + 5 = 10 bytes / 20 byte chunks = 1 sub-stream
    expect(substreams.length).toBe(1);
  });

  it("should not produce empty sub-streams at boundaries", async () => {
    const chunkSize = 5;
    const block = bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
    let loadedSize = 0;

    const stream = splitStream(toAsyncIterable([block]), (b) => {
      const pos = Math.min(chunkSize, loadedSize + b.length) - loadedSize;
      if (pos < b.length) {
        loadedSize = 0;
        return pos;
      }
      loadedSize += b.length;
      return -1;
    });

    const substreams: Uint8Array[][] = [];
    for await (const sub of stream) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of sub) {
        chunks.push(chunk);
      }
      substreams.push(chunks);
    }

    // 10 bytes / 5 byte chunks = 2 sub-streams
    expect(substreams.length).toBe(2);
    // No empty sub-streams
    for (const ss of substreams) {
      expect(ss.length).toBeGreaterThan(0);
      const totalBytes = ss.reduce((sum, chunk) => sum + chunk.length, 0);
      expect(totalBytes).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Sender ACK wait behavior tests (task 2)
// =============================================================================

describe("createAwaitAckFunction", () => {
  it("should timeout if ACK not received", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const port = wrapNativePort(channel.port1);
    port.start();

    const awaitAck = createAwaitAckFunction(port, { ackTimeout: 50 });

    await expect(awaitAck()).rejects.toThrow("Timeout waiting for acknowledgement");
  });

  it("should resolve when matching ACK received", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    port1.start();
    port2.start();

    // Set up responder on port2
    port2.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      const view = new DataView(event.data);
      const type = view.getUint8(0);
      const id = view.getUint32(1, true);
      if (type === 1) {
        // REQUEST_ACK
        // Send ACKNOWLEDGE back
        const response = new ArrayBuffer(9);
        const responseView = new DataView(response);
        responseView.setUint8(0, 2); // ACKNOWLEDGE
        responseView.setUint32(1, id, true);
        responseView.setUint32(5, 0, true); // length = 0
        port2.postMessage(response);
      }
    });

    const awaitAck = createAwaitAckFunction(port1, { ackTimeout: 1000 });
    await expect(awaitAck()).resolves.toBeUndefined();
  });

  it("should ignore ACK with wrong message ID", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    port1.start();
    port2.start();

    // Set up responder that sends wrong ID
    port2.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      const view = new DataView(event.data);
      const type = view.getUint8(0);
      if (type === 1) {
        // REQUEST_ACK
        // Send ACKNOWLEDGE with wrong ID
        const response = new ArrayBuffer(9);
        const responseView = new DataView(response);
        responseView.setUint8(0, 2); // ACKNOWLEDGE
        responseView.setUint32(1, 999, true); // Wrong ID
        responseView.setUint32(5, 0, true);
        port2.postMessage(response);
      }
    });

    const awaitAck = createAwaitAckFunction(port1, { ackTimeout: 50 });
    await expect(awaitAck()).rejects.toThrow("Timeout waiting for acknowledgement");
  });

  it("should handle multiple sequential ACK requests", async () => {
    const channel = new MessageChannel();
    channels.push(channel);
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    port1.start();
    port2.start();

    // Set up responder
    port2.addEventListener("message", (event: MessageEvent<ArrayBuffer>) => {
      const view = new DataView(event.data);
      const type = view.getUint8(0);
      const id = view.getUint32(1, true);
      if (type === 1) {
        const response = new ArrayBuffer(9);
        const responseView = new DataView(response);
        responseView.setUint8(0, 2);
        responseView.setUint32(1, id, true);
        responseView.setUint32(5, 0, true);
        port2.postMessage(response);
      }
    });

    const awaitAck = createAwaitAckFunction(port1, { ackTimeout: 1000 });

    // Multiple sequential calls
    await expect(awaitAck()).resolves.toBeUndefined();
    await expect(awaitAck()).resolves.toBeUndefined();
    await expect(awaitAck()).resolves.toBeUndefined();
  });
});

// =============================================================================
// sendWithAcknowledgement tests
// =============================================================================

describe("sendWithAcknowledgement", () => {
  function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
  }

  async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
    const result: Uint8Array[] = [];
    for await (const chunk of stream) {
      result.push(chunk);
    }
    return result;
  }

  it("should yield all chunks when awaitAck resolves", async () => {
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1, 2);
      yield bytes(3, 4);
      yield bytes(5, 6);
    }

    let ackCount = 0;
    const awaitAck = async () => {
      ackCount++;
    };

    const result = await collect(sendWithAcknowledgement(input(), awaitAck, { chunkSize: 2 }));

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(bytes(1, 2));
    expect(result[1]).toEqual(bytes(3, 4));
    expect(result[2]).toEqual(bytes(5, 6));
    expect(ackCount).toBe(2); // ACK after 2nd and 3rd sub-streams
  });

  it("should split based on byte count not block count", async () => {
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1); // 1 byte
      yield bytes(2, 3); // 2 bytes -> total 3
      yield bytes(4, 5, 6); // 3 bytes -> total 6 (crosses 5-byte boundary)
    }

    let ackCount = 0;
    const awaitAck = async () => {
      ackCount++;
    };

    const result = await collect(sendWithAcknowledgement(input(), awaitAck, { chunkSize: 5 }));

    expect(result).toHaveLength(4); // Split at byte 5
    expect(ackCount).toBe(1); // One ACK between sub-streams
  });
});
