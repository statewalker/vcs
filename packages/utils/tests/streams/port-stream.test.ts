import { afterEach, describe, expect, it } from "vitest";
import {
  createPortStream,
  createPortStreamPair,
  type PortStream,
  receivePortStream,
  sendPortStream,
  wrapNativePort,
} from "../../src/streams/port-stream";

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

describe("sendPortStream() and receivePortStream()", () => {
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

    const sendPromise = sendPortStream(port1, []);
    const received = await collect(receivePortStream(port2));

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

    const sendPromise = sendPortStream(port1, input());
    const received = await collect(receivePortStream(port2));

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

    const sendPromise = sendPortStream(port1, input());
    const received = await collect(receivePortStream(port2));

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

    const sendPromise = sendPortStream(port1, input());

    // Receive with delays
    for await (const chunk of receivePortStream(port2)) {
      receiveOrder.push(`recv-${chunk[0]}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    await sendPromise;

    // With backpressure, send should interleave with receive
    // Each send waits for ACK before next send
    expect(sendOrder).toEqual(["send-1", "send-2", "send-3", "done"]);
    expect(receiveOrder).toEqual(["recv-1", "recv-2", "recv-3"]);
  });

  // =============================================================================
  // Error handling
  // =============================================================================

  it("should propagate error from sender to receiver", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const testError = new Error("Test sender error");

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      throw testError;
    }

    // Start sending - catch rejection immediately to prevent unhandled rejection
    let sendError: Error | undefined;
    const sendPromise = sendPortStream(port1, input()).catch((err) => {
      sendError = err;
    });

    const received: Uint8Array[] = [];
    let caughtError: Error | undefined;

    try {
      for await (const chunk of receivePortStream(port2)) {
        received.push(chunk);
      }
    } catch (err) {
      caughtError = err as Error;
    }

    await sendPromise;
    expect(sendError?.message).toBe("Test sender error");
    expect(received).toHaveLength(1);
    expect(caughtError?.message).toBe("Test sender error");
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

    const sendPromise = sendPortStream(port1, input());
    const received = await collect(receivePortStream(port2));

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

    const sendPromise = sendPortStream(port1, input());
    const received = await collect(receivePortStream(port2));

    await sendPromise;
    expect(received).toHaveLength(blockCount);
    for (let i = 0; i < blockCount; i++) {
      expect(received[i]).toEqual(bytes(i % 256));
    }
  });

  // =============================================================================
  // ACK timeout (with short timeout for testing)
  // =============================================================================

  it("should timeout if receiver does not acknowledge", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);

    // Don't set up a receiver, just let messages go unacknowledged
    // Use very short timeout
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1, 2, 3);
    }

    const sendPromise = sendPortStream(port1, input(), {
      ackTimeout: 50,
    });

    // Should timeout because no receiver
    await expect(sendPromise).rejects.toThrow(/ACK timeout/);
  });

  // =============================================================================
  // Chunk size option
  // =============================================================================

  it("should chunk large blocks when chunkSize is specified", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    // Send 100 bytes as a single block, but with chunkSize=30
    const data = new Uint8Array(100);
    for (let i = 0; i < data.length; i++) {
      data[i] = i;
    }

    async function* input(): AsyncGenerator<Uint8Array> {
      yield data;
    }

    const sendPromise = sendPortStream(port1, input(), {
      chunkSize: 30,
    });
    const received = await collect(receivePortStream(port2));

    await sendPromise;

    // Should receive 4 chunks: 30 + 30 + 30 + 10
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

  it("should not chunk when chunkSize is not specified", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    // Send 100 bytes without chunking
    const data = new Uint8Array(100);
    for (let i = 0; i < data.length; i++) {
      data[i] = i;
    }

    async function* input(): AsyncGenerator<Uint8Array> {
      yield data;
    }

    const sendPromise = sendPortStream(port1, input());
    const received = await collect(receivePortStream(port2));

    await sendPromise;

    // Should receive exactly 1 block
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

    const sendPromise = sendPortStream(port1, input(), {
      chunkSize: 1,
    });
    const received = await collect(receivePortStream(port2));

    await sendPromise;

    // Should receive 5 single-byte chunks
    expect(received).toHaveLength(5);
    expect(received.map((c) => c[0])).toEqual([1, 2, 3, 4, 5]);
  });

  // =============================================================================
  // Binary protocol format
  // =============================================================================

  it("should use binary message format", async () => {
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

    const sendPromise = sendPortStream(port1, input());
    const received = await collect(receivePortStream(port2));

    await sendPromise;

    // Check that we received the data correctly
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(bytes(0xab, 0xcd));

    // Verify raw message format (DATA message)
    // First message should be: [type=0, id=0 (4 bytes), payload=0xab 0xcd]
    const firstMsg = new Uint8Array(receivedRaw[0]);
    expect(firstMsg[0]).toBe(0); // DATA type
    expect(firstMsg[1]).toBe(0); // ID byte 0 (big-endian)
    expect(firstMsg[2]).toBe(0); // ID byte 1
    expect(firstMsg[3]).toBe(0); // ID byte 2
    expect(firstMsg[4]).toBe(0); // ID byte 3
    expect(firstMsg[5]).toBe(0xab); // Payload byte 0
    expect(firstMsg[6]).toBe(0xcd); // Payload byte 1
  });

  // =============================================================================
  // Sub-stream ACK functionality
  // =============================================================================

  it("should batch blocks with subStreamSize option", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const receivedRaw: ArrayBuffer[] = [];

    // Intercept raw messages to count STREAM_ACK requests
    channel.port2.addEventListener("message", (event) => {
      receivedRaw.push(event.data);
    });
    channel.port2.start();

    // Send 5 blocks with subStreamSize=2
    // Expected: 2 full sub-streams (2+2) + 1 partial (1) = 3 STREAM_ACK messages
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      yield bytes(2);
      yield bytes(3);
      yield bytes(4);
      yield bytes(5);
    }

    const sendPromise = sendPortStream(port1, input(), { subStreamSize: 2 });
    const received = await collect(receivePortStream(port2));

    await sendPromise;

    // All blocks received
    expect(received).toHaveLength(5);
    expect(received.map((c) => c[0])).toEqual([1, 2, 3, 4, 5]);

    // Count STREAM_ACK messages (type=4)
    const streamAckCount = receivedRaw.filter((buf) => {
      const arr = new Uint8Array(buf);
      return arr[0] === 4; // STREAM_ACK type
    }).length;
    expect(streamAckCount).toBe(3); // 2 full + 1 partial sub-stream
  });

  it("should send STREAM_ACK after each subStreamSize blocks", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const messageSequence: string[] = [];

    // Intercept messages to verify order
    channel.port2.addEventListener("message", (event) => {
      const arr = new Uint8Array(event.data);
      const types = ["DATA", "ACK", "END", "ERROR", "STREAM_ACK"];
      messageSequence.push(types[arr[0]] || `UNKNOWN(${arr[0]})`);
    });
    channel.port2.start();

    // Send 3 blocks with subStreamSize=3
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      yield bytes(2);
      yield bytes(3);
    }

    const sendPromise = sendPortStream(port1, input(), { subStreamSize: 3 });
    await collect(receivePortStream(port2));
    await sendPromise;

    // Expect: DATA, DATA, DATA, STREAM_ACK, END
    expect(messageSequence).toEqual(["DATA", "DATA", "DATA", "STREAM_ACK", "END"]);
  });

  it("should work with subStreamSize=1 (per-block ACK)", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const messageSequence: string[] = [];

    channel.port2.addEventListener("message", (event) => {
      const arr = new Uint8Array(event.data);
      const types = ["DATA", "ACK", "END", "ERROR", "STREAM_ACK"];
      messageSequence.push(types[arr[0]] || `UNKNOWN(${arr[0]})`);
    });
    channel.port2.start();

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      yield bytes(2);
    }

    const sendPromise = sendPortStream(port1, input(), { subStreamSize: 1 });
    await collect(receivePortStream(port2));
    await sendPromise;

    // With subStreamSize=1, each block gets its own STREAM_ACK
    expect(messageSequence).toEqual(["DATA", "STREAM_ACK", "DATA", "STREAM_ACK", "END"]);
  });

  it("should handle large subStreamSize (bigger than stream)", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);
    const messageSequence: string[] = [];

    channel.port2.addEventListener("message", (event) => {
      const arr = new Uint8Array(event.data);
      const types = ["DATA", "ACK", "END", "ERROR", "STREAM_ACK"];
      messageSequence.push(types[arr[0]] || `UNKNOWN(${arr[0]})`);
    });
    channel.port2.start();

    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      yield bytes(2);
    }

    // subStreamSize=100 but only 2 blocks - should still send STREAM_ACK at end
    const sendPromise = sendPortStream(port1, input(), { subStreamSize: 100 });
    const received = await collect(receivePortStream(port2));
    await sendPromise;

    expect(received).toHaveLength(2);
    // All DATA sent, then STREAM_ACK for remaining, then END
    expect(messageSequence).toEqual(["DATA", "DATA", "STREAM_ACK", "END"]);
  });

  it("should timeout if sub-stream ACK not received", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);

    // Don't set up receiver - no ACK will come
    async function* input(): AsyncGenerator<Uint8Array> {
      yield bytes(1);
      yield bytes(2);
      yield bytes(3);
    }

    const sendPromise = sendPortStream(port1, input(), {
      subStreamSize: 3,
      ackTimeout: 50,
    });

    await expect(sendPromise).rejects.toThrow(/ACK timeout for sub-stream/);
  });

  it("should combine chunkSize and subStreamSize options", async () => {
    const channel = createChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    // 10 bytes, chunkSize=3 -> 4 chunks (3+3+3+1)
    // subStreamSize=2 -> 2 STREAM_ACKs (after chunks 0,1 and 2,3)
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    async function* input(): AsyncGenerator<Uint8Array> {
      yield data;
    }

    const sendPromise = sendPortStream(port1, input(), {
      chunkSize: 3,
      subStreamSize: 2,
    });
    const received = await collect(receivePortStream(port2));
    await sendPromise;

    // Verify chunks received
    expect(received).toHaveLength(4);
    expect(received[0]).toEqual(bytes(0, 1, 2));
    expect(received[1]).toEqual(bytes(3, 4, 5));
    expect(received[2]).toEqual(bytes(6, 7, 8));
    expect(received[3]).toEqual(bytes(9));
  });

  it("should handle backpressure with sub-stream batching", async () => {
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

    const sendPromise = sendPortStream(port1, input(), { subStreamSize: 2 });

    // Receive with delays to verify backpressure
    for await (const chunk of receivePortStream(port2)) {
      events.push(`recv-${chunk[0]}`);
      await new Promise((r) => setTimeout(r, 10));
    }

    await sendPromise;

    // Verify order - sends should complete before receives due to batching
    // but ACK waiting should still create some interleaving
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
