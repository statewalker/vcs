/**
 * Tests for native MessagePort wrapper and MessageChannel integration.
 */

import { describe, expect, it } from "vitest";
import { MessagePortStream } from "../src/ports/message-port-stream.js";
import { createNativePort, createNativePortPair } from "../src/ports/native-port.js";
import type { Packet } from "../src/protocol/types.js";

describe("createNativePort", () => {
  it("should wrap a native MessagePort", () => {
    const channel = new MessageChannel();
    const port = createNativePort(channel.port1);

    expect(port.isOpen).toBe(true);
    expect(port.bufferedAmount).toBe(0);

    port.close();
    channel.port2.close();
  });

  it("should post messages through the port", async () => {
    const channel = new MessageChannel();
    const port1 = createNativePort(channel.port1);
    const port2 = createNativePort(channel.port2);

    const received: ArrayBuffer[] = [];
    port2.onmessage = (e) => {
      received.push(e.data);
    };
    port2.start();

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    port1.start();
    port1.postMessage(data);

    // Wait for message to arrive
    await new Promise((r) => setTimeout(r, 10));

    expect(received.length).toBe(1);
    expect(new Uint8Array(received[0])).toEqual(new Uint8Array([1, 2, 3, 4, 5]));

    port1.close();
    port2.close();
  });

  it("should call onclose when closed", () => {
    const channel = new MessageChannel();
    const port = createNativePort(channel.port1);

    let closeCalled = false;
    port.onclose = () => {
      closeCalled = true;
    };

    port.close();

    expect(closeCalled).toBe(true);
    expect(port.isOpen).toBe(false);

    channel.port2.close();
  });

  it("should throw when posting to closed port", () => {
    const channel = new MessageChannel();
    const port = createNativePort(channel.port1);

    port.close();

    expect(() => port.postMessage(new Uint8Array([1]))).toThrow("Port is closed");

    channel.port2.close();
  });
});

describe("createNativePortPair", () => {
  it("should create connected port pair", async () => {
    const [portA, portB] = createNativePortPair();

    const receivedOnB: ArrayBuffer[] = [];
    portB.onmessage = (e) => {
      receivedOnB.push(e.data);
    };
    portB.start();

    portA.start();
    portA.postMessage(new Uint8Array([1, 2, 3]));

    await new Promise((r) => setTimeout(r, 10));

    expect(receivedOnB.length).toBe(1);
    expect(new Uint8Array(receivedOnB[0])).toEqual(new Uint8Array([1, 2, 3]));

    portA.close();
    portB.close();
  });
});

describe("MessageChannel Integration", () => {
  it("should communicate between two MessagePortStreams", async () => {
    const [portA, portB] = createNativePortPair();

    const streamA = new MessagePortStream(portA);
    const streamB = new MessagePortStream(portB);

    // Prepare to receive on B
    const receivePromise = (async () => {
      const packets: Packet[] = [];
      for await (const packet of streamB.receive()) {
        packets.push(packet);
        if (packet.type === "flush") break;
      }
      return packets;
    })();

    // Send from A
    async function* outgoing(): AsyncIterable<Packet> {
      yield { type: "data", data: new TextEncoder().encode("hello") };
      yield { type: "data", data: new TextEncoder().encode("world") };
      yield { type: "flush" };
    }

    await streamA.send(outgoing());

    // Wait for receive
    const received = await receivePromise;

    expect(received.length).toBe(3);
    expect(received[0].type).toBe("data");
    expect(received[1].type).toBe("data");
    expect(received[2].type).toBe("flush");

    if (received[0].type === "data") {
      expect(new TextDecoder().decode(received[0].data)).toBe("hello");
    }
    if (received[1].type === "data") {
      expect(new TextDecoder().decode(received[1].data)).toBe("world");
    }

    await streamA.close();
    await streamB.close();
  });

  it("should handle bidirectional communication", async () => {
    const [portA, portB] = createNativePortPair();

    const streamA = new MessagePortStream(portA);
    const streamB = new MessagePortStream(portB);

    // B listens and responds
    const bTask = (async () => {
      for await (const packet of streamB.receive()) {
        if (packet.type === "data") {
          // Echo back with "pong"
          await streamB.send(
            (async function* () {
              yield { type: "data" as const, data: new TextEncoder().encode("pong") };
              yield { type: "flush" as const };
            })(),
          );
          break;
        }
      }
    })();

    // A sends ping
    await streamA.send(
      (async function* () {
        yield { type: "data" as const, data: new TextEncoder().encode("ping") };
        yield { type: "flush" as const };
      })(),
    );

    // A receives response
    const response: Packet[] = [];
    for await (const packet of streamA.receive()) {
      response.push(packet);
      if (packet.type === "flush") break;
    }

    await bTask;

    expect(response.length).toBe(2);
    expect(response[0].type).toBe("data");
    if (response[0].type === "data") {
      expect(new TextDecoder().decode(response[0].data)).toBe("pong");
    }

    await streamA.close();
    await streamB.close();
  });

  it("should handle large data transfers", async () => {
    const [portA, portB] = createNativePortPair();

    const streamA = new MessagePortStream(portA);
    const streamB = new MessagePortStream(portB);

    // Create data that fits within pkt-line limits (max 65516 bytes)
    const largeData = new Uint8Array(60 * 1024);
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i & 0xff;
    }

    // Receive on B
    const receivePromise = (async () => {
      const packets: Packet[] = [];
      for await (const packet of streamB.receive()) {
        packets.push(packet);
        if (packet.type === "flush") break;
      }
      return packets;
    })();

    // Send from A
    await streamA.send(
      (async function* () {
        yield { type: "data" as const, data: largeData };
        yield { type: "flush" as const };
      })(),
    );

    const received = await receivePromise;

    expect(received.length).toBe(2);
    expect(received[0].type).toBe("data");
    if (received[0].type === "data") {
      expect(received[0].data.length).toBe(largeData.length);
      // Verify first and last bytes
      expect(received[0].data[0]).toBe(0);
      expect(received[0].data[received[0].data.length - 1]).toBe((largeData.length - 1) & 0xff);
    }

    await streamA.close();
    await streamB.close();
  });

  it("should handle stream close during iteration", async () => {
    const [portA, portB] = createNativePortPair();

    const streamA = new MessagePortStream(portA);
    const streamB = new MessagePortStream(portB);

    // Start receiving on B
    const receivePromise = (async () => {
      const packets: Packet[] = [];
      for await (const packet of streamB.receive()) {
        packets.push(packet);
      }
      return packets;
    })();

    // Close A after short delay
    setTimeout(async () => {
      await streamA.close();
    }, 10);

    // Close B after A closes
    setTimeout(async () => {
      await streamB.close();
    }, 20);

    const received = await receivePromise;
    expect(received).toHaveLength(0);
  });
});
