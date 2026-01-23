/**
 * BidirectionalSocket tests for the ports-based implementation.
 * Tests basic functionality and performance of bidirectional communication.
 */

import { describe, expect, it } from "vitest";
import { createBidirectionalSocketPairPorts } from "../src/socket/bidirectional-socket-ports.js";

// =============================================================================
// Utility functions
// =============================================================================

function createTestData(size: number, pattern = 0): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = (pattern + i) % 256;
  }
  return data;
}

// =============================================================================
// Tests
// =============================================================================

describe("BidirectionalSocket with callPort/listenPort", () => {
  describe("basic functionality", () => {
    it("should send and receive data", async () => {
      const [socketA, socketB] = createBidirectionalSocketPairPorts();

      try {
        const testData = createTestData(1024);
        const expectedLength = testData.length; // Save before write (zero-copy transfer neuters buffer)
        let received: Uint8Array | undefined;

        const senderPromise = (async () => {
          await socketA.write(testData);
          await socketA.close();
        })();

        const receiverPromise = (async () => {
          for await (const chunk of socketB.input) {
            received = chunk;
            break;
          }
        })();

        await Promise.all([senderPromise, receiverPromise]);

        expect(received).toBeDefined();
        expect(received?.length).toBe(expectedLength);
      } finally {
        await socketB.close();
      }
    });

    it("should handle bidirectional communication", async () => {
      const [socketA, socketB] = createBidirectionalSocketPairPorts();

      try {
        const dataAtoB = createTestData(512, 0xaa);
        const dataBtoA = createTestData(512, 0xbb);
        // Save lengths before write (zero-copy transfer neuters buffers)
        const expectedAtoBLength = dataAtoB.length;
        const expectedBtoALength = dataBtoA.length;
        let receivedAtA: Uint8Array | undefined;
        let receivedAtB: Uint8Array | undefined;

        // A sends and receives
        const aPromise = Promise.all([
          (async () => {
            await socketA.write(dataAtoB);
          })(),
          (async () => {
            for await (const chunk of socketA.input) {
              receivedAtA = chunk;
              break;
            }
          })(),
        ]);

        // B sends and receives
        const bPromise = Promise.all([
          (async () => {
            await socketB.write(dataBtoA);
          })(),
          (async () => {
            for await (const chunk of socketB.input) {
              receivedAtB = chunk;
              break;
            }
          })(),
        ]);

        await Promise.all([aPromise, bPromise]);

        expect(receivedAtB?.length).toBe(expectedAtoBLength);
        expect(receivedAtA?.length).toBe(expectedBtoALength);
      } finally {
        await socketA.close();
        await socketB.close();
      }
    });
  });

  describe("performance tests", () => {
    const BLOCK_SIZE = 64 * 1024; // 64KB per write
    const COUNT = 1024; // 10k writes = 640MB
    const TOTAL_SIZE = BLOCK_SIZE * COUNT;

    it("should measure one-directional throughput (A -> B)", { timeout: 60000 }, async () => {
      const [socketA, socketB] = createBidirectionalSocketPairPorts({ timeout: 60000 });

      const startTime = performance.now();

      try {
        // Sender
        const sendPromise = (async () => {
          for (let i = 0; i < COUNT; i++) {
            await socketA.write(createTestData(BLOCK_SIZE, i));
          }
          await socketA.close();
        })();

        // Receiver
        let receivedBytes = 0;
        const receivePromise = (async () => {
          for await (const chunk of socketB.input) {
            receivedBytes += chunk.length;
          }
        })();

        await Promise.all([sendPromise, receivePromise]);

        const duration = performance.now() - startTime;
        const throughput = receivedBytes / (1024 * 1024) / (duration / 1000);

        expect(receivedBytes).toBe(TOTAL_SIZE);
        expect(throughput).toBeGreaterThan(0);
      } finally {
        await socketB.close();
      }
    });

    it("should measure bidirectional throughput (A <-> B)", { timeout: 120000 }, async () => {
      const [socketA, socketB] = createBidirectionalSocketPairPorts({ timeout: 60000 });

      const startTime = performance.now();

      try {
        let aReceivedBytes = 0;
        let bReceivedBytes = 0;
        let aClosed = false;
        let bClosed = false;

        // A sends and receives
        const aPromise = Promise.all([
          // A sends
          (async () => {
            for (let i = 0; i < COUNT; i++) {
              await socketA.write(createTestData(BLOCK_SIZE, i));
            }
            aClosed = true;
          })(),
          // A receives
          (async () => {
            for await (const chunk of socketA.input) {
              aReceivedBytes += chunk.length;
              if (aReceivedBytes >= TOTAL_SIZE && bClosed) break;
            }
          })(),
        ]);

        // B sends and receives
        const bPromise = Promise.all([
          // B sends
          (async () => {
            for (let i = 0; i < COUNT; i++) {
              await socketB.write(createTestData(BLOCK_SIZE, i + 1000));
            }
            bClosed = true;
          })(),
          // B receives
          (async () => {
            for await (const chunk of socketB.input) {
              bReceivedBytes += chunk.length;
              if (bReceivedBytes >= TOTAL_SIZE && aClosed) break;
            }
          })(),
        ]);

        await Promise.all([aPromise, bPromise]);

        const duration = performance.now() - startTime;
        const totalBytes = aReceivedBytes + bReceivedBytes;
        const throughput = totalBytes / (1024 * 1024) / (duration / 1000);

        expect(aReceivedBytes).toBe(TOTAL_SIZE);
        expect(bReceivedBytes).toBe(TOTAL_SIZE);
        expect(throughput).toBeGreaterThan(0);
      } finally {
        await socketA.close();
        await socketB.close();
      }
    });
  });
});
