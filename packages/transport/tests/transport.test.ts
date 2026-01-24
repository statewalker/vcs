/**
 * Core Transport Tests
 * Tests for Git transport protocol API and operations.
 * Ported from JGit's TransportTest.java
 */

import { describe, expect, it, vi } from "vitest";
import type { Duplex } from "../src/api/duplex.js";
import { createTransportApi } from "../src/factories/transport-api-factory.js";
import { ProtocolState } from "../src/context/protocol-state.js";
import { encodeFlush, encodePacketLine, encodeDelim } from "../src/protocol/pkt-line-codec.js";

/**
 * Creates a mock duplex stream from byte data.
 */
function createMockDuplex(data: Uint8Array[]): Duplex & { output: Uint8Array[] } {
  let index = 0;
  const output: Uint8Array[] = [];

  return {
    output,
    write(chunk: Uint8Array): void {
      output.push(chunk);
    },
    async *[Symbol.asyncIterator](): AsyncGenerator<Uint8Array> {
      while (index < data.length) {
        yield data[index++];
      }
    },
  };
}

/**
 * Helper to concatenate byte arrays.
 */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

describe("TransportApi Factory", () => {
  describe("createTransportApi", () => {
    it("should create transport from duplex and state", () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();

      const transport = createTransportApi(duplex, state);

      expect(transport).toBeDefined();
      expect(transport.readPktLine).toBeInstanceOf(Function);
      expect(transport.writePktLine).toBeInstanceOf(Function);
      expect(transport.writeFlush).toBeInstanceOf(Function);
      expect(transport.writeDelimiter).toBeInstanceOf(Function);
      expect(transport.readLine).toBeInstanceOf(Function);
      expect(transport.writeLine).toBeInstanceOf(Function);
      expect(transport.readSideband).toBeInstanceOf(Function);
      expect(transport.writeSideband).toBeInstanceOf(Function);
      expect(transport.readPack).toBeInstanceOf(Function);
      expect(transport.writePack).toBeInstanceOf(Function);
    });
  });
});

describe("Pkt-Line Reading", () => {
  describe("readPktLine", () => {
    it("should read data packet", async () => {
      const pktLine = encodePacketLine("hello world\n");
      const duplex = createMockDuplex([pktLine]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readPktLine();

      expect(result.type).toBe("data");
      if (result.type === "data") {
        expect(result.text).toBe("hello world");
      }
    });

    it("should read flush packet", async () => {
      const flush = encodeFlush();
      const duplex = createMockDuplex([flush]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readPktLine();

      expect(result.type).toBe("flush");
    });

    it("should read delimiter packet", async () => {
      const delim = encodeDelim();
      const duplex = createMockDuplex([delim]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readPktLine();

      expect(result.type).toBe("delim");
    });

    it("should return eof on empty stream", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readPktLine();

      expect(result.type).toBe("eof");
    });

    it("should read multiple packets in sequence", async () => {
      const data = concat(
        encodePacketLine("line 1\n"),
        encodePacketLine("line 2\n"),
        encodeFlush(),
      );
      const duplex = createMockDuplex([data]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const pkt1 = await transport.readPktLine();
      const pkt2 = await transport.readPktLine();
      const pkt3 = await transport.readPktLine();

      expect(pkt1.type).toBe("data");
      expect(pkt2.type).toBe("data");
      expect(pkt3.type).toBe("flush");
      if (pkt1.type === "data") expect(pkt1.text).toBe("line 1");
      if (pkt2.type === "data") expect(pkt2.text).toBe("line 2");
    });

    it("should handle chunked data across multiple reads", async () => {
      const pktLine = encodePacketLine("hello world\n");
      // Split the packet in the middle
      const chunk1 = pktLine.slice(0, 4);  // Length prefix
      const chunk2 = pktLine.slice(4);     // Data

      const duplex = createMockDuplex([chunk1, chunk2]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readPktLine();

      expect(result.type).toBe("data");
      if (result.type === "data") {
        expect(result.text).toBe("hello world");
      }
    });

    it("should strip trailing newline from text", async () => {
      const pktLine = encodePacketLine("test\n");
      const duplex = createMockDuplex([pktLine]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readPktLine();

      expect(result.type).toBe("data");
      if (result.type === "data") {
        expect(result.text).toBe("test");
      }
    });

    it("should preserve payload bytes", async () => {
      const pktLine = encodePacketLine("data\n");
      const duplex = createMockDuplex([pktLine]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readPktLine();

      expect(result.type).toBe("data");
      if (result.type === "data") {
        // Payload includes the newline
        expect(result.payload.length).toBe(5);
      }
    });
  });

  describe("readLine", () => {
    it("should read text line from data packet", async () => {
      const pktLine = encodePacketLine("hello\n");
      const duplex = createMockDuplex([pktLine]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const line = await transport.readLine();

      expect(line).toBe("hello");
    });

    it("should return null on flush packet", async () => {
      const flush = encodeFlush();
      const duplex = createMockDuplex([flush]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const line = await transport.readLine();

      expect(line).toBeNull();
    });

    it("should return null on eof", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const line = await transport.readLine();

      expect(line).toBeNull();
    });
  });
});

describe("Pkt-Line Writing", () => {
  describe("writePktLine", () => {
    it("should write string data as pkt-line", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      await transport.writePktLine("hello\n");

      expect(duplex.output.length).toBe(1);
      // Verify length prefix
      const textDecoder = new TextDecoder();
      const output = textDecoder.decode(duplex.output[0]);
      expect(output).toMatch(/^[0-9a-f]{4}hello\n$/);
    });

    it("should write bytes as pkt-line", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);
      const data = new Uint8Array([0x01, 0x02, 0x03]);

      await transport.writePktLine(data);

      expect(duplex.output.length).toBe(1);
      // Should have 4-byte length prefix + data
      expect(duplex.output[0].length).toBe(7); // "0007" + data
    });
  });

  describe("writeFlush", () => {
    it("should write flush packet (0000)", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      await transport.writeFlush();

      expect(duplex.output.length).toBe(1);
      const textDecoder = new TextDecoder();
      const output = textDecoder.decode(duplex.output[0]);
      expect(output).toBe("0000");
    });
  });

  describe("writeDelimiter", () => {
    it("should write delimiter packet (0001)", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      await transport.writeDelimiter();

      expect(duplex.output.length).toBe(1);
      const textDecoder = new TextDecoder();
      const output = textDecoder.decode(duplex.output[0]);
      expect(output).toBe("0001");
    });
  });

  describe("writeLine", () => {
    it("should write line with newline appended", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      await transport.writeLine("hello");

      const textDecoder = new TextDecoder();
      const output = textDecoder.decode(duplex.output[0]);
      expect(output).toContain("hello\n");
    });

    it("should not double newline if already present", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      await transport.writeLine("hello\n");

      const textDecoder = new TextDecoder();
      const output = textDecoder.decode(duplex.output[0]);
      // Should not have "hello\n\n"
      expect(output.match(/\n/g)?.length).toBe(1);
    });
  });
});

describe("Sideband Operations", () => {
  describe("readSideband", () => {
    it("should read sideband channel 1 (data)", async () => {
      // Sideband packet: length prefix + channel byte + data
      const textEncoder = new TextEncoder();
      const channel = new Uint8Array([0x01]);
      const data = textEncoder.encode("pack data");
      const payload = concat(channel, data);
      const lengthPrefix = textEncoder.encode(`${(payload.length + 4).toString(16).padStart(4, "0")}`);
      const pkt = concat(lengthPrefix, payload);

      const duplex = createMockDuplex([pkt]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readSideband();

      expect(result.channel).toBe(1);
      expect(new TextDecoder().decode(result.data)).toBe("pack data");
    });

    it("should read sideband channel 2 (progress)", async () => {
      const textEncoder = new TextEncoder();
      const channel = new Uint8Array([0x02]);
      const data = textEncoder.encode("Counting objects: 100%");
      const payload = concat(channel, data);
      const lengthPrefix = textEncoder.encode(`${(payload.length + 4).toString(16).padStart(4, "0")}`);
      const pkt = concat(lengthPrefix, payload);

      const duplex = createMockDuplex([pkt]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readSideband();

      expect(result.channel).toBe(2);
      expect(new TextDecoder().decode(result.data)).toContain("Counting objects");
    });

    it("should read sideband channel 3 (error)", async () => {
      const textEncoder = new TextEncoder();
      const channel = new Uint8Array([0x03]);
      const data = textEncoder.encode("fatal: repository not found");
      const payload = concat(channel, data);
      const lengthPrefix = textEncoder.encode(`${(payload.length + 4).toString(16).padStart(4, "0")}`);
      const pkt = concat(lengthPrefix, payload);

      const duplex = createMockDuplex([pkt]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const result = await transport.readSideband();

      expect(result.channel).toBe(3);
      expect(new TextDecoder().decode(result.data)).toContain("repository not found");
    });

    it("should throw on non-data packet", async () => {
      const flush = encodeFlush();
      const duplex = createMockDuplex([flush]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      await expect(transport.readSideband()).rejects.toThrow("Expected data packet");
    });
  });

  describe("writeSideband", () => {
    it("should write data on channel 1", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);
      const data = new Uint8Array([0x01, 0x02, 0x03]);

      await transport.writeSideband(1, data);

      expect(duplex.output.length).toBe(1);
      // First byte after length should be channel
      const output = duplex.output[0];
      expect(output[4]).toBe(0x01);
    });

    it("should write progress on channel 2", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);
      const data = new TextEncoder().encode("progress");

      await transport.writeSideband(2, data);

      const output = duplex.output[0];
      expect(output[4]).toBe(0x02);
    });

    it("should write error on channel 3", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);
      const data = new TextEncoder().encode("error message");

      await transport.writeSideband(3, data);

      const output = duplex.output[0];
      expect(output[4]).toBe(0x03);
    });
  });
});

describe("Pack Streaming", () => {
  describe("readPack (without sideband)", () => {
    it("should read raw pack data when no sideband capability", async () => {
      const packData1 = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
      const packData2 = new Uint8Array([0x00, 0x00, 0x00, 0x02]); // version

      const duplex = createMockDuplex([packData1, packData2]);
      const state = new ProtocolState();
      // No sideband capability
      const transport = createTransportApi(duplex, state);

      const chunks: Uint8Array[] = [];
      for await (const chunk of transport.readPack()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(2);
      expect(chunks[0]).toEqual(packData1);
      expect(chunks[1]).toEqual(packData2);
    });
  });

  describe("readPack (with sideband)", () => {
    it("should extract pack data from sideband channel 1", async () => {
      const textEncoder = new TextEncoder();

      // Create sideband packet with pack data
      const channel1 = new Uint8Array([0x01]);
      const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b]); // "PACK"
      const payload = concat(channel1, packData);
      const lengthPrefix = textEncoder.encode(`${(payload.length + 4).toString(16).padStart(4, "0")}`);
      const pkt = concat(lengthPrefix, payload);

      // End with flush
      const flush = encodeFlush();
      const fullData = concat(pkt, flush);

      const duplex = createMockDuplex([fullData]);
      const state = new ProtocolState();
      state.capabilities.add("side-band-64k");
      const transport = createTransportApi(duplex, state);

      const chunks: Uint8Array[] = [];
      for await (const chunk of transport.readPack()) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBe(1);
      expect(chunks[0]).toEqual(packData);
    });

    it("should ignore progress on channel 2", async () => {
      const textEncoder = new TextEncoder();

      // Progress packet
      const channel2 = new Uint8Array([0x02]);
      const progressData = textEncoder.encode("Counting objects: 10");
      const progressPayload = concat(channel2, progressData);
      const progressLen = textEncoder.encode(`${(progressPayload.length + 4).toString(16).padStart(4, "0")}`);
      const progressPkt = concat(progressLen, progressPayload);

      // Data packet
      const channel1 = new Uint8Array([0x01]);
      const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b]);
      const dataPayload = concat(channel1, packData);
      const dataLen = textEncoder.encode(`${(dataPayload.length + 4).toString(16).padStart(4, "0")}`);
      const dataPkt = concat(dataLen, dataPayload);

      const flush = encodeFlush();
      const fullData = concat(progressPkt, dataPkt, flush);

      const duplex = createMockDuplex([fullData]);
      const state = new ProtocolState();
      state.capabilities.add("side-band-64k");
      const transport = createTransportApi(duplex, state);

      const chunks: Uint8Array[] = [];
      for await (const chunk of transport.readPack()) {
        chunks.push(chunk);
      }

      // Should only get data chunk, progress ignored
      expect(chunks.length).toBe(1);
      expect(chunks[0]).toEqual(packData);
    });

    it("should throw on error channel 3", async () => {
      const textEncoder = new TextEncoder();

      // Error packet
      const channel3 = new Uint8Array([0x03]);
      const errorData = textEncoder.encode("fatal: repository not found");
      const errorPayload = concat(channel3, errorData);
      const errorLen = textEncoder.encode(`${(errorPayload.length + 4).toString(16).padStart(4, "0")}`);
      const errorPkt = concat(errorLen, errorPayload);

      const duplex = createMockDuplex([errorPkt]);
      const state = new ProtocolState();
      state.capabilities.add("side-band-64k");
      const transport = createTransportApi(duplex, state);

      const iterator = transport.readPack();
      await expect(iterator.next()).rejects.toThrow("repository not found");
    });
  });

  describe("writePack (without sideband)", () => {
    it("should write raw pack data when no sideband capability", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const packData = [
        new Uint8Array([0x50, 0x41, 0x43, 0x4b]),
        new Uint8Array([0x00, 0x00, 0x00, 0x02]),
      ];

      await transport.writePack((async function* () {
        for (const chunk of packData) {
          yield chunk;
        }
      })());

      // Should write raw data
      expect(duplex.output.length).toBe(2);
      expect(duplex.output[0]).toEqual(packData[0]);
      expect(duplex.output[1]).toEqual(packData[1]);
    });
  });

  describe("writePack (with sideband)", () => {
    it("should wrap pack data in sideband channel 1", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      state.capabilities.add("side-band-64k");
      const transport = createTransportApi(duplex, state);

      const packData = new Uint8Array([0x50, 0x41, 0x43, 0x4b]);

      await transport.writePack((async function* () {
        yield packData;
      })());

      // Should write sideband packet + flush
      expect(duplex.output.length).toBe(2);
      // First packet should have channel byte
      expect(duplex.output[0][4]).toBe(0x01);
      // Second should be flush
      expect(new TextDecoder().decode(duplex.output[1])).toBe("0000");
    });

    it("should write multiple chunks as separate sideband packets", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      state.capabilities.add("side-band-64k");
      const transport = createTransportApi(duplex, state);

      const chunk1 = new Uint8Array([0x01, 0x02]);
      const chunk2 = new Uint8Array([0x03, 0x04]);

      await transport.writePack((async function* () {
        yield chunk1;
        yield chunk2;
      })());

      // Should write 2 sideband packets + 1 flush
      expect(duplex.output.length).toBe(3);
    });
  });
});

describe("ProtocolState Capability Handling", () => {
  it("should check hasCapability correctly", () => {
    const state = new ProtocolState();

    expect(state.hasCapability("side-band-64k")).toBe(false);

    state.capabilities.add("side-band-64k");
    expect(state.hasCapability("side-band-64k")).toBe(true);
  });

  it("should support multiple capabilities", () => {
    const state = new ProtocolState();

    state.capabilities.add("multi_ack_detailed");
    state.capabilities.add("side-band-64k");
    state.capabilities.add("thin-pack");

    expect(state.hasCapability("multi_ack_detailed")).toBe(true);
    expect(state.hasCapability("side-band-64k")).toBe(true);
    expect(state.hasCapability("thin-pack")).toBe(true);
    expect(state.hasCapability("include-tag")).toBe(false);
  });
});

describe("Transport Protocol Sequences", () => {
  describe("fetch negotiation simulation", () => {
    it("should handle typical fetch advertisement exchange", async () => {
      // Server sends ref advertisement
      const serverData = concat(
        encodePacketLine("abc123 HEAD\0multi_ack side-band-64k\n"),
        encodePacketLine("abc123 refs/heads/main\n"),
        encodeFlush(),
      );

      const duplex = createMockDuplex([serverData]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      // Read first line with capabilities
      const firstLine = await transport.readPktLine();
      expect(firstLine.type).toBe("data");
      if (firstLine.type === "data") {
        expect(firstLine.text).toContain("HEAD");
        expect(firstLine.text).toContain("multi_ack");
      }

      // Read second ref
      const secondLine = await transport.readPktLine();
      expect(secondLine.type).toBe("data");

      // Read flush
      const flush = await transport.readPktLine();
      expect(flush.type).toBe("flush");

      // Send want
      await transport.writeLine("want abc123 multi_ack side-band-64k");
      await transport.writeFlush();

      expect(duplex.output.length).toBe(2);
    });
  });

  describe("push negotiation simulation", () => {
    it("should handle typical push command exchange", async () => {
      const duplex = createMockDuplex([]);
      const state = new ProtocolState();
      const transport = createTransportApi(duplex, state);

      const zeroOid = "0".repeat(40);
      const newOid = "abc123".padEnd(40, "0");

      // Send update command
      await transport.writeLine(`${zeroOid} ${newOid} refs/heads/main\0report-status`);
      await transport.writeFlush();

      expect(duplex.output.length).toBe(2);

      const textDecoder = new TextDecoder();
      const command = textDecoder.decode(duplex.output[0]);
      expect(command).toContain(zeroOid);
      expect(command).toContain(newOid);
      expect(command).toContain("refs/heads/main");
    });
  });
});
