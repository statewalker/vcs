/**
 * Tests for PortTransportConnection.
 *
 * Verifies that two connected PortTransportConnection instances can
 * send and receive data simultaneously with proper packet framing.
 */

import { wrapNativePort } from "@statewalker/vcs-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  createPortTransportConnection,
  PortTransportConnection,
} from "../src/peer/port-transport-connection.js";
import {
  dataPacket,
  delimPacket,
  flushPacket,
  packetDataToString,
} from "../src/protocol/pkt-line-codec.js";
import type { Packet } from "../src/protocol/types.js";

// Track created resources for cleanup
const channels: MessageChannel[] = [];
const connections: PortTransportConnection[] = [];

function createChannel(): MessageChannel {
  const channel = new MessageChannel();
  channels.push(channel);
  return channel;
}

function createConnectionPair(options?: {
  blockSize?: number;
  ackTimeout?: number;
}): [PortTransportConnection, PortTransportConnection] {
  const channel = createChannel();
  const conn1 = new PortTransportConnection(wrapNativePort(channel.port1), options);
  const conn2 = new PortTransportConnection(wrapNativePort(channel.port2), options);
  connections.push(conn1, conn2);
  return [conn1, conn2];
}

afterEach(async () => {
  for (const conn of connections) {
    await conn.close();
  }
  connections.length = 0;

  for (const channel of channels) {
    channel.port1.close();
    channel.port2.close();
  }
  channels.length = 0;
});

// Helper to create Uint8Array from string
function _bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper to collect all packets
async function collectPackets(stream: AsyncIterable<Packet>): Promise<Packet[]> {
  const result: Packet[] = [];
  for await (const packet of stream) {
    result.push(packet);
  }
  return result;
}

// Helper to create async generator from array
async function* packetsFromArray(packets: Packet[]): AsyncGenerator<Packet> {
  for (const packet of packets) {
    yield packet;
  }
}

// =============================================================================
// Basic Send/Receive
// =============================================================================

describe("PortTransportConnection - Basic Operations", () => {
  it("should send and receive a single data packet", async () => {
    const [sender, receiver] = createConnectionPair();

    const sendPromise = sender.send(packetsFromArray([dataPacket("hello world\n"), flushPacket()]));

    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("data");
    expect(packetDataToString(received[0])).toBe("hello world");
    expect(received[1].type).toBe("flush");
  });

  it("should send and receive multiple data packets", async () => {
    const [sender, receiver] = createConnectionPair();

    const sendPromise = sender.send(
      packetsFromArray([
        dataPacket("packet 1\n"),
        dataPacket("packet 2\n"),
        dataPacket("packet 3\n"),
        flushPacket(),
      ]),
    );

    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(4);
    expect(packetDataToString(received[0])).toBe("packet 1");
    expect(packetDataToString(received[1])).toBe("packet 2");
    expect(packetDataToString(received[2])).toBe("packet 3");
    expect(received[3].type).toBe("flush");
  });

  it("should handle empty stream (flush only)", async () => {
    const [sender, receiver] = createConnectionPair();

    const sendPromise = sender.send(packetsFromArray([flushPacket()]));
    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("flush");
  });

  it("should send and receive delimiter packets", async () => {
    const [sender, receiver] = createConnectionPair();

    const sendPromise = sender.send(
      packetsFromArray([
        dataPacket("section 1\n"),
        delimPacket(),
        dataPacket("section 2\n"),
        flushPacket(),
      ]),
    );

    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(4);
    expect(packetDataToString(received[0])).toBe("section 1");
    expect(received[1].type).toBe("delim");
    expect(packetDataToString(received[2])).toBe("section 2");
    expect(received[3].type).toBe("flush");
  });
});

// =============================================================================
// Bidirectional Communication
// =============================================================================

describe("PortTransportConnection - Bidirectional Communication", () => {
  it("should allow simultaneous send from both ends", async () => {
    const [conn1, conn2] = createConnectionPair();

    // Both connections send data simultaneously
    const send1Promise = conn1.send(packetsFromArray([dataPacket("from conn1\n"), flushPacket()]));

    const send2Promise = conn2.send(packetsFromArray([dataPacket("from conn2\n"), flushPacket()]));

    // Both connections receive data simultaneously
    const [received1, received2] = await Promise.all([
      collectPackets(conn2.receive()),
      collectPackets(conn1.receive()),
    ]);

    await Promise.all([send1Promise, send2Promise]);

    // Verify conn1's data was received by conn2
    expect(received1).toHaveLength(2);
    expect(packetDataToString(received1[0])).toBe("from conn1");
    expect(received1[1].type).toBe("flush");

    // Verify conn2's data was received by conn1
    expect(received2).toHaveLength(2);
    expect(packetDataToString(received2[0])).toBe("from conn2");
    expect(received2[1].type).toBe("flush");
  });

  it("should handle interleaved bidirectional messages", async () => {
    const [conn1, conn2] = createConnectionPair();

    // Set up tracking for interleaving
    const events: string[] = [];

    async function* conn1Packets(): AsyncGenerator<Packet> {
      events.push("conn1-send-1");
      yield dataPacket("c1-msg1\n");
      events.push("conn1-send-2");
      yield dataPacket("c1-msg2\n");
      events.push("conn1-send-flush");
      yield flushPacket();
    }

    async function* conn2Packets(): AsyncGenerator<Packet> {
      events.push("conn2-send-1");
      yield dataPacket("c2-msg1\n");
      events.push("conn2-send-2");
      yield dataPacket("c2-msg2\n");
      events.push("conn2-send-3");
      yield dataPacket("c2-msg3\n");
      events.push("conn2-send-flush");
      yield flushPacket();
    }

    // Start both sends
    const send1Promise = conn1.send(conn1Packets());
    const send2Promise = conn2.send(conn2Packets());

    // Receive from both sides
    const [received1, received2] = await Promise.all([
      collectPackets(conn2.receive()),
      collectPackets(conn1.receive()),
    ]);

    await Promise.all([send1Promise, send2Promise]);

    // Verify messages
    expect(received1).toHaveLength(3); // 2 data + 1 flush
    expect(received2).toHaveLength(4); // 3 data + 1 flush
  });

  it("should handle asymmetric message sizes in bidirectional communication", async () => {
    const [conn1, conn2] = createConnectionPair();

    // conn1 sends a small message
    const smallPackets = [dataPacket("small\n"), flushPacket()];

    // conn2 sends a large message with many packets
    const largePackets = Array.from({ length: 50 }, (_, i) =>
      dataPacket(`message ${i.toString().padStart(3, "0")}\n`),
    );
    largePackets.push(flushPacket());

    const send1Promise = conn1.send(packetsFromArray(smallPackets));
    const send2Promise = conn2.send(packetsFromArray(largePackets));

    const [received1, received2] = await Promise.all([
      collectPackets(conn2.receive()),
      collectPackets(conn1.receive()),
    ]);

    await Promise.all([send1Promise, send2Promise]);

    expect(received1).toHaveLength(2); // small + flush
    expect(received2).toHaveLength(51); // 50 data + flush
  });
});

// =============================================================================
// Data Integrity
// =============================================================================

describe("PortTransportConnection - Data Integrity", () => {
  it("should preserve binary data", async () => {
    const [sender, receiver] = createConnectionPair();

    // Create binary data with all byte values
    const binaryData = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      binaryData[i] = i;
    }

    const sendPromise = sender.send(
      packetsFromArray([{ type: "data", data: binaryData }, flushPacket()]),
    );

    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("data");
    expect(received[0].data).toEqual(binaryData);
  });

  it("should handle large packets", async () => {
    const [sender, receiver] = createConnectionPair({ blockSize: 1024 });

    // Create a large packet (larger than default block size)
    const largeData = new Uint8Array(10000);
    for (let i = 0; i < largeData.length; i++) {
      largeData[i] = i % 256;
    }

    const sendPromise = sender.send(
      packetsFromArray([{ type: "data", data: largeData }, flushPacket()]),
    );

    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(2);
    expect(received[0].type).toBe("data");
    expect(received[0].data?.length).toBe(largeData.length);
    expect(received[0].data).toEqual(largeData);
  });

  it("should preserve order of many small packets", async () => {
    const [sender, receiver] = createConnectionPair();

    const packetCount = 100;
    const packets: Packet[] = [];
    for (let i = 0; i < packetCount; i++) {
      packets.push(dataPacket(`msg-${i.toString().padStart(4, "0")}\n`));
    }
    packets.push(flushPacket());

    const sendPromise = sender.send(packetsFromArray(packets));
    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(packetCount + 1);
    for (let i = 0; i < packetCount; i++) {
      expect(packetDataToString(received[i])).toBe(`msg-${i.toString().padStart(4, "0")}`);
    }
    expect(received[packetCount].type).toBe("flush");
  });
});

// =============================================================================
// SendRaw
// =============================================================================

describe("PortTransportConnection - sendRaw", () => {
  it("should send raw bytes", async () => {
    const [sender, receiver] = createConnectionPair();

    // Create raw pkt-line encoded data manually
    // "0009test\n" is a valid pkt-line packet
    const rawData = new TextEncoder().encode("0009test\n0000");

    const sendPromise = sender.sendRaw(rawData);
    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(2);
    expect(packetDataToString(received[0])).toBe("test");
    expect(received[1].type).toBe("flush");
  });

  it("should send large raw data", async () => {
    const [sender, receiver] = createConnectionPair({ blockSize: 100 });

    // Build a large raw pkt-line stream
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < 50; i++) {
      const line = `line-${i.toString().padStart(3, "0")}\n`;
      const length = (4 + line.length).toString(16).padStart(4, "0");
      chunks.push(encoder.encode(length + line));
    }
    chunks.push(encoder.encode("0000")); // flush

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const rawData = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      rawData.set(chunk, offset);
      offset += chunk.length;
    }

    const sendPromise = sender.sendRaw(rawData);
    const received = await collectPackets(receiver.receive());
    await sendPromise;

    expect(received).toHaveLength(51); // 50 data + 1 flush
    for (let i = 0; i < 50; i++) {
      expect(packetDataToString(received[i])).toBe(`line-${i.toString().padStart(3, "0")}`);
    }
  });
});

// =============================================================================
// Connection State
// =============================================================================

describe("PortTransportConnection - Connection State", () => {
  it("should report isClosed correctly", async () => {
    const [conn1, conn2] = createConnectionPair();

    expect(conn1.isClosed).toBe(false);
    expect(conn2.isClosed).toBe(false);

    await conn1.close();
    expect(conn1.isClosed).toBe(true);
    expect(conn2.isClosed).toBe(false);

    await conn2.close();
    expect(conn2.isClosed).toBe(true);
  });

  it("should throw when sending on closed connection", async () => {
    const [sender, _receiver] = createConnectionPair();

    await sender.close();

    await expect(
      sender.send(packetsFromArray([dataPacket("test\n"), flushPacket()])),
    ).rejects.toThrow("Connection closed");
  });

  it("should throw when sendRaw on closed connection", async () => {
    const [sender] = createConnectionPair();

    await sender.close();

    await expect(sender.sendRaw(new Uint8Array([1, 2, 3]))).rejects.toThrow("Connection closed");
  });

  it("should allow closing multiple times", async () => {
    const [conn1] = createConnectionPair();

    await conn1.close();
    await conn1.close();
    await conn1.close();

    expect(conn1.isClosed).toBe(true);
  });
});

// =============================================================================
// Factory Function
// =============================================================================

describe("createPortTransportConnection", () => {
  it("should create a functional connection", async () => {
    const channel = createChannel();
    const conn1 = createPortTransportConnection(wrapNativePort(channel.port1));
    const conn2 = createPortTransportConnection(wrapNativePort(channel.port2));
    connections.push(conn1 as PortTransportConnection, conn2 as PortTransportConnection);

    const sendPromise = conn1.send(packetsFromArray([dataPacket("factory test\n"), flushPacket()]));

    const received = await collectPackets(conn2.receive());
    await sendPromise;

    expect(received).toHaveLength(2);
    expect(packetDataToString(received[0])).toBe("factory test");
  });

  it("should accept options", async () => {
    const channel = createChannel();
    const conn1 = createPortTransportConnection(wrapNativePort(channel.port1), {
      blockSize: 512,
      ackTimeout: 5000,
    });
    const conn2 = createPortTransportConnection(wrapNativePort(channel.port2), {
      blockSize: 512,
      ackTimeout: 5000,
    });
    connections.push(conn1 as PortTransportConnection, conn2 as PortTransportConnection);

    const sendPromise = conn1.send(packetsFromArray([dataPacket("with options\n"), flushPacket()]));

    const received = await collectPackets(conn2.receive());
    await sendPromise;

    expect(received).toHaveLength(2);
    expect(packetDataToString(received[0])).toBe("with options");
  });
});

// =============================================================================
// Stress Tests
// =============================================================================

describe("PortTransportConnection - Stress Tests", () => {
  it("should handle rapid bidirectional exchange", async () => {
    const [conn1, conn2] = createConnectionPair({ blockSize: 256 });
    const messageCount = 20;

    // Generate packets for both connections
    const conn1Packets: Packet[] = Array.from({ length: messageCount }, (_, i) =>
      dataPacket(`conn1-${i}\n`),
    );
    conn1Packets.push(flushPacket());

    const conn2Packets: Packet[] = Array.from({ length: messageCount }, (_, i) =>
      dataPacket(`conn2-${i}\n`),
    );
    conn2Packets.push(flushPacket());

    // Send and receive simultaneously
    const [received1, received2] = await Promise.all([
      (async () => {
        const promise = conn1.send(packetsFromArray(conn1Packets));
        const result = await collectPackets(conn2.receive());
        await promise;
        return result;
      })(),
      (async () => {
        const promise = conn2.send(packetsFromArray(conn2Packets));
        const result = await collectPackets(conn1.receive());
        await promise;
        return result;
      })(),
    ]);

    // Verify all messages received correctly
    expect(received1).toHaveLength(messageCount + 1);
    expect(received2).toHaveLength(messageCount + 1);

    for (let i = 0; i < messageCount; i++) {
      expect(packetDataToString(received1[i])).toBe(`conn1-${i}`);
      expect(packetDataToString(received2[i])).toBe(`conn2-${i}`);
    }
  });

  it("should handle alternating send-receive pattern", async () => {
    const [conn1, conn2] = createConnectionPair();
    const rounds = 5;
    const results: string[] = [];

    for (let i = 0; i < rounds; i++) {
      // conn1 sends, conn2 receives
      const send1Promise = conn1.send(
        packetsFromArray([dataPacket(`round-${i}-from-1\n`), flushPacket()]),
      );

      const recv1 = await collectPackets(conn2.receive());
      await send1Promise;
      results.push(packetDataToString(recv1[0]));

      // conn2 sends, conn1 receives
      const send2Promise = conn2.send(
        packetsFromArray([dataPacket(`round-${i}-from-2\n`), flushPacket()]),
      );

      const recv2 = await collectPackets(conn1.receive());
      await send2Promise;
      results.push(packetDataToString(recv2[0]));
    }

    expect(results).toHaveLength(rounds * 2);
    for (let i = 0; i < rounds; i++) {
      expect(results[i * 2]).toBe(`round-${i}-from-1`);
      expect(results[i * 2 + 1]).toBe(`round-${i}-from-2`);
    }
  });
});
