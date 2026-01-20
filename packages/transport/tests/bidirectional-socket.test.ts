/**
 * Comprehensive unit tests for BidirectionalSocket.
 *
 * Tests cover:
 * - Factory functions
 * - Unidirectional communication (A → B, B → A)
 * - Bidirectional communication
 * - Backpressure handling
 * - Close behavior
 * - Error handling
 * - Edge cases
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createBidirectionalSocket,
  createBidirectionalSocketPair,
  type BidirectionalSocket,
} from "../src/socket/index.js";
import { wrapNativePort } from "@statewalker/vcs-utils";

/**
 * Helper to concatenate multiple Uint8Arrays into one.
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

/**
 * Helper to collect all data from an async iterable.
 */
async function collectAll(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of iterable) {
    chunks.push(chunk);
  }
  return concatBytes(chunks);
}

/**
 * Helper to create test data of specified size.
 */
function createTestData(size: number, pattern = 0): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = (pattern + i) % 256;
  }
  return data;
}

describe("BidirectionalSocket", () => {
  // ============================================
  // Factory Tests
  // ============================================

  describe("createBidirectionalSocket", () => {
    it("should create a socket from MessagePort", () => {
      const channel = new MessageChannel();
      const socket = createBidirectionalSocket(wrapNativePort(channel.port1));

      expect(socket).toBeDefined();
      expect(typeof socket.read).toBe("function");
      expect(typeof socket.write).toBe("function");
      expect(typeof socket.close).toBe("function");

      // Cleanup
      channel.port1.close();
      channel.port2.close();
    });

    it("should accept custom chunkSize option", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair({ chunkSize: 1024 });

      // Should work with smaller chunks
      const data = createTestData(500);

      // Start receiving before writing
      const receivePromise = collectAll(socketB.read());

      await socketA.write(data);
      await socketA.close();

      const received = await receivePromise;
      expect(received).toEqual(data);

      await socketB.close();
    });

    it("should accept custom ackTimeout option", () => {
      const channel = new MessageChannel();
      const socket = createBidirectionalSocket(wrapNativePort(channel.port1), {
        ackTimeout: 10000,
      });

      expect(socket).toBeDefined();

      // Cleanup
      channel.port1.close();
      channel.port2.close();
    });
  });

  describe("createBidirectionalSocketPair", () => {
    it("should create two connected sockets", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      expect(socketA).toBeDefined();
      expect(socketB).toBeDefined();

      // Test connectivity
      const testData = new Uint8Array([1, 2, 3]);
      const receivePromise = collectAll(socketB.read());

      await socketA.write(testData);
      await socketA.close();

      const received = await receivePromise;
      expect(received).toEqual(testData);

      await socketB.close();
    });

    it("should pass options to both sockets", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair({ chunkSize: 512 });

      const data = createTestData(256);
      const receivePromise = collectAll(socketB.read());

      await socketA.write(data);
      await socketA.close();

      const received = await receivePromise;
      expect(received).toEqual(data);

      await socketB.close();
    });
  });

  // ============================================
  // Unidirectional Communication Tests
  // ============================================

  describe("unidirectional communication", () => {
    let socketA: BidirectionalSocket;
    let socketB: BidirectionalSocket;

    beforeEach(() => {
      [socketA, socketB] = createBidirectionalSocketPair();
    });

    afterEach(async () => {
      await socketA.close();
      await socketB.close();
    });

    describe("A → B", () => {
      it("should send single small message", async () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const receivePromise = collectAll(socketB.read());

        await socketA.write(data);
        await socketA.close();

        const received = await receivePromise;
        expect(received).toEqual(data);
      });

      it("should send single large message (> chunkSize)", async () => {
        // Default chunkSize is 64KB, send 100KB
        const data = createTestData(100 * 1024);
        const receivePromise = collectAll(socketB.read());

        await socketA.write(data);
        await socketA.close();

        const received = await receivePromise;
        expect(received).toEqual(data);
      });

      it("should send multiple messages in order", async () => {
        const messages = [
          new Uint8Array([1, 2, 3]),
          new Uint8Array([4, 5, 6]),
          new Uint8Array([7, 8, 9]),
        ];

        const receivePromise = collectAll(socketB.read());

        for (const msg of messages) {
          await socketA.write(msg);
        }
        await socketA.close();

        const received = await receivePromise;
        expect(received).toEqual(concatBytes(messages));
      });

      it("should handle empty message", async () => {
        const data = new Uint8Array(0);
        const receivePromise = collectAll(socketB.read());

        await socketA.write(data);
        await socketA.close();

        const received = await receivePromise;
        // Empty writes may or may not produce output, but should not fail
        expect(received.length).toBe(0);
      });
    });

    describe("B → A", () => {
      it("should send single small message", async () => {
        const data = new Uint8Array([10, 20, 30, 40, 50]);
        const receivePromise = collectAll(socketA.read());

        await socketB.write(data);
        await socketB.close();

        const received = await receivePromise;
        expect(received).toEqual(data);
      });

      it("should send single large message (> chunkSize)", async () => {
        const data = createTestData(80 * 1024, 42);
        const receivePromise = collectAll(socketA.read());

        await socketB.write(data);
        await socketB.close();

        const received = await receivePromise;
        expect(received).toEqual(data);
      });

      it("should send multiple messages in order", async () => {
        const messages = [createTestData(100, 1), createTestData(200, 2), createTestData(300, 3)];

        const receivePromise = collectAll(socketA.read());

        for (const msg of messages) {
          await socketB.write(msg);
        }
        await socketB.close();

        const received = await receivePromise;
        expect(received).toEqual(concatBytes(messages));
      });
    });

    describe("backpressure", () => {
      it("should handle 1MB transfer with default chunkSize", async () => {
        const data = createTestData(1024 * 1024);
        const receivePromise = collectAll(socketB.read());

        await socketA.write(data);
        await socketA.close();

        const received = await receivePromise;
        expect(received.length).toBe(data.length);
        expect(received).toEqual(data);
      });

      it("should handle 1MB transfer with small chunkSize (4KB)", async () => {
        const [smallA, smallB] = createBidirectionalSocketPair({ chunkSize: 4 * 1024 });

        const data = createTestData(1024 * 1024);
        const receivePromise = collectAll(smallB.read());

        await smallA.write(data);
        await smallA.close();

        const received = await receivePromise;
        expect(received.length).toBe(data.length);
        expect(received).toEqual(data);

        await smallB.close();
      });

      it("should not lose data under pressure", async () => {
        const messages: Uint8Array[] = [];
        for (let i = 0; i < 100; i++) {
          messages.push(createTestData(10 * 1024, i));
        }

        const receivePromise = collectAll(socketB.read());

        // Send all messages quickly
        for (const msg of messages) {
          await socketA.write(msg);
        }
        await socketA.close();

        const received = await receivePromise;
        expect(received).toEqual(concatBytes(messages));
      });
    });
  });

  // ============================================
  // Bidirectional Communication Tests
  // ============================================

  describe("bidirectional communication", () => {
    it("should support simultaneous send/receive", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const dataA = createTestData(1000, 1);
      const dataB = createTestData(1000, 2);

      // Start receivers
      const receiveAtA = collectAll(socketA.read());
      const receiveAtB = collectAll(socketB.read());

      // Send simultaneously
      await Promise.all([socketA.write(dataA), socketB.write(dataB)]);

      await socketA.close();
      await socketB.close();

      const [receivedAtA, receivedAtB] = await Promise.all([receiveAtA, receiveAtB]);

      expect(receivedAtA).toEqual(dataB);
      expect(receivedAtB).toEqual(dataA);
    });

    it("should handle interleaved request/response pattern", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      // Simulate request/response
      const request = new Uint8Array([1, 2, 3]);
      const response = new Uint8Array([4, 5, 6]);

      // A sends request, B receives and responds
      const handleB = (async () => {
        const chunks: Uint8Array[] = [];
        for await (const chunk of socketB.read()) {
          chunks.push(chunk);
          // After receiving, send response
          if (concatBytes(chunks).length >= request.length) {
            await socketB.write(response);
            await socketB.close();
            break;
          }
        }
      })();

      // A sends request and waits for response
      await socketA.write(request);
      await socketA.close();

      const receivedResponse = await collectAll(socketA.read());

      await handleB;

      expect(receivedResponse).toEqual(response);
    });

    it("should handle concurrent large transfers both directions", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const dataAtoB = createTestData(500 * 1024, 1);
      const dataBtoA = createTestData(500 * 1024, 2);

      const receiveAtA = collectAll(socketA.read());
      const receiveAtB = collectAll(socketB.read());

      // Start sending in both directions
      const sendA = socketA.write(dataAtoB).then(() => socketA.close());
      const sendB = socketB.write(dataBtoA).then(() => socketB.close());

      await Promise.all([sendA, sendB]);

      const [receivedAtA, receivedAtB] = await Promise.all([receiveAtA, receiveAtB]);

      expect(receivedAtA).toEqual(dataBtoA);
      expect(receivedAtB).toEqual(dataAtoB);
    });

    it("should maintain message ordering per direction", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const messagesAtoB = [createTestData(100, 10), createTestData(100, 20), createTestData(100, 30)];

      const messagesBtoA = [createTestData(100, 40), createTestData(100, 50), createTestData(100, 60)];

      const receiveAtA = collectAll(socketA.read());
      const receiveAtB = collectAll(socketB.read());

      // Send interleaved
      for (let i = 0; i < 3; i++) {
        await socketA.write(messagesAtoB[i]);
        await socketB.write(messagesBtoA[i]);
      }

      await socketA.close();
      await socketB.close();

      const [receivedAtA, receivedAtB] = await Promise.all([receiveAtA, receiveAtB]);

      expect(receivedAtA).toEqual(concatBytes(messagesBtoA));
      expect(receivedAtB).toEqual(concatBytes(messagesAtoB));
    });
  });

  // ============================================
  // Close Behavior Tests
  // ============================================

  describe("close behavior", () => {
    it("should complete pending writes before closing", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const data = createTestData(10000);
      const receivePromise = collectAll(socketB.read());

      // Write and immediately close
      await socketA.write(data);
      await socketA.close();

      const received = await receivePromise;
      expect(received).toEqual(data);

      await socketB.close();
    });

    it("should signal end to remote reader", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      // Close A without writing
      await socketA.close();

      // B should see end of stream
      const received = await collectAll(socketB.read());
      expect(received.length).toBe(0);

      await socketB.close();
    });

    it("should allow multiple close() calls (idempotent)", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      await socketA.close();
      await socketA.close(); // Should not throw
      await socketA.close(); // Should not throw

      await socketB.close();
    });

    it("should resolve close() only after writeStream completes", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const data = createTestData(100000);
      const receivePromise = collectAll(socketB.read());

      await socketA.write(data);

      // Close should wait for writeStream to finish
      await socketA.close();

      // All data should be received
      const received = await receivePromise;
      expect(received).toEqual(data);

      await socketB.close();
    });
  });

  // ============================================
  // Error Handling Tests
  // ============================================

  describe("error handling", () => {
    it("should throw when writing to closed socket", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      await socketA.close();

      await expect(socketA.write(new Uint8Array([1, 2, 3]))).rejects.toThrow(
        "Cannot write: socket closed",
      );

      await socketB.close();
    });

    it("should handle read without any writes", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      // Close without writing
      await socketA.close();

      // Read should complete with empty result
      const received = await collectAll(socketB.read());
      expect(received.length).toBe(0);

      await socketB.close();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe("edge cases", () => {
    it("should handle zero-length writes", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const receivePromise = collectAll(socketB.read());

      await socketA.write(new Uint8Array(0));
      await socketA.write(new Uint8Array([1, 2, 3]));
      await socketA.write(new Uint8Array(0));
      await socketA.close();

      const received = await receivePromise;
      expect(received).toEqual(new Uint8Array([1, 2, 3]));

      await socketB.close();
    });

    it("should handle many small messages (1000 x 100 bytes)", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const messages: Uint8Array[] = [];
      for (let i = 0; i < 1000; i++) {
        messages.push(createTestData(100, i));
      }

      const receivePromise = collectAll(socketB.read());

      for (const msg of messages) {
        await socketA.write(msg);
      }
      await socketA.close();

      const received = await receivePromise;
      expect(received).toEqual(concatBytes(messages));

      await socketB.close();
    });

    it("should handle very large single message (5MB)", async () => {
      const [socketA, socketB] = createBidirectionalSocketPair();

      const data = createTestData(5 * 1024 * 1024);
      const receivePromise = collectAll(socketB.read());

      await socketA.write(data);
      await socketA.close();

      const received = await receivePromise;
      expect(received.length).toBe(data.length);
      expect(received).toEqual(data);

      await socketB.close();
    }, 30000); // Longer timeout for large transfer

    it(
      "should handle rapid open/close cycles",
      async () => {
        for (let i = 0; i < 10; i++) {
          // Use short ack timeout for faster cycling
          const [socketA, socketB] = createBidirectionalSocketPair({ ackTimeout: 500 });

          const data = createTestData(100, i);
          const receivePromise = collectAll(socketB.read());

          await socketA.write(data);
          await socketA.close();

          const received = await receivePromise;
          expect(received).toEqual(data);

          await socketB.close();
        }
      },
      60000,
    ); // Longer timeout for 10 cycles
  });
});
