import { wrapNativePort } from "@statewalker/vcs-utils";
import { afterEach, describe, expect, it } from "vitest";
import type { TcpSocket } from "../src/connection/git-connection";
import { createPortTcpSocket, PortTcpSocket } from "../src/connection/port-tcp-socket";

// Track created resources for cleanup
const channels: MessageChannel[] = [];
const sockets: TcpSocket[] = [];

function createChannel(): MessageChannel {
  const channel = new MessageChannel();
  channels.push(channel);
  return channel;
}

afterEach(() => {
  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  channels.length = 0;
  sockets.length = 0;
});

describe("PortTcpSocket", () => {
  // Helper to create Uint8Array from string or numbers
  function bytes(...values: number[]): Uint8Array {
    return new Uint8Array(values);
  }

  function text(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  }

  // Helper to collect all chunks from read()
  async function collect(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
    const result: Uint8Array[] = [];
    for await (const chunk of stream) {
      result.push(chunk);
    }
    return result;
  }

  // =============================================================================
  // Basic lifecycle
  // =============================================================================

  describe("lifecycle", () => {
    it("should connect and close without errors", async () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1));
      sockets.push(socket);

      await socket.connect();
      await socket.close();
    });

    it("should allow multiple connect calls (idempotent)", async () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1));
      sockets.push(socket);

      await socket.connect();
      await socket.connect(); // Should not throw
      await socket.close();
    });

    it("should allow multiple close calls (idempotent)", async () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1));
      sockets.push(socket);

      await socket.connect();
      await socket.close();
      await socket.close(); // Should not throw
    });

    it("should throw when writing on closed socket", async () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1));
      sockets.push(socket);

      await socket.connect();
      await socket.close();

      await expect(socket.write(bytes(1, 2, 3))).rejects.toThrow("Socket is closed");
    });

    it("should throw when writing on unconnected socket", async () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1));
      sockets.push(socket);

      await expect(socket.write(bytes(1, 2, 3))).rejects.toThrow("Socket not connected");
    });

    it("should throw when connecting a closed socket", async () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1));
      sockets.push(socket);

      await socket.close();

      await expect(socket.connect()).rejects.toThrow("Socket is closed");
    });
  });

  // =============================================================================
  // Basic read/write
  // =============================================================================

  describe("read and write", () => {
    it("should write and read single chunk", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1));
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      // Start reading before writing
      const readPromise = collect(socket2.read());

      // Write some data
      await socket1.write(bytes(1, 2, 3, 4, 5));

      // Close to signal end
      await socket1.close();

      const received = await readPromise;
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(bytes(1, 2, 3, 4, 5));

      await socket2.close();
    });

    it("should write and read multiple chunks", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1));
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      const readPromise = collect(socket2.read());

      await socket1.write(bytes(1, 2));
      await socket1.write(bytes(3, 4));
      await socket1.write(bytes(5));

      await socket1.close();

      const received = await readPromise;
      expect(received).toHaveLength(3);
      expect(received[0]).toEqual(bytes(1, 2));
      expect(received[1]).toEqual(bytes(3, 4));
      expect(received[2]).toEqual(bytes(5));

      await socket2.close();
    });

    it("should preserve data integrity with large chunks", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1));
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      const largeChunk = new Uint8Array(64 * 1024);
      for (let i = 0; i < largeChunk.length; i++) {
        largeChunk[i] = i % 256;
      }

      const readPromise = collect(socket2.read());

      await socket1.write(largeChunk);
      await socket1.close();

      const received = await readPromise;
      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(largeChunk);

      await socket2.close();
    });

    it("should handle text data", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1));
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      const readPromise = collect(socket2.read());

      await socket1.write(text("Hello, World!"));
      await socket1.write(text("git-upload-pack /repo\0host=example.com\0"));
      await socket1.close();

      const received = await readPromise;
      expect(received).toHaveLength(2);
      expect(new TextDecoder().decode(received[0])).toBe("Hello, World!");
      expect(new TextDecoder().decode(received[1])).toBe(
        "git-upload-pack /repo\0host=example.com\0",
      );

      await socket2.close();
    });
  });

  // =============================================================================
  // Backpressure
  // =============================================================================

  describe("backpressure", () => {
    it("should request ACK after chunkSize bytes", async () => {
      const channel = createChannel();
      // Small chunkSize to trigger ACK frequently
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1), { chunkSize: 10 });
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      const readPromise = collect(socket2.read());

      // Write 25 bytes total - should trigger 2 ACKs (at 10 and 20 bytes)
      await socket1.write(bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
      await socket1.write(bytes(11, 12, 13, 14, 15, 16, 17, 18, 19, 20));
      await socket1.write(bytes(21, 22, 23, 24, 25));

      await socket1.close();

      const received = await readPromise;
      expect(received).toHaveLength(3);

      // Verify all bytes received in order
      const flat = new Uint8Array(25);
      let offset = 0;
      for (const chunk of received) {
        flat.set(chunk, offset);
        offset += chunk.length;
      }
      expect(Array.from(flat)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));

      await socket2.close();
    });

    it("should handle backpressure with slow receiver", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1), { chunkSize: 50 });
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      const events: string[] = [];

      // Start receiving with delays
      const receivePromise = (async () => {
        for await (const chunk of socket2.read()) {
          events.push(`recv-${chunk.length}`);
          await new Promise((r) => setTimeout(r, 10));
        }
        events.push("recv-done");
      })();

      // Write data
      events.push("write-start");
      await socket1.write(new Uint8Array(30));
      events.push("write-1");
      await socket1.write(new Uint8Array(30));
      events.push("write-2");
      await socket1.write(new Uint8Array(30));
      events.push("write-3");
      await socket1.close();
      events.push("close");

      await receivePromise;

      // Verify writes completed and receives happened
      expect(events).toContain("write-start");
      expect(events).toContain("write-1");
      expect(events).toContain("write-2");
      expect(events).toContain("write-3");
      expect(events).toContain("close");
      expect(events).toContain("recv-done");

      await socket2.close();
    });

    it("should timeout if receiver does not respond to ACK", async () => {
      const channel = createChannel();
      // Short timeout and small chunkSize
      const socket = createPortTcpSocket(wrapNativePort(channel.port1), {
        chunkSize: 5,
        ackTimeout: 50,
      });
      sockets.push(socket);

      await socket.connect();

      // No receiver set up - ACK will timeout
      // Write enough data to trigger ACK request
      await expect(
        (async () => {
          await socket.write(bytes(1, 2, 3, 4, 5));
          await socket.write(bytes(6, 7, 8, 9, 10));
        })(),
      ).rejects.toThrow(/Timeout waiting for acknowledgement/);
    });
  });

  // =============================================================================
  // Bidirectional communication
  // =============================================================================

  describe("bidirectional communication", () => {
    it("should support request-response pattern (one direction at a time)", async () => {
      // Use two separate channels for true bidirectional communication
      // This simulates how git protocol works: request on one channel, response on another
      const channel1 = createChannel(); // socket1 -> socket2
      const channel2 = createChannel(); // socket2 -> socket1

      const socket1Out = createPortTcpSocket(wrapNativePort(channel1.port1));
      const socket2In = createPortTcpSocket(wrapNativePort(channel1.port2));
      const socket2Out = createPortTcpSocket(wrapNativePort(channel2.port1));
      const socket1In = createPortTcpSocket(wrapNativePort(channel2.port2));
      sockets.push(socket1Out, socket2In, socket2Out, socket1In);

      await socket1Out.connect();
      await socket2In.connect();
      await socket2Out.connect();
      await socket1In.connect();

      // Socket1 sends request, Socket2 reads
      const read2Promise = collect(socket2In.read());
      await socket1Out.write(text("request"));
      await socket1Out.close();

      const received2 = await read2Promise;
      expect(new TextDecoder().decode(received2[0])).toBe("request");

      // Socket2 sends response, Socket1 reads
      const read1Promise = collect(socket1In.read());
      await socket2Out.write(text("response"));
      await socket2Out.close();

      const received1 = await read1Promise;
      expect(new TextDecoder().decode(received1[0])).toBe("response");

      await socket2In.close();
      await socket1In.close();
    });
  });

  // =============================================================================
  // Edge cases
  // =============================================================================

  describe("edge cases", () => {
    it("should handle empty writes", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1));
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      const readPromise = collect(socket2.read());

      await socket1.write(new Uint8Array(0));
      await socket1.write(bytes(1, 2, 3));
      await socket1.write(new Uint8Array(0));
      await socket1.close();

      const received = await readPromise;
      // Empty writes may or may not be filtered out
      const nonEmpty = received.filter((c) => c.length > 0);
      expect(nonEmpty).toHaveLength(1);
      expect(nonEmpty[0]).toEqual(bytes(1, 2, 3));

      await socket2.close();
    });

    it("should handle many small writes", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1), { chunkSize: 100 });
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      const readPromise = collect(socket2.read());

      const writeCount = 50;
      for (let i = 0; i < writeCount; i++) {
        await socket1.write(bytes(i));
      }
      await socket1.close();

      const received = await readPromise;
      expect(received).toHaveLength(writeCount);

      for (let i = 0; i < writeCount; i++) {
        expect(received[i]).toEqual(bytes(i));
      }

      await socket2.close();
    });

    it("should handle read iterator return()", async () => {
      const channel = createChannel();
      const socket1 = createPortTcpSocket(wrapNativePort(channel.port1));
      const socket2 = createPortTcpSocket(wrapNativePort(channel.port2));
      sockets.push(socket1, socket2);

      await socket1.connect();
      await socket2.connect();

      // Start writing continuously
      const writePromise = (async () => {
        try {
          for (let i = 0; i < 100; i++) {
            await socket1.write(bytes(i));
          }
        } catch {
          // Ignore write errors after early termination
        }
      })();

      // Read only first 3 chunks then break
      const received: Uint8Array[] = [];
      const iter = socket2.read()[Symbol.asyncIterator]();
      for (let i = 0; i < 3; i++) {
        const result = await iter.next();
        if (result.done) break;
        received.push(result.value);
      }
      await iter.return?.();

      expect(received.length).toBeGreaterThanOrEqual(1);

      await socket1.close();
      await socket2.close();
      await writePromise;
    });
  });

  // =============================================================================
  // Factory function
  // =============================================================================

  describe("createPortTcpSocket", () => {
    it("should create TcpSocket instance", () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1));
      sockets.push(socket);

      expect(socket).toBeInstanceOf(PortTcpSocket);
      expect(typeof socket.connect).toBe("function");
      expect(typeof socket.write).toBe("function");
      expect(typeof socket.read).toBe("function");
      expect(typeof socket.close).toBe("function");
    });

    it("should accept options", () => {
      const channel = createChannel();
      const socket = createPortTcpSocket(wrapNativePort(channel.port1), {
        chunkSize: 1024,
        ackTimeout: 10000,
      });
      sockets.push(socket);

      expect(socket).toBeInstanceOf(PortTcpSocket);
    });
  });
});
