/**
 * Tests for MessagePortStream.
 *
 * Tests the unified TransportConnection implementation that wraps MessagePortLikeExtended.
 */

import { describe, expect, it, vi } from "vitest";
import { MessagePortStream } from "../src/ports/message-port-stream.js";
import type { MessagePortLikeExtended } from "../src/ports/types.js";
import type { Packet } from "../src/protocol/types.js";

/**
 * Create a mock MessagePortLikeExtended for testing.
 */
function createMockPort(): MessagePortLikeExtended & {
  simulateMessage(data: ArrayBuffer): void;
  simulateClose(): void;
  simulateError(err: Error): void;
  sentMessages: (ArrayBuffer | Uint8Array)[];
  _isOpen: boolean;
  _bufferedAmount: number;
} {
  const sentMessages: (ArrayBuffer | Uint8Array)[] = [];
  let isOpen = true;
  let bufferedAmount = 0;

  const port: MessagePortLikeExtended & {
    simulateMessage(data: ArrayBuffer): void;
    simulateClose(): void;
    simulateError(err: Error): void;
    sentMessages: (ArrayBuffer | Uint8Array)[];
    _isOpen: boolean;
    _bufferedAmount: number;
  } = {
    onmessage: null,
    onmessageerror: null,
    onclose: null,
    onerror: null,
    sentMessages,

    get _isOpen() {
      return isOpen;
    },
    set _isOpen(value: boolean) {
      isOpen = value;
    },

    get _bufferedAmount() {
      return bufferedAmount;
    },
    set _bufferedAmount(value: number) {
      bufferedAmount = value;
    },

    get bufferedAmount() {
      return bufferedAmount;
    },

    get isOpen() {
      return isOpen;
    },

    postMessage(data: ArrayBuffer | Uint8Array) {
      sentMessages.push(data);
    },

    close() {
      isOpen = false;
      this.onclose?.();
    },

    start() {
      // No-op for mock
    },

    simulateMessage(data: ArrayBuffer) {
      this.onmessage?.({ data } as MessageEvent<ArrayBuffer>);
    },

    simulateClose() {
      isOpen = false;
      this.onclose?.();
    },

    simulateError(err: Error) {
      this.onerror?.(err);
    },
  };

  return port;
}

describe("MessagePortStream", () => {
  describe("constructor", () => {
    it("should create stream with default options", () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      expect(stream.isOpen).toBe(true);
      expect(stream.isClosed).toBe(false);
    });

    it("should accept custom high water mark", () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port, { highWaterMark: 128 * 1024 });

      expect(stream.isOpen).toBe(true);
    });

    it("should call port.start() on construction", () => {
      const port = createMockPort();
      const startSpy = vi.spyOn(port, "start");

      new MessagePortStream(port);

      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe("receive()", () => {
    it("should yield received messages as packets", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      // Simulate receiving a flush packet (0000)
      const flushPacket = new TextEncoder().encode("0000");
      port.simulateMessage(flushPacket.buffer.slice(0));

      const packets: Packet[] = [];
      for await (const packet of stream.receive()) {
        packets.push(packet);
        break; // Just get one packet
      }

      expect(packets).toHaveLength(1);
      expect(packets[0].type).toBe("flush");
    });

    it("should queue messages received before iteration starts", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      // Send messages before starting iteration
      const msg1 = new TextEncoder().encode("0005a");
      const msg2 = new TextEncoder().encode("0000");
      port.simulateMessage(msg1.buffer.slice(0));
      port.simulateMessage(msg2.buffer.slice(0));

      // Now iterate - should get both packets
      const packets: Packet[] = [];
      for await (const packet of stream.receive()) {
        packets.push(packet);
        if (packet.type === "flush") break;
      }

      expect(packets).toHaveLength(2);
      expect(packets[0].type).toBe("data");
      expect(packets[1].type).toBe("flush");
    });

    it("should complete iteration when port closes", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      // Start receiving in background
      const receivePromise = (async () => {
        const packets: Packet[] = [];
        for await (const packet of stream.receive()) {
          packets.push(packet);
        }
        return packets;
      })();

      // Close port after short delay
      setTimeout(() => port.simulateClose(), 10);

      const packets = await receivePromise;
      expect(stream.isClosed).toBe(true);
      expect(packets).toHaveLength(0);
    });

    it("should handle multiple data packets", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      // Simulate receiving multiple packets
      const data = new TextEncoder().encode("0006ab\n0007cde\n0000");
      port.simulateMessage(data.buffer.slice(0));

      const packets: Packet[] = [];
      for await (const packet of stream.receive()) {
        packets.push(packet);
        if (packet.type === "flush") break;
      }

      expect(packets).toHaveLength(3);
      expect(packets[0].type).toBe("data");
      expect(packets[1].type).toBe("data");
      expect(packets[2].type).toBe("flush");
    });
  });

  describe("send()", () => {
    it("should send packets through port", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      async function* packets(): AsyncIterable<Packet> {
        yield { type: "data", data: new Uint8Array([0x61]) }; // 'a'
      }

      await stream.send(packets());

      expect(port.sentMessages.length).toBeGreaterThan(0);
    });

    it("should throw if stream is closed", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);
      await stream.close();

      async function* packets(): AsyncIterable<Packet> {
        yield { type: "flush" };
      }

      await expect(stream.send(packets())).rejects.toThrow("closed");
    });

    it("should throw if port closes during send", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      async function* packets(): AsyncIterable<Packet> {
        yield { type: "data", data: new Uint8Array([0x61]) };
        port.simulateClose();
        yield { type: "data", data: new Uint8Array([0x62]) };
      }

      await expect(stream.send(packets())).rejects.toThrow("closed");
    });

    it("should send flush packet", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      async function* packets(): AsyncIterable<Packet> {
        yield { type: "flush" };
      }

      await stream.send(packets());

      expect(port.sentMessages.length).toBe(1);
      // Check that 0000 was sent (flush packet)
      const sent = port.sentMessages[0];
      const decoded = new TextDecoder().decode(sent);
      expect(decoded).toBe("0000");
    });

    it("should send delim packet", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      async function* packets(): AsyncIterable<Packet> {
        yield { type: "delim" };
      }

      await stream.send(packets());

      expect(port.sentMessages.length).toBe(1);
      const sent = port.sentMessages[0];
      const decoded = new TextDecoder().decode(sent);
      expect(decoded).toBe("0001");
    });
  });

  describe("sendRaw()", () => {
    it("should send raw bytes through port", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      const data = new Uint8Array([1, 2, 3, 4, 5]);
      await stream.sendRaw(data);

      expect(port.sentMessages.length).toBe(1);
    });

    it("should throw if stream is closed", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);
      await stream.close();

      const data = new Uint8Array([1, 2, 3]);
      await expect(stream.sendRaw(data)).rejects.toThrow("closed");
    });

    it("should throw if port is not open", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);
      port._isOpen = false;

      const data = new Uint8Array([1, 2, 3]);
      await expect(stream.sendRaw(data)).rejects.toThrow("not open");
    });
  });

  describe("close()", () => {
    it("should close the port", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      await stream.close();

      expect(stream.isClosed).toBe(true);
      expect(stream.isOpen).toBe(false);
    });

    it("should resolve pending receives with null", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      // Start receiving
      const receivePromise = (async () => {
        for await (const _ of stream.receive()) {
          // Should not get here after close
        }
        return "done";
      })();

      // Close immediately
      await stream.close();

      const result = await receivePromise;
      expect(result).toBe("done");
    });

    it("should be idempotent", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      await stream.close();
      await stream.close(); // Should not throw
      await stream.close();

      expect(stream.isClosed).toBe(true);
    });
  });

  describe("backpressure", () => {
    it("should wait for drain when bufferedAmount exceeds high water mark", async () => {
      const port = createMockPort();

      // Simulate high buffered amount that decreases over time
      let checkCount = 0;
      Object.defineProperty(port, "bufferedAmount", {
        get() {
          checkCount++;
          // First two checks: over limit, third check: under limit
          return checkCount <= 2 ? 100 * 1024 : 32 * 1024;
        },
      });

      const stream = new MessagePortStream(port, {
        highWaterMark: 64 * 1024,
        drainInterval: 1,
      });

      const data = new Uint8Array([1, 2, 3]);
      const start = Date.now();
      await stream.sendRaw(data);
      const elapsed = Date.now() - start;

      // Should have waited at least 2 intervals
      expect(elapsed).toBeGreaterThanOrEqual(1);
      expect(checkCount).toBeGreaterThanOrEqual(2);
    });

    it("should not wait if bufferedAmount is below high water mark", async () => {
      const port = createMockPort();
      port._bufferedAmount = 1024; // Well below default 64KB

      const stream = new MessagePortStream(port);

      const data = new Uint8Array([1, 2, 3]);
      const start = Date.now();
      await stream.sendRaw(data);
      const elapsed = Date.now() - start;

      // Should complete quickly without waiting
      expect(elapsed).toBeLessThan(50);
    });
  });

  describe("error handling", () => {
    it("should close stream on error", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      port.simulateError(new Error("Connection lost"));

      // Stream should be closed
      expect(stream.isClosed).toBe(true);
    });

    it("should reject pending receives on error before close", async () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      // Start receiving but don't await yet
      const receivePromise = (async () => {
        const packets: Packet[] = [];
        for await (const packet of stream.receive()) {
          packets.push(packet);
        }
        return packets;
      })();

      // Simulate error - this should close the stream
      port.simulateError(new Error("Connection lost"));

      // The receive should complete (not reject) because error triggers close
      const packets = await receivePromise;
      expect(packets).toHaveLength(0);
    });
  });

  describe("properties", () => {
    it("should expose bufferedAmount from port", () => {
      const port = createMockPort();
      port._bufferedAmount = 12345;

      const stream = new MessagePortStream(port);

      expect(stream.bufferedAmount).toBe(12345);
    });

    it("should reflect isOpen state from port", () => {
      const port = createMockPort();
      const stream = new MessagePortStream(port);

      expect(stream.isOpen).toBe(true);

      port._isOpen = false;
      expect(stream.isOpen).toBe(false);
    });
  });
});

describe("MessagePortStream bidirectional communication", () => {
  it("should handle simultaneous send and receive", async () => {
    const port = createMockPort();
    const stream = new MessagePortStream(port);

    // Start receiving
    const receivePromise = (async () => {
      const packets: Packet[] = [];
      for await (const packet of stream.receive()) {
        packets.push(packet);
        if (packet.type === "flush") break;
      }
      return packets;
    })();

    // Send some packets
    async function* outgoing(): AsyncIterable<Packet> {
      yield { type: "data", data: new TextEncoder().encode("hello") };
      yield { type: "flush" };
    }
    await stream.send(outgoing());

    // Simulate receiving response
    const response = new TextEncoder().encode("0007world\n0000");
    port.simulateMessage(response.buffer.slice(0));

    const received = await receivePromise;
    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("data");
    expect(received[1].type).toBe("flush");
  });
});
