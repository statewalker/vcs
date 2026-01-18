/**
 * Tests for pack serialization/deserialization.
 */

import { describe, expect, it } from "vitest";
import type { Packet } from "../src/protocol/types.js";
import {
  createPacketTransport,
  DEFAULT_BLOCK_SIZE,
  deserializePacks,
  serializePacks,
} from "../src/streams/pack-serialization.js";

// Helper to collect packets from async iterable
async function collectPackets(stream: AsyncIterable<Packet>): Promise<Packet[]> {
  const result: Packet[] = [];
  for await (const packet of stream) {
    result.push(packet);
  }
  return result;
}

// Helper to collect Uint8Array blocks
async function collectBlocks(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array[]> {
  const result: Uint8Array[] = [];
  for await (const block of stream) {
    result.push(block);
  }
  return result;
}

// Helper to create async iterable from array
async function* fromArray<T>(arr: T[]): AsyncGenerator<T> {
  for (const item of arr) {
    yield item;
  }
}

// Helper to get packet string content
function packetContent(packet: Packet): string | null {
  if (packet.type === "data" && packet.data) {
    return new TextDecoder().decode(packet.data);
  }
  return null;
}

describe("serializePacks and deserializePacks", () => {
  // =============================================================================
  // Basic functionality
  // =============================================================================

  it("should serialize and deserialize empty packet stream", async () => {
    const packets: Packet[] = [];
    const blocks = await collectBlocks(serializePacks(fromArray(packets)));
    expect(blocks).toHaveLength(0);

    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));
    expect(deserialized).toHaveLength(0);
  });

  it("should round-trip a single data packet", async () => {
    const packets: Packet[] = [{ type: "data", data: new TextEncoder().encode("hello\n") }];

    const blocks = await collectBlocks(serializePacks(fromArray(packets)));
    expect(blocks.length).toBeGreaterThan(0);

    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));
    expect(deserialized).toHaveLength(1);
    expect(deserialized[0].type).toBe("data");
    expect(packetContent(deserialized[0])).toBe("hello\n");
  });

  it("should round-trip multiple data packets", async () => {
    const packets: Packet[] = [
      { type: "data", data: new TextEncoder().encode("first\n") },
      { type: "data", data: new TextEncoder().encode("second\n") },
      { type: "data", data: new TextEncoder().encode("third\n") },
    ];

    const blocks = await collectBlocks(serializePacks(fromArray(packets)));
    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));

    expect(deserialized).toHaveLength(3);
    expect(packetContent(deserialized[0])).toBe("first\n");
    expect(packetContent(deserialized[1])).toBe("second\n");
    expect(packetContent(deserialized[2])).toBe("third\n");
  });

  it("should round-trip flush packets", async () => {
    const packets: Packet[] = [
      { type: "data", data: new TextEncoder().encode("hello\n") },
      { type: "flush" },
    ];

    const blocks = await collectBlocks(serializePacks(fromArray(packets)));
    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));

    expect(deserialized).toHaveLength(2);
    expect(deserialized[0].type).toBe("data");
    expect(deserialized[1].type).toBe("flush");
  });

  it("should round-trip delimiter packets", async () => {
    const packets: Packet[] = [
      { type: "data", data: new TextEncoder().encode("before\n") },
      { type: "delim" },
      { type: "data", data: new TextEncoder().encode("after\n") },
    ];

    const blocks = await collectBlocks(serializePacks(fromArray(packets)));
    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));

    expect(deserialized).toHaveLength(3);
    expect(deserialized[0].type).toBe("data");
    expect(deserialized[1].type).toBe("delim");
    expect(deserialized[2].type).toBe("data");
  });

  // =============================================================================
  // Block size behavior
  // =============================================================================

  it("should chunk into blocks of specified size", async () => {
    // Create a packet with large content
    const largeContent = "x".repeat(1000);
    const packets: Packet[] = [{ type: "data", data: new TextEncoder().encode(largeContent) }];

    // Use small block size to force multiple blocks
    const blocks = await collectBlocks(serializePacks(fromArray(packets), { blockSize: 100 }));

    // Should have multiple blocks
    expect(blocks.length).toBeGreaterThan(1);

    // All blocks except last should be exactly blockSize
    for (let i = 0; i < blocks.length - 1; i++) {
      expect(blocks[i].length).toBe(100);
    }

    // Last block may be smaller
    expect(blocks[blocks.length - 1].length).toBeLessThanOrEqual(100);
  });

  it("should use default block size of 128KB", async () => {
    expect(DEFAULT_BLOCK_SIZE).toBe(128 * 1024);
  });

  it("should preserve data across chunking boundaries", async () => {
    // Create content that will span multiple blocks
    const content1 = "a".repeat(150);
    const content2 = "b".repeat(150);
    const packets: Packet[] = [
      { type: "data", data: new TextEncoder().encode(content1) },
      { type: "data", data: new TextEncoder().encode(content2) },
    ];

    // Small block size to ensure chunking across packets
    const blocks = await collectBlocks(serializePacks(fromArray(packets), { blockSize: 50 }));

    // Deserialize and verify data integrity
    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));

    expect(deserialized).toHaveLength(2);
    expect(packetContent(deserialized[0])).toBe(content1);
    expect(packetContent(deserialized[1])).toBe(content2);
  });

  // =============================================================================
  // Git protocol patterns
  // =============================================================================

  it("should handle typical git fetch request pattern", async () => {
    const packets: Packet[] = [
      { type: "data", data: new TextEncoder().encode("want abc123\n") },
      { type: "data", data: new TextEncoder().encode("want def456\n") },
      { type: "flush" },
      { type: "data", data: new TextEncoder().encode("have 111222\n") },
      { type: "data", data: new TextEncoder().encode("have 333444\n") },
      { type: "data", data: new TextEncoder().encode("done\n") },
      { type: "flush" },
    ];

    const blocks = await collectBlocks(serializePacks(fromArray(packets)));
    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));

    expect(deserialized).toHaveLength(7);
    expect(deserialized[0].type).toBe("data");
    expect(packetContent(deserialized[0])).toBe("want abc123\n");
    expect(deserialized[2].type).toBe("flush");
    expect(deserialized[6].type).toBe("flush");
  });

  it("should handle large binary pack data", async () => {
    // Simulate pack header
    const packHeader = new Uint8Array([
      0x50,
      0x41,
      0x43,
      0x4b, // "PACK"
      0,
      0,
      0,
      2, // version 2
      0,
      0,
      0,
      5, // 5 objects
    ]);

    // Simulate some binary pack content
    const packContent = new Uint8Array(10000);
    for (let i = 0; i < packContent.length; i++) {
      packContent[i] = i % 256;
    }

    const packets: Packet[] = [
      { type: "data", data: packHeader },
      { type: "data", data: packContent },
    ];

    const blocks = await collectBlocks(serializePacks(fromArray(packets), { blockSize: 1024 }));
    const deserialized = await collectPackets(deserializePacks(fromArray(blocks)));

    expect(deserialized).toHaveLength(2);
    expect(deserialized[0].type).toBe("data");
    expect(deserialized[0].data).toEqual(packHeader);
    expect(deserialized[1].data).toEqual(packContent);
  });

  // =============================================================================
  // createPacketTransport
  // =============================================================================

  it("should create transport with default block size", async () => {
    const transport = createPacketTransport();

    const packets: Packet[] = [{ type: "data", data: new TextEncoder().encode("test\n") }];

    const blocks = await collectBlocks(transport.serialize(fromArray(packets)));
    const deserialized = await collectPackets(transport.deserialize(fromArray(blocks)));

    expect(deserialized).toHaveLength(1);
    expect(packetContent(deserialized[0])).toBe("test\n");
  });

  it("should create transport with custom block size", async () => {
    const transport = createPacketTransport(64);

    const largeContent = "x".repeat(200);
    const packets: Packet[] = [{ type: "data", data: new TextEncoder().encode(largeContent) }];

    const blocks = await collectBlocks(transport.serialize(fromArray(packets)));

    // Should produce multiple blocks with custom size
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks[0].length).toBe(64);
  });
});
