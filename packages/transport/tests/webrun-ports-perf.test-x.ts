/**
 * Performance test for @statewalker/webrun-ports library.
 *
 * Tests full duplex streaming over MessagePorts:
 * - Simultaneously send ~100MB in one direction
 * - Receive ~100MB in the other direction
 * - Measure time for both operations
 */

import { describe, expect, it } from "vitest";

// Import webrun-ports library
// @ts-expect-error - importing from JS library in tmp folder
import callBidi from "../../../tmp/webrun-ports/src/callBidi.js";
// @ts-expect-error
import callPort from "../../../tmp/webrun-ports/src/callPort.js";
// @ts-expect-error
import listenBidi from "../../../tmp/webrun-ports/src/listenBidi.js";
// @ts-expect-error
import listenPort from "../../../tmp/webrun-ports/src/listenPort.js";
// @ts-expect-error
import recieve from "../../../tmp/webrun-ports/src/recieve.js";
// @ts-expect-error
import send from "../../../tmp/webrun-ports/src/send.js";

/**
 * Create test data of specified size with predictable pattern.
 */
function createTestData(size: number, pattern = 0): Uint8Array {
  const data = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    data[i] = (pattern + i) % 256;
  }
  return data;
}

/**
 * Verify data integrity by comparing arrays.
 */
function verifyData(received: Uint8Array, expected: Uint8Array): boolean {
  if (received.length !== expected.length) return false;
  for (let i = 0; i < expected.length; i++) {
    if (received[i] !== expected[i]) return false;
  }
  return true;
}

/**
 * Concatenate multiple Uint8Arrays.
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
 * Create a started MessageChannel pair.
 */
function newMessageChannel(): MessageChannel {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.start();
  return channel;
}

/**
 * Format bytes for display.
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(2)} KB`;
  }
  return `${bytes} bytes`;
}

/**
 * Async generator that yields chunks of data.
 */
async function* chunkGenerator(data: Uint8Array, chunkSize: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const end = Math.min(offset + chunkSize, data.length);
    yield data.subarray(offset, end);
  }
}

// =============================================================================
// Basic webrun-ports functionality tests
// =============================================================================
describe("webrun-ports", () => {
  describe("webrun-ports: Basic send/receive", () => {
    it("should send and receive simple values", async () => {
      const channel = newMessageChannel();
      const channelName = `test-${Date.now()}`;
      const values = [1, 2, 3, 4, 5];

      // Start sender in background
      const sendPromise = send(channel.port1, values, { channelName });

      // Receive values
      const received: number[] = [];
      for await (const input of recieve(channel.port2, { channelName })) {
        for await (const value of input) {
          received.push(value);
        }
        break;
      }

      await sendPromise;

      expect(received).toEqual(values);

      channel.port1.close();
      channel.port2.close();
    });

    it("should send and receive binary chunks", async () => {
      const channel = newMessageChannel();
      const channelName = `binary-${Date.now()}`;
      const testData = createTestData(1024 * 100); // 100KB
      const chunkSize = 5 * 1024; // 5KB chunks

      // Create chunks
      const chunks: Uint8Array[] = [];
      for (let offset = 0; offset < testData.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, testData.length);
        chunks.push(testData.subarray(offset, end));
      }

      // Start sender
      const sendPromise = send(channel.port1, chunks, { channelName });

      // Receive chunks
      const receivedChunks: Uint8Array[] = [];
      const recievePromise = (async () => {
        for await (const input of recieve(channel.port2, { channelName })) {
          for await (const chunk of input) {
            receivedChunks.push(new Uint8Array(chunk));
          }
          break;
        }
      })();

      await Promise.all([sendPromise, recievePromise]);

      const received = concatBytes(receivedChunks);
      expect(verifyData(received, testData)).toBe(true);

      channel.port1.close();
      channel.port2.close();
    });
  });

  // =============================================================================
  // Bidirectional streaming tests
  // =============================================================================

  describe("webrun-ports: Bidirectional streaming (callBidi/listenBidi)", () => {
    it("should handle basic bidirectional stream", async () => {
      const channel = newMessageChannel();

      // Server: transform input to uppercase
      const close = listenBidi(
        channel.port1,
        async function* handler(input: AsyncIterable<string>) {
          for await (const value of input) {
            yield value.toUpperCase();
          }
        },
      );

      try {
        const inputValues = ["hello", "world", "test"];
        const outputValues: string[] = [];

        for await (const value of callBidi(channel.port2, inputValues, {})) {
          outputValues.push(value);
        }

        expect(outputValues).toEqual(["HELLO", "WORLD", "TEST"]);
      } finally {
        close();
        channel.port1.close();
        channel.port2.close();
      }
    });

    it("should handle binary data bidirectionally", async () => {
      const channel = newMessageChannel();

      // Server: double each byte value
      const close = listenBidi(
        channel.port1,
        async function* handler(input: AsyncIterable<Uint8Array>) {
          for await (const chunk of input) {
            const result = new Uint8Array(chunk.length);
            for (let i = 0; i < chunk.length; i++) {
              result[i] = (chunk[i] * 2) % 256;
            }
            yield result;
          }
        },
      );

      try {
        const inputData = createTestData(1000);
        const inputChunks = [inputData.subarray(0, 500), inputData.subarray(500)];

        const outputChunks: Uint8Array[] = [];
        for await (const chunk of callBidi(channel.port2, inputChunks, {})) {
          outputChunks.push(new Uint8Array(chunk));
        }

        const output = concatBytes(outputChunks);
        expect(output.length).toBe(inputData.length);

        // Verify transformation
        for (let i = 0; i < inputData.length; i++) {
          expect(output[i]).toBe((inputData[i] * 2) % 256);
        }
      } finally {
        close();
        channel.port1.close();
        channel.port2.close();
      }
    });
  });

  // =============================================================================
  // Full Duplex Performance Tests - 10MB
  // =============================================================================

  describe("measurement of call peformance", async () => {
    it("should send and recieve the same number of blocks", async () => {
      const channel = new MessageChannel();
      channel.port1.start();
      channel.port2.start();
      // It could be an AsyncIterator instead.
      const count = 10 * 1024; // 10k blocks;
      const blockSize = 64 * 1024; // 1KB blocks

      // The "server-side" handler transforming input stream
      // to a sequence of output values:
      async function* handler(
        input: AsyncGenerator<Uint8Array>,
        _params,
      ): AsyncGenerator<Uint8Array> {
        let _i = 0;
        for await (const _value of input) {
          yield createTestData(blockSize);
          _i++;
        }
      }
      // Registration of the server-side handler:
      const close = listenBidi(channel.port1, handler);
      try {
        // Input values.
        const input = (async function* () {
          for (let i = 0; i < count; i++) {
            yield createTestData(blockSize);
          }
        })();
        const params = { foo: "Bar" };
        let i = 0;
        for await (const _value of callBidi(channel.port2, input, params)) {
          // if (i % 1000 === 0) {
          //   console.log("* ", value);
          // }
          i++;
        }
        expect(i).toBe(count);
      } finally {
        close();
      }
    });
  });

  // =============================================================================
  // callPort Performance Tests - One-directional RPC calls
  // =============================================================================

  describe("callPort performance", () => {
    it("should measure callPort one-directional performance (client calls server)", async () => {
      const channel = new MessageChannel();
      channel.port1.start();
      channel.port2.start();

      const count = 10 * 1024; // 10k calls
      const blockSize = 64 * 1024; // 64KB per call

      console.log(`\n[callPort ONE-WAY] Test Configuration:`);
      console.log(`  Calls: ${count}`);
      console.log(`  Block size: ${formatBytes(blockSize)}`);
      console.log(`  Total data: ${formatBytes(count * blockSize)}`);

      // Server: receives data, returns small acknowledgment
      const closeServer = listenPort(
        channel.port1,
        async (params: { data: Uint8Array; index: number }) => {
          return { received: params.data.length, index: params.index };
        },
      );

      const startTime = performance.now();

      try {
        let totalSent = 0;
        for (let i = 0; i < count; i++) {
          const data = createTestData(blockSize, i);
          const response = await callPort(channel.port2, { data, index: i }, { timeout: 10000 });
          totalSent += response.received;
        }

        const duration = performance.now() - startTime;
        const throughput = totalSent / (1024 * 1024) / (duration / 1000);

        console.log(`\n[callPort ONE-WAY] Results:`);
        console.log(`  Duration: ${duration.toFixed(2)}ms`);
        console.log(`  Total sent: ${formatBytes(totalSent)}`);
        console.log(`  Throughput: ${throughput.toFixed(2)} MB/s`);
        console.log(`  Calls/sec: ${(count / (duration / 1000)).toFixed(0)}`);

        expect(totalSent).toBe(count * blockSize);
      } finally {
        closeServer();
        channel.port1.close();
        channel.port2.close();
      }
    });

    it("should measure callPort with large response (server returns data)", async () => {
      const channel = new MessageChannel();
      channel.port1.start();
      channel.port2.start();

      const count = 10 * 1024; // 10k calls
      const blockSize = 64 * 1024; // 64KB per call

      console.log(`\n[callPort RESPONSE DATA] Test Configuration:`);
      console.log(`  Calls: ${count}`);
      console.log(`  Block size: ${formatBytes(blockSize)}`);
      console.log(`  Total data each direction: ${formatBytes(count * blockSize)}`);

      // Server: receives data, returns data of same size
      const closeServer = listenPort(
        channel.port1,
        async (params: { data: Uint8Array; index: number }) => {
          return { data: createTestData(blockSize, params.index + 100), index: params.index };
        },
      );

      const startTime = performance.now();

      try {
        let totalSent = 0;
        let totalReceived = 0;
        for (let i = 0; i < count; i++) {
          const data = createTestData(blockSize, i);
          const response = await callPort(channel.port2, { data, index: i }, { timeout: 10000 });
          totalSent += data.length;
          totalReceived += response.data.length;
        }

        const duration = performance.now() - startTime;
        const throughputSend = totalSent / (1024 * 1024) / (duration / 1000);
        const throughputRecv = totalReceived / (1024 * 1024) / (duration / 1000);

        console.log(`\n[callPort RESPONSE DATA] Results:`);
        console.log(`  Duration: ${duration.toFixed(2)}ms`);
        console.log(`  Total sent: ${formatBytes(totalSent)}`);
        console.log(`  Total received: ${formatBytes(totalReceived)}`);
        console.log(`  Send throughput: ${throughputSend.toFixed(2)} MB/s`);
        console.log(`  Receive throughput: ${throughputRecv.toFixed(2)} MB/s`);
        console.log(`  Combined: ${(throughputSend + throughputRecv).toFixed(2)} MB/s`);
        console.log(`  Calls/sec: ${(count / (duration / 1000)).toFixed(0)}`);

        expect(totalSent).toBe(count * blockSize);
        expect(totalReceived).toBe(count * blockSize);
      } finally {
        closeServer();
        channel.port1.close();
        channel.port2.close();
      }
    });
  });

  // =============================================================================
  // Bidirectional callPort - Both peers call each other simultaneously
  // =============================================================================

  describe("bidirectional callPort performance", () => {
    it("should measure bidirectional callPort (both peers call each other)", async () => {
      const channel = new MessageChannel();
      channel.port1.start();
      channel.port2.start();

      const count = 5 * 1024; // 5k calls per direction
      const blockSize = 64 * 1024; // 64KB per call

      console.log(`\n[callPort BIDIRECTIONAL] Test Configuration:`);
      console.log(`  Calls per direction: ${count}`);
      console.log(`  Block size: ${formatBytes(blockSize)}`);
      console.log(`  Total data per direction: ${formatBytes(count * blockSize)}`);

      // Metrics
      const metrics = {
        port1Sent: 0,
        port1Received: 0,
        port2Sent: 0,
        port2Received: 0,
      };

      // Port1 listens and handles calls from Port2
      const closePort1Listener = listenPort(
        channel.port1,
        async (params: { data: Uint8Array; index: number }) => {
          metrics.port1Received += params.data.length;
          return { data: createTestData(blockSize, params.index + 1000), index: params.index };
        },
      );

      // Port2 listens and handles calls from Port1
      const closePort2Listener = listenPort(
        channel.port2,
        async (params: { data: Uint8Array; index: number }) => {
          metrics.port2Received += params.data.length;
          return { data: createTestData(blockSize, params.index + 2000), index: params.index };
        },
      );

      const startTime = performance.now();

      try {
        // Port1 calls Port2 (in parallel with Port2 calling Port1)
        const port1CallingPromise = (async () => {
          for (let i = 0; i < count; i++) {
            const data = createTestData(blockSize, i);
            const response = await callPort(channel.port1, { data, index: i }, { timeout: 30000 });
            metrics.port1Sent += data.length;
            metrics.port1Received += response.data.length;
          }
        })();

        // Port2 calls Port1 (in parallel with Port1 calling Port2)
        const port2CallingPromise = (async () => {
          for (let i = 0; i < count; i++) {
            const data = createTestData(blockSize, i + count);
            const response = await callPort(
              channel.port2,
              { data, index: i + count },
              { timeout: 30000 },
            );
            metrics.port2Sent += data.length;
            metrics.port2Received += response.data.length;
          }
        })();

        // Wait for both to complete
        await Promise.all([port1CallingPromise, port2CallingPromise]);

        const duration = performance.now() - startTime;
        const totalData =
          metrics.port1Sent + metrics.port1Received + metrics.port2Sent + metrics.port2Received;
        const throughput = totalData / (1024 * 1024) / (duration / 1000);

        console.log(`\n[callPort BIDIRECTIONAL] Results:`);
        console.log(`  Duration: ${duration.toFixed(2)}ms`);
        console.log(
          `  Port1 sent: ${formatBytes(metrics.port1Sent)}, received: ${formatBytes(metrics.port1Received)}`,
        );
        console.log(
          `  Port2 sent: ${formatBytes(metrics.port2Sent)}, received: ${formatBytes(metrics.port2Received)}`,
        );
        console.log(`  Total data transferred: ${formatBytes(totalData)}`);
        console.log(`  Combined throughput: ${throughput.toFixed(2)} MB/s`);
        console.log(`  Calls/sec (total): ${((count * 2) / (duration / 1000)).toFixed(0)}`);

        // Each direction should have sent and received count * blockSize
        expect(metrics.port1Sent).toBe(count * blockSize);
        expect(metrics.port2Sent).toBe(count * blockSize);
      } finally {
        closePort1Listener();
        closePort2Listener();
        channel.port1.close();
        channel.port2.close();
      }
    });
  });

  describe("webrun-ports: Full Duplex 100MB Performance", () => {
    const DATA_SIZE = 100 * 1024 * 1024; // 100MB
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks to reduce RPC overhead (100 chunks total)

    it(
      "should send ~100MB and receive ~100MB in full duplex mode",
      { timeout: 300000 },
      async () => {
        const channel = newMessageChannel();
        let closeListener: (() => void) | null = null;

        // Create test data: different patterns for each direction
        const clientToServerData = createTestData(DATA_SIZE, 0x11);
        const serverToClientData = createTestData(DATA_SIZE, 0x22);

        console.log(`\n[FULL DUPLEX] Test Configuration:`);
        console.log(`  Data size each direction: ${formatBytes(DATA_SIZE)}`);
        console.log(`  Chunk size: ${formatBytes(CHUNK_SIZE)}`);
        console.log(`  Total chunks per direction: ${Math.ceil(DATA_SIZE / CHUNK_SIZE)}`);

        // Metrics tracking
        const metrics = {
          serverReceivedBytes: 0,
          serverSentBytes: 0,
          clientReceivedBytes: 0,
          clientSentBytes: 0,
          serverReceiveStart: 0,
          serverReceiveEnd: 0,
          serverSendStart: 0,
          serverSendEnd: 0,
          clientSendStart: 0,
          clientSendEnd: 0,
          clientReceiveStart: 0,
          clientReceiveEnd: 0,
        };

        const receivedChunks: Uint8Array[] = [];

        try {
          const overallStart = performance.now();

          // Server promise: receives input stream and sends back different data
          const serverPromise = (async () => {
            console.log("[SERVER] Starting listener...");
            closeListener = listenBidi(
              channel.port1,
              async function* handler(input: AsyncIterable<Uint8Array>) {
                metrics.serverReceiveStart = performance.now();
                metrics.serverSendStart = performance.now();

                // Process input in background while yielding output
                const receivePromise = (async () => {
                  for await (const chunk of input) {
                    metrics.serverReceivedBytes += chunk.length;
                  }
                  metrics.serverReceiveEnd = performance.now();
                  console.log(
                    `[SERVER] Receive complete: ${formatBytes(metrics.serverReceivedBytes)}`,
                  );
                })();

                // Yield output data
                for await (const chunk of chunkGenerator(serverToClientData, CHUNK_SIZE)) {
                  yield chunk;
                  metrics.serverSentBytes += chunk.length;
                }
                metrics.serverSendEnd = performance.now();
                console.log(`[SERVER] Send complete: ${formatBytes(metrics.serverSentBytes)}`);

                // Wait for receive to complete
                await receivePromise;
              },
            ) as () => void;
            console.log("[SERVER] Listener ready");
          })();

          // Client promise: sends input and receives output
          const clientPromise = (async () => {
            // Wait a tick for server to be ready
            await new Promise((resolve) => setTimeout(resolve, 10));

            console.log("[CLIENT] Starting send/receive...");
            metrics.clientSendStart = performance.now();
            metrics.clientReceiveStart = performance.now();

            // Track send progress
            let chunksSent = 0;
            const totalChunks = Math.ceil(DATA_SIZE / CHUNK_SIZE);

            async function* trackedSendGenerator(): AsyncGenerator<Uint8Array> {
              for await (const chunk of chunkGenerator(clientToServerData, CHUNK_SIZE)) {
                yield chunk;
                chunksSent++;
                metrics.clientSentBytes += chunk.length;
                if (chunksSent % 100 === 0) {
                  console.log(`[CLIENT] Sent ${chunksSent}/${totalChunks} chunks`);
                }
              }
              metrics.clientSendEnd = performance.now();
              console.log(`[CLIENT] Send complete: ${formatBytes(metrics.clientSentBytes)}`);
            }

            // Receive data
            let chunksReceived = 0;
            for await (const chunk of callBidi(channel.port2, trackedSendGenerator(), {
              options: { timeout: 120000, bidiTimeout: 300000 },
            })) {
              receivedChunks.push(new Uint8Array(chunk));
              metrics.clientReceivedBytes += chunk.length;
              chunksReceived++;
              if (chunksReceived % 100 === 0) {
                console.log(`[CLIENT] Received ${chunksReceived}/${totalChunks} chunks`);
              }
            }
            metrics.clientReceiveEnd = performance.now();
            console.log(`[CLIENT] Receive complete: ${formatBytes(metrics.clientReceivedBytes)}`);
          })();

          // Wait for both to complete
          console.log("[MAIN] Waiting for send/receive to complete...");
          await Promise.all([serverPromise, clientPromise]);

          const overallEnd = performance.now();
          const totalDuration = overallEnd - overallStart;

          // Calculate metrics
          const serverReceiveDuration = metrics.serverReceiveEnd - metrics.serverReceiveStart;
          const _serverSendDuration = metrics.serverSendEnd - metrics.serverSendStart;
          const _clientSendDuration = metrics.clientSendEnd - metrics.clientSendStart;
          const clientReceiveDuration = metrics.clientReceiveEnd - metrics.clientReceiveStart;

          // Verify data integrity
          const receivedData = concatBytes(receivedChunks);

          console.log(`\n[FULL DUPLEX] Results:`);
          console.log(
            `  Client -> Server: ${formatBytes(metrics.serverReceivedBytes)} in ${serverReceiveDuration.toFixed(2)}ms`,
          );
          console.log(
            `    Throughput: ${(metrics.serverReceivedBytes / (1024 * 1024) / (serverReceiveDuration / 1000)).toFixed(2)} MB/s`,
          );
          console.log(
            `  Server -> Client: ${formatBytes(metrics.clientReceivedBytes)} in ${clientReceiveDuration.toFixed(2)}ms`,
          );
          console.log(
            `    Throughput: ${(metrics.clientReceivedBytes / (1024 * 1024) / (clientReceiveDuration / 1000)).toFixed(2)} MB/s`,
          );
          console.log(`  Total full-duplex duration: ${totalDuration.toFixed(2)}ms`);
          console.log(
            `  Combined throughput: ${((DATA_SIZE * 2) / (1024 * 1024) / (totalDuration / 1000)).toFixed(2)} MB/s`,
          );

          // Assertions
          expect(metrics.serverReceivedBytes).toBe(DATA_SIZE);
          expect(metrics.clientReceivedBytes).toBe(DATA_SIZE);
          expect(verifyData(receivedData, serverToClientData)).toBe(true);
        } finally {
          console.log("[CLEANUP] Closing listener and ports...");
          if (closeListener) closeListener();
          channel.port1.close();
          channel.port2.close();
          console.log("[CLEANUP] Complete");
        }
      },
    );

    // it("should measure true simultaneous bidirectional transfer", { timeout: 120000 }, async () => {
    //   const channel = newMessageChannel();

    //   // Use smaller but still significant data for true full-duplex measurement
    //   const dataSize = 50 * 1024 * 1024; // 50MB each direction
    //   const chunkSize = 32 * 1024; // 32KB chunks

    //   const aToB = createTestData(dataSize, 0xaa);
    //   const bToA = createTestData(dataSize, 0xbb);

    //   console.log(`\n[SIMULTANEOUS BIDI] Test Configuration:`);
    //   console.log(`  Data size each direction: ${formatBytes(dataSize)}`);
    //   console.log(`  Chunk size: ${formatBytes(chunkSize)}`);

    //   // Track timing for true simultaneity
    //   const timings = {
    //     aFirstChunkSent: 0,
    //     aLastChunkSent: 0,
    //     aFirstChunkReceived: 0,
    //     aLastChunkReceived: 0,
    //     bFirstChunkSent: 0,
    //     bLastChunkSent: 0,
    //     bFirstChunkReceived: 0,
    //     bLastChunkReceived: 0,
    //   };

    //   const startTime = performance.now();

    //   // Server (port1): receives and sends simultaneously
    //   const close = listenBidi(
    //     channel.port1,
    //     async function* handler(input: AsyncIterable<Uint8Array>) {
    //       let firstReceived = false;
    //       let firstSent = false;

    //       // Start receiving in background
    //       const receivePromise = (async () => {
    //         for await (const _chunk of input) {
    //           if (!firstReceived) {
    //             timings.bFirstChunkReceived = performance.now() - startTime;
    //             firstReceived = true;
    //           }
    //         }
    //         timings.bLastChunkReceived = performance.now() - startTime;
    //       })();

    //       // Yield output while receiving
    //       for await (const chunk of chunkGenerator(bToA, chunkSize)) {
    //         if (!firstSent) {
    //           timings.bFirstChunkSent = performance.now() - startTime;
    //           firstSent = true;
    //         }
    //         yield chunk;
    //       }
    //       timings.bLastChunkSent = performance.now() - startTime;

    //       await receivePromise;
    //     },
    //   );

    //   try {
    //     const receivedChunks: Uint8Array[] = [];
    //     let firstSent = false;
    //     let firstReceived = false;

    //     // Client: track when chunks are sent and received
    //     async function* trackedInput(): AsyncGenerator<Uint8Array> {
    //       for await (const chunk of chunkGenerator(aToB, chunkSize)) {
    //         if (!firstSent) {
    //           timings.aFirstChunkSent = performance.now() - startTime;
    //           firstSent = true;
    //         }
    //         yield chunk;
    //       }
    //       timings.aLastChunkSent = performance.now() - startTime;
    //     }

    //     for await (const chunk of callBidi(channel.port2, trackedInput(), {
    //       options: { timeout: 60000, bidiTimeout: 60000 },
    //     })) {
    //       if (!firstReceived) {
    //         timings.aFirstChunkReceived = performance.now() - startTime;
    //         firstReceived = true;
    //       }
    //       receivedChunks.push(new Uint8Array(chunk));
    //     }
    //     timings.aLastChunkReceived = performance.now() - startTime;

    //     const endTime = performance.now();
    //     const totalDuration = endTime - startTime;

    //     // Verify data
    //     const received = concatBytes(receivedChunks);
    //     expect(received.length).toBe(dataSize);
    //     expect(verifyData(received, bToA)).toBe(true);

    //     console.log(`\n[SIMULTANEOUS BIDI] Timing Analysis (ms from start):`);
    //     console.log(`  A first chunk sent:     ${timings.aFirstChunkSent.toFixed(2)}ms`);
    //     console.log(`  A last chunk sent:      ${timings.aLastChunkSent.toFixed(2)}ms`);
    //     console.log(`  A first chunk received: ${timings.aFirstChunkReceived.toFixed(2)}ms`);
    //     console.log(`  A last chunk received:  ${timings.aLastChunkReceived.toFixed(2)}ms`);
    //     console.log(`  B first chunk sent:     ${timings.bFirstChunkSent.toFixed(2)}ms`);
    //     console.log(`  B last chunk sent:      ${timings.bLastChunkSent.toFixed(2)}ms`);
    //     console.log(`  B first chunk received: ${timings.bFirstChunkReceived.toFixed(2)}ms`);
    //     console.log(`  B last chunk received:  ${timings.bLastChunkReceived.toFixed(2)}ms`);
    //     console.log(`\n  Total duration: ${totalDuration.toFixed(2)}ms`);
    //     console.log(
    //       `  Effective throughput: ${((dataSize * 2) / (1024 * 1024) / (totalDuration / 1000)).toFixed(2)} MB/s`,
    //     );

    //     // Check for simultaneity: B should start sending while still receiving
    //     const bSendStartedWhileReceiving = timings.bFirstChunkSent < timings.bLastChunkReceived;
    //     console.log(`\n  True full-duplex: ${bSendStartedWhileReceiving ? "YES" : "NO"}`);
    //     console.log(
    //       `    (B started sending at ${timings.bFirstChunkSent.toFixed(2)}ms, finished receiving at ${timings.bLastChunkReceived.toFixed(2)}ms)`,
    //     );
    //   } finally {
    //     close();
    //     channel.port1.close();
    //     channel.port2.close();
    //   }
    // });

    // it("should benchmark multiple iterations for reliable metrics", { timeout: 300000 }, async () => {
    //   const ITERATIONS = 3;
    //   const dataSize = 100 * 1024 * 1024; // 100MB
    //   const chunkSize = 64 * 1024; // 64KB

    //   console.log(`\n[BENCHMARK] Running ${ITERATIONS} iterations of 100MB full-duplex transfer`);

    //   const results: {
    //     duration: number;
    //     sendThroughput: number;
    //     receiveThroughput: number;
    //   }[] = [];

    //   for (let iter = 0; iter < ITERATIONS; iter++) {
    //     const channel = newMessageChannel();
    //     const clientData = createTestData(dataSize, iter);
    //     const serverData = createTestData(dataSize, iter + 100);

    //     let serverReceivedBytes = 0;
    //     let clientReceivedBytes = 0;

    //     const close = listenBidi(
    //       channel.port1,
    //       async function* handler(input: AsyncIterable<Uint8Array>) {
    //         const receivePromise = (async () => {
    //           for await (const chunk of input) {
    //             serverReceivedBytes += chunk.length;
    //           }
    //         })();

    //         for await (const chunk of chunkGenerator(serverData, chunkSize)) {
    //           yield chunk;
    //         }

    //         await receivePromise;
    //       },
    //     );

    //     const startTime = performance.now();

    //     const receivedChunks: Uint8Array[] = [];
    //     for await (const chunk of callBidi(channel.port2, chunkGenerator(clientData, chunkSize), {
    //       options: { timeout: 60000, bidiTimeout: 60000 },
    //     })) {
    //       receivedChunks.push(new Uint8Array(chunk));
    //       clientReceivedBytes += chunk.length;
    //     }

    //     const duration = performance.now() - startTime;

    //     close();
    //     channel.port1.close();
    //     channel.port2.close();

    //     // Verify integrity
    //     const received = concatBytes(receivedChunks);
    //     expect(verifyData(received, serverData)).toBe(true);
    //     expect(serverReceivedBytes).toBe(dataSize);

    //     const sendThroughput = dataSize / (1024 * 1024) / (duration / 1000);
    //     const receiveThroughput = clientReceivedBytes / (1024 * 1024) / (duration / 1000);

    //     results.push({ duration, sendThroughput, receiveThroughput });

    //     console.log(`  Iteration ${iter + 1}: ${duration.toFixed(2)}ms`);
    //   }

    //   // Calculate statistics
    //   const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
    //   const avgSendThroughput =
    //     results.reduce((sum, r) => sum + r.sendThroughput, 0) / results.length;
    //   const avgReceiveThroughput =
    //     results.reduce((sum, r) => sum + r.receiveThroughput, 0) / results.length;
    //   const minDuration = Math.min(...results.map((r) => r.duration));
    //   const maxDuration = Math.max(...results.map((r) => r.duration));

    //   console.log(`\n[BENCHMARK] Summary (${ITERATIONS} iterations, 100MB each direction):`);
    //   console.log(`  Average duration:        ${avgDuration.toFixed(2)}ms`);
    //   console.log(`  Min duration:            ${minDuration.toFixed(2)}ms`);
    //   console.log(`  Max duration:            ${maxDuration.toFixed(2)}ms`);
    //   console.log(`  Avg send throughput:     ${avgSendThroughput.toFixed(2)} MB/s`);
    //   console.log(`  Avg receive throughput:  ${avgReceiveThroughput.toFixed(2)} MB/s`);
    //   console.log(
    //     `  Combined avg throughput: ${(avgSendThroughput + avgReceiveThroughput).toFixed(2)} MB/s`,
    //   );
    // });
  });

  // // =============================================================================
  // // Comparison: Raw MessageChannel vs webrun-ports
  // // =============================================================================

  // describe("webrun-ports: Performance comparison with raw MessageChannel", () => {
  //   it(
  //     "should compare overhead of webrun-ports vs raw MessageChannel",
  //     { timeout: 60000 },
  //     async () => {
  //       const DATA_SIZE = 1024 * 1024; // 1MB for comparison
  //       const ITERATIONS = 3;

  //       console.log(
  //         `\n[COMPARISON] Raw MessageChannel vs webrun-ports (1MB, ${ITERATIONS} iterations)`,
  //       );

  //       const results = {
  //         raw: [] as number[],
  //         webrunPorts: [] as number[],
  //       };

  //       const testData = createTestData(DATA_SIZE);

  //       for (let iter = 0; iter < ITERATIONS; iter++) {
  //         // --- Raw MessageChannel ---
  //         {
  //           const channel = new MessageChannel();
  //           channel.port2.start();

  //           const receivePromise = new Promise<void>((resolve) => {
  //             channel.port2.onmessage = () => resolve();
  //           });

  //           const start = performance.now();
  //           channel.port1.postMessage(testData.buffer.slice(0));
  //           await receivePromise;
  //           results.raw.push(performance.now() - start);

  //           channel.port1.close();
  //           channel.port2.close();
  //         }

  //         // --- webrun-ports callBidi/listenBidi ---
  //         {
  //           const channel = newMessageChannel();
  //           const chunks = Array.from({ length: Math.ceil(DATA_SIZE / (64 * 1024)) }, (_, i) => {
  //             const start = i * 64 * 1024;
  //             const end = Math.min(start + 64 * 1024, DATA_SIZE);
  //             return testData.subarray(start, end);
  //           });

  //           const close = listenBidi(
  //             channel.port1,
  //             async function* handler(input: AsyncIterable<Uint8Array>) {
  //               for await (const chunk of input) {
  //                 yield chunk; // Echo back
  //               }
  //             },
  //           );

  //           const start = performance.now();

  //           const receivedChunks: Uint8Array[] = [];
  //           for await (const chunk of callBidi(channel.port2, chunks, {
  //             options: { timeout: 10000 },
  //           })) {
  //             receivedChunks.push(new Uint8Array(chunk));
  //           }

  //           results.webrunPorts.push(performance.now() - start);

  //           close();
  //           channel.port1.close();
  //           channel.port2.close();
  //         }
  //       }

  //       const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

  //       const rawAvg = avg(results.raw);
  //       const webrunPortsAvg = avg(results.webrunPorts);

  //       console.log(`  Raw MessageChannel: ${rawAvg.toFixed(2)}ms`);
  //       console.log(
  //         `  webrun-ports:       ${webrunPortsAvg.toFixed(2)}ms (${(webrunPortsAvg / rawAvg).toFixed(1)}x overhead)`,
  //       );
  //       console.log(
  //         `  Note: webrun-ports provides full-duplex streaming, chunking, and protocol handling`,
  //       );

  //       // webrun-ports has significant overhead due to protocol, but should complete
  //       expect(webrunPortsAvg).toBeDefined();
  //     },
  //   );
  // });
});
