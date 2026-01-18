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
});
