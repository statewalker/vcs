/**
 * Unit tests for credit-based backpressure port communication.
 */

import { describe, expect, it } from "vitest";

import {
  type BackpressureMessage,
  type CreditMessage,
  createPortReceiver,
  createPortWriter,
  type DataMessage,
} from "../src/socket/ports-backpressure.js";

/**
 * Create a new MessageChannel with both ports started.
 */
function newMessageChannel(): MessageChannel {
  const channel = new MessageChannel();
  channel.port1.start();
  channel.port2.start();
  return channel;
}

/**
 * Helper to wait for the next microtask queue flush.
 */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("createPortWriter", () => {
  it("should queue messages until credits are received", async () => {
    const channel = newMessageChannel();
    const messages: BackpressureMessage<string>[] = [];

    channel.port2.addEventListener("message", (e) => {
      messages.push(e.data as BackpressureMessage<string>);
    });

    const writer = createPortWriter<string>(channel.port1);

    // Write without credits - should be queued
    const writePromise = writer.write("hello");
    await nextTick();

    // No messages sent yet (no credits)
    expect(messages.filter((m) => m.type === "DATA")).toHaveLength(0);

    // Grant credits
    channel.port2.postMessage({ type: "CREDIT", n: 1 } satisfies CreditMessage);
    await nextTick();

    // Now the message should be sent
    await writePromise;
    const dataMessages = messages.filter((m) => m.type === "DATA") as DataMessage<string>[];
    expect(dataMessages).toHaveLength(1);
    expect(dataMessages[0].payload).toBe("hello");

    writer.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should send immediately when credits are available", async () => {
    const channel = newMessageChannel();
    const messages: BackpressureMessage<string>[] = [];

    channel.port2.addEventListener("message", (e) => {
      messages.push(e.data as BackpressureMessage<string>);
    });

    const writer = createPortWriter<string>(channel.port1);

    // Grant credits first
    channel.port2.postMessage({ type: "CREDIT", n: 5 } satisfies CreditMessage);
    await nextTick();

    // Write with credits available
    await writer.write("msg1");
    await writer.write("msg2");
    await writer.write("msg3");

    await nextTick();

    const dataMessages = messages.filter((m) => m.type === "DATA") as DataMessage<string>[];
    expect(dataMessages).toHaveLength(3);
    expect(dataMessages.map((m) => m.payload)).toEqual(["msg1", "msg2", "msg3"]);

    writer.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should assign incrementing IDs to messages", async () => {
    const channel = newMessageChannel();
    const messages: DataMessage<string>[] = [];

    channel.port2.addEventListener("message", (e) => {
      const msg = e.data as BackpressureMessage<string>;
      if (msg.type === "DATA") {
        messages.push(msg);
      }
    });

    const writer = createPortWriter<string>(channel.port1);

    // Grant credits
    channel.port2.postMessage({ type: "CREDIT", n: 10 } satisfies CreditMessage);
    await nextTick();

    await writer.write("a");
    await writer.write("b");
    await writer.write("c");
    await nextTick();

    expect(messages.map((m) => m.id)).toEqual([1, 2, 3]);

    writer.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should throw when writing after close", async () => {
    const channel = newMessageChannel();
    const writer = createPortWriter<string>(channel.port1);

    writer.close();

    await expect(writer.write("test")).rejects.toThrow("Cannot write: writer is closed");

    channel.port1.close();
    channel.port2.close();
  });

  it("should drain pending messages", async () => {
    const channel = newMessageChannel();
    const messages: DataMessage<string>[] = [];

    channel.port2.addEventListener("message", (e) => {
      const msg = e.data as BackpressureMessage<string>;
      if (msg.type === "DATA") {
        messages.push(msg);
      }
    });

    const writer = createPortWriter<string>(channel.port1);

    // Queue messages without credits
    writer.write("a");
    writer.write("b");
    writer.write("c");

    // Start draining in background
    const drainPromise = writer.drain();
    await nextTick();

    // Grant credits gradually
    channel.port2.postMessage({ type: "CREDIT", n: 2 } satisfies CreditMessage);
    await nextTick();

    channel.port2.postMessage({ type: "CREDIT", n: 2 } satisfies CreditMessage);
    await nextTick();

    await drainPromise;

    expect(messages.map((m) => m.payload)).toEqual(["a", "b", "c"]);

    writer.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should apply backpressure when exceeding highWaterMark", async () => {
    const channel = newMessageChannel();
    const writer = createPortWriter<number>(channel.port1, { highWaterMark: 3 });

    let writeCompleted = false;

    // Queue many messages without credits
    writer.write(1);
    writer.write(2);
    writer.write(3);

    // This write should block (exceeds highWaterMark)
    const blockedWrite = writer.write(4).then(() => {
      writeCompleted = true;
    });

    await nextTick();
    expect(writeCompleted).toBe(false);

    // Grant credits to unblock
    channel.port2.postMessage({ type: "CREDIT", n: 10 } satisfies CreditMessage);
    await blockedWrite;

    expect(writeCompleted).toBe(true);

    writer.close();
    channel.port1.close();
    channel.port2.close();
  });
});

describe("createPortReceiver", () => {
  it("should grant initial credits", async () => {
    const channel = newMessageChannel();
    const messages: BackpressureMessage<unknown>[] = [];

    channel.port2.addEventListener("message", (e) => {
      messages.push(e.data as BackpressureMessage<unknown>);
    });

    const receiver = createPortReceiver<string>(channel.port1, {
      windowSize: 32,
      onData: () => {},
    });

    await nextTick();

    const creditMessages = messages.filter((m) => m.type === "CREDIT") as CreditMessage[];
    expect(creditMessages).toHaveLength(1);
    expect(creditMessages[0].n).toBe(32);

    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should call onData for each received message", async () => {
    const channel = newMessageChannel();
    const received: string[] = [];

    const receiver = createPortReceiver<string>(channel.port1, {
      onData: (payload) => {
        received.push(payload);
      },
    });

    // Send data messages
    channel.port2.postMessage({
      type: "DATA",
      id: 1,
      payload: "hello",
    } satisfies DataMessage<string>);
    channel.port2.postMessage({
      type: "DATA",
      id: 2,
      payload: "world",
    } satisfies DataMessage<string>);

    await nextTick();

    expect(received).toEqual(["hello", "world"]);

    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should replenish credits in batches", async () => {
    const channel = newMessageChannel();
    const creditMessages: CreditMessage[] = [];

    channel.port2.addEventListener("message", (e) => {
      const msg = e.data as BackpressureMessage<unknown>;
      if (msg.type === "CREDIT") {
        creditMessages.push(msg);
      }
    });

    const receiver = createPortReceiver<number>(channel.port1, {
      windowSize: 10,
      replenishBatch: 3,
      onData: () => {},
    });

    await nextTick();

    // Initial credit
    expect(creditMessages).toHaveLength(1);
    expect(creditMessages[0].n).toBe(10);

    // Send messages
    for (let i = 0; i < 6; i++) {
      channel.port2.postMessage({
        type: "DATA",
        id: i + 1,
        payload: i,
      } satisfies DataMessage<number>);
    }

    await nextTick();

    // Should have received 2 replenishment batches (at 3 and 6 messages)
    expect(creditMessages).toHaveLength(3);
    expect(creditMessages[1].n).toBe(3);
    expect(creditMessages[2].n).toBe(3);

    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should handle async onData callbacks", async () => {
    const channel = newMessageChannel();
    const processed: number[] = [];

    const receiver = createPortReceiver<number>(channel.port1, {
      windowSize: 10,
      replenishBatch: 2,
      onData: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        processed.push(payload);
      },
    });

    // Send messages
    channel.port2.postMessage({ type: "DATA", id: 1, payload: 1 } satisfies DataMessage<number>);
    channel.port2.postMessage({ type: "DATA", id: 2, payload: 2 } satisfies DataMessage<number>);

    // Wait for async processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(processed).toEqual([1, 2]);

    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should stop processing after close", async () => {
    const channel = newMessageChannel();
    const received: string[] = [];

    const receiver = createPortReceiver<string>(channel.port1, {
      onData: (payload) => {
        received.push(payload);
      },
    });

    channel.port2.postMessage({
      type: "DATA",
      id: 1,
      payload: "before",
    } satisfies DataMessage<string>);
    await nextTick();

    receiver.close();

    channel.port2.postMessage({
      type: "DATA",
      id: 2,
      payload: "after",
    } satisfies DataMessage<string>);
    await nextTick();

    expect(received).toEqual(["before"]);

    channel.port1.close();
    channel.port2.close();
  });

  it("should send remaining credits on close", async () => {
    const channel = newMessageChannel();
    const creditMessages: CreditMessage[] = [];

    channel.port2.addEventListener("message", (e) => {
      const msg = e.data as BackpressureMessage<unknown>;
      if (msg.type === "CREDIT") {
        creditMessages.push(msg);
      }
    });

    const receiver = createPortReceiver<number>(channel.port1, {
      windowSize: 10,
      replenishBatch: 5,
      onData: () => {},
    });

    await nextTick();

    // Process 3 messages (not enough for replenish batch)
    channel.port2.postMessage({ type: "DATA", id: 1, payload: 1 } satisfies DataMessage<number>);
    channel.port2.postMessage({ type: "DATA", id: 2, payload: 2 } satisfies DataMessage<number>);
    channel.port2.postMessage({ type: "DATA", id: 3, payload: 3 } satisfies DataMessage<number>);

    await nextTick();

    // Only initial credits sent
    expect(creditMessages).toHaveLength(1);

    receiver.close();
    await nextTick();

    // Remaining credits should be sent on close
    expect(creditMessages).toHaveLength(2);
    expect(creditMessages[1].n).toBe(3);

    channel.port1.close();
    channel.port2.close();
  });
});

describe("writer and receiver integration", () => {
  it("should transfer messages with automatic backpressure", async () => {
    const channel = newMessageChannel();
    const received: number[] = [];

    // Set up receiver
    const receiver = createPortReceiver<number>(channel.port1, {
      windowSize: 10,
      replenishBatch: 5,
      onData: (payload) => {
        received.push(payload);
      },
    });

    // Set up writer
    const writer = createPortWriter<number>(channel.port2);

    // Send many messages
    for (let i = 0; i < 50; i++) {
      await writer.write(i);
    }

    await writer.drain();
    await nextTick();

    expect(received).toHaveLength(50);
    expect(received).toEqual(Array.from({ length: 50 }, (_, i) => i));

    writer.close();
    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should handle slow consumer with backpressure", async () => {
    const channel = newMessageChannel();
    const received: number[] = [];
    const processDelay = 5;

    // Slow receiver
    const receiver = createPortReceiver<number>(channel.port1, {
      windowSize: 5,
      replenishBatch: 2,
      onData: async (payload) => {
        await new Promise((resolve) => setTimeout(resolve, processDelay));
        received.push(payload);
      },
    });

    const writer = createPortWriter<number>(channel.port2, { highWaterMark: 3 });

    // Fast producer
    const writePromises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      writePromises.push(writer.write(i));
    }

    await Promise.all(writePromises);
    await writer.drain();

    // Wait for all processing to complete
    await new Promise((resolve) => setTimeout(resolve, 20 * processDelay + 100));

    expect(received).toHaveLength(20);

    writer.close();
    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should support typed payloads", async () => {
    interface Message {
      id: number;
      text: string;
    }

    const channel = newMessageChannel();
    const received: Message[] = [];

    const receiver = createPortReceiver<Message>(channel.port1, {
      onData: (payload) => {
        received.push(payload);
      },
    });

    const writer = createPortWriter<Message>(channel.port2);

    await writer.write({ id: 1, text: "hello" });
    await writer.write({ id: 2, text: "world" });

    await writer.drain();
    await nextTick();

    expect(received).toEqual([
      { id: 1, text: "hello" },
      { id: 2, text: "world" },
    ]);

    writer.close();
    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });

  it("should handle binary data", async () => {
    const channel = newMessageChannel();
    const received: Uint8Array[] = [];

    const receiver = createPortReceiver<Uint8Array>(channel.port1, {
      onData: (payload) => {
        received.push(payload);
      },
    });

    const writer = createPortWriter<Uint8Array>(channel.port2);

    const data1 = new Uint8Array([1, 2, 3, 4, 5]);
    const data2 = new Uint8Array([10, 20, 30]);

    await writer.write(data1);
    await writer.write(data2);

    await writer.drain();

    // Allow message processing to complete
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(received).toHaveLength(2);
    expect(received[0]).toEqual(data1);
    expect(received[1]).toEqual(data2);

    writer.close();
    receiver.close();
    channel.port1.close();
    channel.port2.close();
  });
});
