import { wrapNativePort } from "@statewalker/vcs-utils";
import { describe, expect, it } from "vitest";
import {
  createPortTransportConnection,
  PortTransportConnection,
} from "../src/ports/transport-connection";
import type { Packet } from "../src/protocol/types";

describe("PortTransportConnection", () => {
  // Helper to create Uint8Array from string
  function text(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  }

  // Helper to collect all packets
  async function collectPackets(stream: AsyncIterable<Packet>): Promise<Packet[]> {
    const result: Packet[] = [];
    for await (const packet of stream) {
      result.push(packet);
    }
    return result;
  }

  it("should send and receive packets", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    const conn1 = createPortTransportConnection(port1);
    const conn2 = createPortTransportConnection(port2);

    async function* input(): AsyncGenerator<Packet> {
      yield { type: "data", data: text("hello") };
      yield { type: "data", data: text("world") };
      yield { type: "flush" };
    }

    const sendPromise = conn1.send(input());
    const received = await collectPackets(conn2.receive());

    await sendPromise;

    expect(received).toHaveLength(3);
    expect(received[0].type).toBe("data");
    expect(received[1].type).toBe("data");
    expect(received[2].type).toBe("flush");

    await conn1.close();
    await conn2.close();

    channel.port1.close();
    channel.port2.close();
  });

  it("should send raw bytes", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    const conn1 = createPortTransportConnection(port1);
    const conn2 = createPortTransportConnection(port2);

    // Pre-encode a flush packet (0000)
    const flushPacket = text("0000");

    const sendPromise = conn1.sendRaw(flushPacket);
    const received = await collectPackets(conn2.receive());

    await sendPromise;

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("flush");

    await conn1.close();
    await conn2.close();

    channel.port1.close();
    channel.port2.close();
  });

  it("should handle large data with chunking", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    // Small block size to force chunking
    const conn1 = createPortTransportConnection(port1, { blockSize: 100 });
    const conn2 = createPortTransportConnection(port2, { blockSize: 100 });

    // Create large payload
    const largeData = new Uint8Array(500);
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    async function* input(): AsyncGenerator<Packet> {
      yield { type: "data", data: largeData };
      yield { type: "flush" };
    }

    const sendPromise = conn1.send(input());
    const received = await collectPackets(conn2.receive());

    await sendPromise;

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("data");
    expect(received[0].type === "data" && received[0].data).toEqual(largeData);
    expect(received[1].type).toBe("flush");

    await conn1.close();
    await conn2.close();

    channel.port1.close();
    channel.port2.close();
  });

  it("should report closed state", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);

    const conn = new PortTransportConnection(port1);
    expect(conn.isClosed).toBe(false);

    await conn.close();
    expect(conn.isClosed).toBe(true);

    channel.port1.close();
    channel.port2.close();
  });

  it("should throw when sending on closed connection", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);

    const conn = createPortTransportConnection(port1);
    await conn.close();

    async function* input(): AsyncGenerator<Packet> {
      yield { type: "flush" };
    }

    await expect(conn.send(input())).rejects.toThrow("Connection closed");

    channel.port1.close();
    channel.port2.close();
  });

  it("should handle backpressure with slow receiver", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    const conn1 = createPortTransportConnection(port1, { blockSize: 1024 });
    const conn2 = createPortTransportConnection(port2);

    // Create multiple large data packets
    const dataSize = 10000;
    const largeData = new Uint8Array(dataSize);
    for (let i = 0; i < dataSize; i++) {
      largeData[i] = i % 256;
    }

    async function* input(): AsyncGenerator<Packet> {
      yield { type: "data", data: largeData };
      yield { type: "flush" };
    }

    // Receive with artificial delay to simulate slow processing
    let receivedBytes = 0;
    const receivePromise = (async () => {
      for await (const packet of conn2.receive()) {
        if (packet.type === "data" && packet.data) {
          receivedBytes += packet.data.length;
          // Simulate slow processing
          await new Promise((r) => setTimeout(r, 5));
        }
      }
    })();

    const sendPromise = conn1.send(input());

    await Promise.all([sendPromise, receivePromise]);

    // Verify all bytes were received
    expect(receivedBytes).toBe(dataSize);

    await conn1.close();
    await conn2.close();

    channel.port1.close();
    channel.port2.close();
  });

  it("should support bidirectional communication", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    const conn1 = createPortTransportConnection(port1);
    const conn2 = createPortTransportConnection(port2);

    // Send from conn1 to conn2
    async function* input1(): AsyncGenerator<Packet> {
      yield { type: "data", data: text("from-1") };
      yield { type: "flush" };
    }

    // Send from conn2 to conn1 (simulating response)
    async function* input2(): AsyncGenerator<Packet> {
      yield { type: "data", data: text("from-2") };
      yield { type: "flush" };
    }

    // First direction: 1 -> 2
    const send1Promise = conn1.send(input1());
    const received1 = await collectPackets(conn2.receive());
    await send1Promise;

    expect(received1).toHaveLength(2);
    expect(received1[0].type).toBe("data");
    expect(received1[0].type === "data" && new TextDecoder().decode(received1[0].data)).toBe(
      "from-1",
    );

    // Second direction: 2 -> 1
    const send2Promise = conn2.send(input2());
    const received2 = await collectPackets(conn1.receive());
    await send2Promise;

    expect(received2).toHaveLength(2);
    expect(received2[0].type).toBe("data");
    expect(received2[0].type === "data" && new TextDecoder().decode(received2[0].data)).toBe(
      "from-2",
    );

    await conn1.close();
    await conn2.close();

    channel.port1.close();
    channel.port2.close();
  });

  it("should handle many packets in sequence", async () => {
    const channel = new MessageChannel();
    const port1 = wrapNativePort(channel.port1);
    const port2 = wrapNativePort(channel.port2);

    const conn1 = createPortTransportConnection(port1);
    const conn2 = createPortTransportConnection(port2);

    const packetCount = 50;

    async function* input(): AsyncGenerator<Packet> {
      for (let i = 0; i < packetCount; i++) {
        yield { type: "data", data: text(`packet-${i}`) };
      }
      yield { type: "flush" };
    }

    const sendPromise = conn1.send(input());
    const received = await collectPackets(conn2.receive());

    await sendPromise;

    expect(received).toHaveLength(packetCount + 1);
    expect(received[packetCount].type).toBe("flush");

    // Verify content of a few packets
    expect(received[0].type === "data" && new TextDecoder().decode(received[0].data)).toBe(
      "packet-0",
    );
    expect(received[25].type === "data" && new TextDecoder().decode(received[25].data)).toBe(
      "packet-25",
    );
    expect(received[49].type === "data" && new TextDecoder().decode(received[49].data)).toBe(
      "packet-49",
    );

    await conn1.close();
    await conn2.close();

    channel.port1.close();
    channel.port2.close();
  });
});
