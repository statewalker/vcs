/**
 * Minimal tests for MessagePortStream.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { MessagePortStream } from "../src/ports/message-port-stream.js";
import type { MessagePortLikeExtended } from "../src/ports/types.js";
import type { Packet } from "../src/protocol/types.js";

// Track all created streams for cleanup
const createdStreams: MessagePortStream[] = [];

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

  return {
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
    start() {},
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
}

function createStream(
  port: MessagePortLikeExtended,
  opts?: { highWaterMark?: number; drainInterval?: number },
): MessagePortStream {
  const stream = new MessagePortStream(port, opts);
  createdStreams.push(stream);
  return stream;
}

// Cleanup after each test
afterEach(async () => {
  for (const stream of createdStreams) {
    if (!stream.isClosed) {
      await stream.close();
    }
  }
  createdStreams.length = 0;
});

describe("MessagePortStream", () => {
  describe("constructor", () => {
    it("should create stream with default options", () => {
      const port = createMockPort();
      const stream = createStream(port);
      expect(stream.isOpen).toBe(true);
      expect(stream.isClosed).toBe(false);
    });

    it("should call port.start() on construction", () => {
      const port = createMockPort();
      const startSpy = vi.spyOn(port, "start");
      createStream(port);
      expect(startSpy).toHaveBeenCalled();
    });
  });

  describe("receive()", () => {
    it("should yield received messages as packets", async () => {
      const port = createMockPort();
      const stream = createStream(port);

      const flushPacket = new TextEncoder().encode("0000");
      port.simulateMessage(flushPacket.buffer.slice(0));

      const packets: Packet[] = [];
      for await (const packet of stream.receive()) {
        packets.push(packet);
        break;
      }

      expect(packets).toHaveLength(1);
      expect(packets[0].type).toBe("flush");
    });

    it("should complete iteration when port closes", async () => {
      const port = createMockPort();
      const stream = createStream(port);

      const receivePromise = (async () => {
        const packets: Packet[] = [];
        for await (const packet of stream.receive()) {
          packets.push(packet);
        }
        return packets;
      })();

      // Use await with setTimeout to ensure promise is set up first
      await new Promise((r) => setTimeout(r, 5));
      port.simulateClose();

      const packets = await receivePromise;
      expect(stream.isClosed).toBe(true);
      expect(packets).toHaveLength(0);
    });
  });

  describe("send()", () => {
    it("should send flush packet", async () => {
      const port = createMockPort();
      const stream = createStream(port);

      async function* packets(): AsyncIterable<Packet> {
        yield { type: "flush" };
      }

      await stream.send(packets());

      expect(port.sentMessages.length).toBe(1);
      const decoded = new TextDecoder().decode(port.sentMessages[0]);
      expect(decoded).toBe("0000");
    });

    it("should throw if stream is closed", async () => {
      const port = createMockPort();
      const stream = createStream(port);
      await stream.close();

      async function* packets(): AsyncIterable<Packet> {
        yield { type: "flush" };
      }

      await expect(stream.send(packets())).rejects.toThrow("closed");
    });
  });

  describe("close()", () => {
    it("should close the port", async () => {
      const port = createMockPort();
      const stream = createStream(port);

      await stream.close();

      expect(stream.isClosed).toBe(true);
      expect(stream.isOpen).toBe(false);
    });

    it("should be idempotent", async () => {
      const port = createMockPort();
      const stream = createStream(port);

      await stream.close();
      await stream.close();
      await stream.close();

      expect(stream.isClosed).toBe(true);
    });
  });

  describe("properties", () => {
    it("should expose bufferedAmount from port", () => {
      const port = createMockPort();
      port._bufferedAmount = 12345;
      const stream = createStream(port);
      expect(stream.bufferedAmount).toBe(12345);
    });

    it("should reflect isOpen state from port", () => {
      const port = createMockPort();
      const stream = createStream(port);
      expect(stream.isOpen).toBe(true);
      port._isOpen = false;
      expect(stream.isOpen).toBe(false);
    });
  });
});
