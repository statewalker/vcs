/**
 * Tests for port-git-stream: P2P Transport Bridge.
 *
 * Verifies that createGitStreamFromPort correctly bridges
 * MessagePortLike to GitBidirectionalStream interfaces.
 */

import { wrapNativePort } from "@statewalker/vcs-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  createGitStreamFromPort,
  createGitStreamPair,
  type PortGitStreamResult,
} from "../src/peer/port-git-stream.js";

// Track created resources for cleanup
const channels: MessageChannel[] = [];
const streams: PortGitStreamResult[] = [];

function createChannel(): MessageChannel {
  const channel = new MessageChannel();
  channels.push(channel);
  return channel;
}

function createStreamPair(): [PortGitStreamResult, PortGitStreamResult] {
  const [result1, result2] = createGitStreamPair();
  streams.push(result1, result2);
  return [result1, result2];
}

function createStreamFromChannel(): [PortGitStreamResult, PortGitStreamResult] {
  const channel = createChannel();
  const result1 = createGitStreamFromPort(wrapNativePort(channel.port1));
  const result2 = createGitStreamFromPort(wrapNativePort(channel.port2));
  streams.push(result1, result2);
  return [result1, result2];
}

afterEach(async () => {
  // Close all streams - use timeout to prevent hanging
  const closePromises = streams.map(async (result) => {
    try {
      result.closePort();
    } catch {
      // Ignore port close errors
    }
  });

  // Wait with timeout
  await Promise.race([
    Promise.all(closePromises),
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);

  streams.length = 0;

  // Close all channels
  for (const channel of channels) {
    try {
      channel.port1.close();
      channel.port2.close();
    } catch {
      // Ignore close errors
    }
  }
  channels.length = 0;
});

// Helper to create Uint8Array from string
function bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper to convert Uint8Array to string
function bytesToString(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

// Helper to collect all data from input stream
async function collectInput(stream: PortGitStreamResult): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream.stream.input) {
    chunks.push(chunk);
  }
  return chunks;
}

// =============================================================================
// Stream Creation
// =============================================================================

describe("createGitStreamFromPort - Creation", () => {
  it("should create a bidirectional stream from MessagePort", () => {
    const [result1, result2] = createStreamFromChannel();

    expect(result1.stream).toBeDefined();
    expect(result1.stream.input).toBeDefined();
    expect(result1.stream.output).toBeDefined();
    expect(result1.writeCompletion).toBeInstanceOf(Promise);
    expect(typeof result1.closePort).toBe("function");

    expect(result2.stream).toBeDefined();
    expect(result2.stream.input).toBeDefined();
    expect(result2.stream.output).toBeDefined();
  });

  it("should create connected stream pair with createGitStreamPair", () => {
    const [result1, result2] = createStreamPair();

    expect(result1.stream).toBeDefined();
    expect(result2.stream).toBeDefined();
  });
});

// =============================================================================
// Basic Data Transfer
// =============================================================================

describe("createGitStreamFromPort - Basic Data Transfer", () => {
  it("should send and receive a single chunk", async () => {
    const [sender, receiver] = createStreamPair();
    const testData = bytes("hello world");

    // Start receiving
    const receivePromise = collectInput(receiver);

    // Send data
    await sender.stream.output.write(testData);
    await sender.stream.output.close();
    await sender.writeCompletion;

    // Get received data
    const received = await receivePromise;

    expect(received.length).toBeGreaterThan(0);
    const combined = concatBytes(received);
    expect(bytesToString(combined)).toBe("hello world");
  });

  it("should send and receive multiple chunks", async () => {
    const [sender, receiver] = createStreamPair();

    // Start receiving
    const receivePromise = collectInput(receiver);

    // Send multiple chunks
    await sender.stream.output.write(bytes("chunk1"));
    await sender.stream.output.write(bytes("chunk2"));
    await sender.stream.output.write(bytes("chunk3"));
    await sender.stream.output.close();
    await sender.writeCompletion;

    // Get received data
    const received = await receivePromise;

    const combined = concatBytes(received);
    expect(bytesToString(combined)).toBe("chunk1chunk2chunk3");
  });

  it("should handle empty writes gracefully", async () => {
    const [sender, receiver] = createStreamPair();

    // Start receiving
    const receivePromise = collectInput(receiver);

    // Send empty data
    await sender.stream.output.write(new Uint8Array(0));
    await sender.stream.output.write(bytes("data"));
    await sender.stream.output.close();
    await sender.writeCompletion;

    const received = await receivePromise;
    const combined = concatBytes(received);
    expect(bytesToString(combined)).toBe("data");
  });
});

// =============================================================================
// Bidirectional Communication
// =============================================================================

describe("createGitStreamFromPort - Bidirectional Communication", () => {
  it("should allow simultaneous read and write on both ends", async () => {
    const [streamA, streamB] = createStreamPair();

    // A sends to B, B sends to A simultaneously
    const sendAPromise = (async () => {
      await streamA.stream.output.write(bytes("from A"));
      await streamA.stream.output.close();
      await streamA.writeCompletion;
    })();

    const sendBPromise = (async () => {
      await streamB.stream.output.write(bytes("from B"));
      await streamB.stream.output.close();
      await streamB.writeCompletion;
    })();

    // Receive on both ends
    const [receivedByB, receivedByA] = await Promise.all([
      collectInput(streamA), // A receives what B sent
      collectInput(streamB), // B receives what A sent
    ]);

    await Promise.all([sendAPromise, sendBPromise]);

    // Verify data transfer
    expect(bytesToString(concatBytes(receivedByB))).toBe("from B");
    expect(bytesToString(concatBytes(receivedByA))).toBe("from A");
  });

  it("should handle interleaved reads and writes", async () => {
    const [streamA, streamB] = createStreamPair();

    // Interleave operations
    const operations = async () => {
      // A writes first
      await streamA.stream.output.write(bytes("A1"));

      // B writes response
      await streamB.stream.output.write(bytes("B1"));

      // A writes more
      await streamA.stream.output.write(bytes("A2"));

      // B writes more
      await streamB.stream.output.write(bytes("B2"));

      // Close both
      await streamA.stream.output.close();
      await streamB.stream.output.close();
      await Promise.all([streamA.writeCompletion, streamB.writeCompletion]);
    };

    // Collect data from both streams
    const [receivedByA, receivedByB] = await Promise.all([
      collectInput(streamA),
      collectInput(streamB),
      operations(),
    ]);

    expect(bytesToString(concatBytes(receivedByA))).toBe("B1B2");
    expect(bytesToString(concatBytes(receivedByB))).toBe("A1A2");
  });
});

// =============================================================================
// Binary Data
// =============================================================================

describe("createGitStreamFromPort - Binary Data", () => {
  it("should preserve all byte values (0-255)", async () => {
    const [sender, receiver] = createStreamPair();

    // Create data with all byte values
    const allBytes = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      allBytes[i] = i;
    }

    const receivePromise = collectInput(receiver);

    await sender.stream.output.write(allBytes);
    await sender.stream.output.close();
    await sender.writeCompletion;

    const received = await receivePromise;
    const combined = concatBytes(received);

    expect(combined.length).toBe(256);
    for (let i = 0; i < 256; i++) {
      expect(combined[i]).toBe(i);
    }
  });

  it("should handle large data transfers", async () => {
    const [sender, receiver] = createStreamPair();

    // Create 100KB of data
    const largeData = new Uint8Array(100 * 1024);
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    const receivePromise = collectInput(receiver);

    await sender.stream.output.write(largeData);
    await sender.stream.output.close();
    await sender.writeCompletion;

    const received = await receivePromise;
    const combined = concatBytes(received);

    expect(combined.length).toBe(largeData.length);
    // Verify some samples
    expect(combined[0]).toBe(0);
    expect(combined[1000]).toBe(1000 % 256);
    expect(combined[50000]).toBe(50000 % 256);
  });
});

// =============================================================================
// Stream Close
// =============================================================================

describe("createGitStreamFromPort - Stream Close", () => {
  it("should allow closing the stream via closePort", async () => {
    const [result1, result2] = createStreamPair();

    // Close via port (immediate) rather than stream.close() which waits for ACKs
    result1.closePort();
    result2.closePort();

    // No errors expected
  });

  it("should close output properly and signal end to receiver", async () => {
    const [sender, receiver] = createStreamPair();

    const receivePromise = collectInput(receiver);

    await sender.stream.output.write(bytes("data"));
    await sender.stream.output.close();
    await sender.writeCompletion;

    // Receiver should get data and then complete
    const received = await receivePromise;
    expect(bytesToString(concatBytes(received))).toBe("data");
  });

  it("should allow closePort to terminate connection", async () => {
    const [result1, _result2] = createStreamPair();

    result1.closePort();

    // The other side should eventually see the close
    // Note: This may throw or complete depending on timing
  });
});

// =============================================================================
// GitInputStream Methods
// =============================================================================

describe("createGitStreamFromPort - GitInputStream Methods", () => {
  it("should support read(n) for exact byte reads", async () => {
    const [sender, receiver] = createStreamPair();

    // Send data in background
    const sendPromise = (async () => {
      await sender.stream.output.write(bytes("hello world"));
      await sender.stream.output.close();
      await sender.writeCompletion;
    })();

    // Read exact number of bytes
    const chunk1 = await receiver.stream.input.read(5);
    const chunk2 = await receiver.stream.input.read(1);
    const chunk3 = await receiver.stream.input.read(5);

    await sendPromise;

    expect(bytesToString(chunk1)).toBe("hello");
    expect(bytesToString(chunk2)).toBe(" ");
    expect(bytesToString(chunk3)).toBe("world");
  });

  it("should support hasMore() check", async () => {
    const [sender, receiver] = createStreamPair();

    // Initially nothing sent
    const sendPromise = (async () => {
      await sender.stream.output.write(bytes("test"));
      await sender.stream.output.close();
      await sender.writeCompletion;
    })();

    // Should have data after send
    const hasData = await receiver.stream.input.hasMore();
    expect(hasData).toBe(true);

    // Read all data
    for await (const _chunk of receiver.stream.input) {
      // Consume
    }

    await sendPromise;
  });
});

// =============================================================================
// GitOutputStream Methods
// =============================================================================

describe("createGitStreamFromPort - GitOutputStream Methods", () => {
  it("should support flush()", async () => {
    const [sender, receiver] = createStreamPair();

    const receivePromise = collectInput(receiver);

    await sender.stream.output.write(bytes("data"));
    await sender.stream.output.flush();
    await sender.stream.output.close();
    await sender.writeCompletion;

    const received = await receivePromise;
    expect(bytesToString(concatBytes(received))).toBe("data");
  });

  it("should throw on write after close", async () => {
    const [sender] = createStreamPair();

    await sender.stream.output.close();

    await expect(sender.stream.output.write(bytes("data"))).rejects.toThrow();
  });
});

// =============================================================================
// Options
// =============================================================================

describe("createGitStreamFromPort - Options", () => {
  it("should accept chunkSize option", () => {
    const channel = createChannel();
    const result = createGitStreamFromPort(wrapNativePort(channel.port1), {
      chunkSize: 1024,
    });
    streams.push(result);

    expect(result.stream).toBeDefined();
  });

  it("should accept ackTimeout option", () => {
    const channel = createChannel();
    const result = createGitStreamFromPort(wrapNativePort(channel.port1), {
      ackTimeout: 5000,
    });
    streams.push(result);

    expect(result.stream).toBeDefined();
  });
});

// =============================================================================
// Stress Tests
// =============================================================================

describe("createGitStreamFromPort - Stress Tests", () => {
  it("should handle many small writes", async () => {
    const [sender, receiver] = createStreamPair();

    const receivePromise = collectInput(receiver);

    // Send many small chunks
    const count = 100;
    for (let i = 0; i < count; i++) {
      await sender.stream.output.write(bytes(`${i},`));
    }
    await sender.stream.output.close();
    await sender.writeCompletion;

    const received = await receivePromise;
    const combined = bytesToString(concatBytes(received));

    // Verify all numbers are present
    for (let i = 0; i < count; i++) {
      expect(combined).toContain(`${i},`);
    }
  });

  it("should handle rapid bidirectional exchange", async () => {
    const [streamA, streamB] = createStreamPair();
    const rounds = 10;
    const messagesA: string[] = [];
    const messagesB: string[] = [];

    // Collect messages in background
    const collectA = (async () => {
      for await (const chunk of streamA.stream.input) {
        messagesA.push(bytesToString(chunk));
      }
    })();

    const collectB = (async () => {
      for await (const chunk of streamB.stream.input) {
        messagesB.push(bytesToString(chunk));
      }
    })();

    // Send messages back and forth
    for (let i = 0; i < rounds; i++) {
      await streamA.stream.output.write(bytes(`A${i}`));
      await streamB.stream.output.write(bytes(`B${i}`));
    }

    await streamA.stream.output.close();
    await streamB.stream.output.close();
    await Promise.all([streamA.writeCompletion, streamB.writeCompletion]);

    await Promise.all([collectA, collectB]);

    // Verify all messages received
    const allA = messagesA.join("");
    const allB = messagesB.join("");

    for (let i = 0; i < rounds; i++) {
      expect(allA).toContain(`B${i}`);
      expect(allB).toContain(`A${i}`);
    }
  });
});

// =============================================================================
// Helper Functions
// =============================================================================

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
