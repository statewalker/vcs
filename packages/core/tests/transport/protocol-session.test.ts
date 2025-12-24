/**
 * Tests for Git protocol session management.
 * Tests native Git protocol communication patterns.
 */

import { describe, expect, it } from "vitest";
import {
  BufferedOutputStream,
  createBidirectionalStream,
  createInputStreamFromAsyncIterable,
  createInputStreamFromBytes,
  createOutputStreamFromWritable,
} from "../../src/transport/streams/git-stream.js";
import {
  ClientProtocolSession,
  ServerProtocolSession,
} from "../../src/transport/streams/protocol-session.js";

// Helper to create string from bytes
function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Helper to create bytes from string
function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper to create pkt-line format
function pktLine(data: string): Uint8Array {
  const len = (data.length + 4).toString(16).padStart(4, "0");
  return stringToBytes(len + data);
}

// Helper to create async iterable from chunks
async function* chunksToAsyncIterable(chunks: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("ServerProtocolSession", () => {
  describe("readHeader", () => {
    it("should parse git-upload-pack header", async () => {
      const headerPacket = "git-upload-pack /repo.git\0host=example.com\0";
      const inputData = pktLine(headerPacket);

      const input = createInputStreamFromBytes(inputData);
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      const header = await session.readHeader();

      expect(header.service).toBe("git-upload-pack");
      expect(header.path).toBe("/repo.git");
      expect(header.host).toBe("example.com");
    });

    it("should parse git-receive-pack header", async () => {
      const headerPacket = "git-receive-pack /repo.git\0host=example.com\0";
      const inputData = pktLine(headerPacket);

      const input = createInputStreamFromBytes(inputData);
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-receive-pack",
      });

      const header = await session.readHeader();

      expect(header.service).toBe("git-receive-pack");
      expect(header.path).toBe("/repo.git");
      expect(header.host).toBe("example.com");
    });

    it("should parse protocol version from header", async () => {
      const headerPacket = "git-upload-pack /repo.git\0host=example.com\0version=2\0";
      const inputData = pktLine(headerPacket);

      const input = createInputStreamFromBytes(inputData);
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      const header = await session.readHeader();

      expect(header.extraParams).toContain("version=2");
      expect(session.getState().version).toBe("2");
    });

    it("should handle header without host", async () => {
      const headerPacket = "git-upload-pack /repo.git\0";
      const inputData = pktLine(headerPacket);

      const input = createInputStreamFromBytes(inputData);
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      const header = await session.readHeader();

      expect(header.service).toBe("git-upload-pack");
      expect(header.path).toBe("/repo.git");
      expect(header.host).toBeUndefined();
    });

    it("should throw on invalid service", async () => {
      const headerPacket = "invalid-service /repo.git\0";
      const inputData = pktLine(headerPacket);

      const input = createInputStreamFromBytes(inputData);
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      await expect(session.readHeader()).rejects.toThrow("Unknown service");
    });

    it("should throw on flush packet as header", async () => {
      const inputData = stringToBytes("0000"); // flush packet

      const input = createInputStreamFromBytes(inputData);
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      await expect(session.readHeader()).rejects.toThrow("flush packet");
    });
  });

  describe("writePacket", () => {
    it("should write correctly formatted packet", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      await session.writePacket("test data\n");

      const data = output.getData();
      const str = bytesToString(data);

      // Should have 4-byte length header + data
      // "test data\n" is 10 bytes + 4 length bytes = 14 = 0x0e
      expect(str.substring(0, 4)).toBe("000e");
      expect(str.substring(4)).toBe("test data\n");
    });
  });

  describe("writeFlush", () => {
    it("should write flush packet", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      await session.writeFlush();

      const data = output.getData();
      expect(bytesToString(data)).toBe("0000");
    });
  });

  describe("getState", () => {
    it("should return current state", () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
        protocolVersion: "2",
      });

      const state = session.getState();

      expect(state.version).toBe("2");
      expect(state.active).toBe(true);
      expect(state.serverCapabilities.size).toBe(0);
    });
  });

  describe("close", () => {
    it("should mark session as inactive", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ServerProtocolSession(stream, {
        service: "git-upload-pack",
      });

      expect(session.getState().active).toBe(true);
      await session.close();
      expect(session.getState().active).toBe(false);
    });
  });
});

describe("ClientProtocolSession", () => {
  describe("sendHeader", () => {
    it("should send correctly formatted header", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-upload-pack",
      });

      await session.sendHeader("/repo.git", "example.com");

      const data = output.getData();
      const str = bytesToString(data);

      // Parse length
      const len = parseInt(str.substring(0, 4), 16);
      expect(len).toBeGreaterThan(4);

      // Parse content
      const content = str.substring(4);
      expect(content).toContain("git-upload-pack /repo.git");
      expect(content).toContain("host=example.com");
    });

    it("should include protocol version in header", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-upload-pack",
        protocolVersion: "2",
      });

      await session.sendHeader("/repo.git", "example.com");

      const data = output.getData();
      const str = bytesToString(data);

      expect(str).toContain("version=2");
    });

    it("should not include version for v0", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-upload-pack",
        protocolVersion: "0",
      });

      await session.sendHeader("/repo.git");

      const data = output.getData();
      const str = bytesToString(data);

      expect(str).not.toContain("version=");
    });

    it("should handle receive-pack service", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-receive-pack",
      });

      await session.sendHeader("/repo.git");

      const data = output.getData();
      const str = bytesToString(data);

      expect(str).toContain("git-receive-pack /repo.git");
    });
  });

  describe("readRefAdvertisement", () => {
    it("should parse refs and capabilities", async () => {
      // Simulate server response with refs
      const chunks = [
        pktLine(`${"a".repeat(40)} HEAD\0multi_ack thin-pack side-band-64k ofs-delta\n`),
        pktLine(`${"b".repeat(40)} refs/heads/master\n`),
        pktLine(`${"c".repeat(40)} refs/heads/develop\n`),
        stringToBytes("0000"), // flush
      ];

      const input = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-upload-pack",
      });

      const result = await session.readRefAdvertisement();

      expect(result.refs.length).toBe(3);
      expect(result.refs[0].name).toBe("HEAD");
      expect(result.refs[0].objectId).toBe("a".repeat(40));
      expect(result.refs[1].name).toBe("refs/heads/master");
      expect(result.refs[2].name).toBe("refs/heads/develop");

      expect(result.capabilities.has("multi_ack")).toBe(true);
      expect(result.capabilities.has("thin-pack")).toBe(true);
      expect(result.capabilities.has("side-band-64k")).toBe(true);
      expect(result.capabilities.has("ofs-delta")).toBe(true);
    });

    it("should handle empty repository", async () => {
      // Empty repo has special format
      const chunks = [
        pktLine(`${"0".repeat(40)} capabilities^{}\0multi_ack side-band-64k\n`),
        stringToBytes("0000"), // flush
      ];

      const input = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-upload-pack",
      });

      const result = await session.readRefAdvertisement();

      expect(result.refs.length).toBe(1);
      expect(result.refs[0].objectId).toBe("0".repeat(40));
      expect(result.capabilities.has("multi_ack")).toBe(true);
    });

    it("should update session state with capabilities", async () => {
      const chunks = [pktLine(`${"a".repeat(40)} HEAD\0ofs-delta\n`), stringToBytes("0000")];

      const input = createInputStreamFromAsyncIterable(chunksToAsyncIterable(chunks));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-upload-pack",
      });

      await session.readRefAdvertisement();

      expect(session.getState().serverCapabilities.has("ofs-delta")).toBe(true);
    });
  });

  describe("writePacket and writeFlush", () => {
    it("should write packets correctly", async () => {
      const input = createInputStreamFromBytes(new Uint8Array(0));
      const output = new BufferedOutputStream();
      const stream = createBidirectionalStream(input, output);

      const session = new ClientProtocolSession(stream, {
        service: "git-upload-pack",
      });

      await session.writePacket(`want ${"a".repeat(40)}\n`);
      await session.writeFlush();
      await session.writePacket("done\n");

      const data = output.getData();
      const str = bytesToString(data);

      expect(str).toContain(`want ${"a".repeat(40)}`);
      expect(str).toContain("0000");
      expect(str).toContain("done");
    });
  });
});

describe("Protocol session integration", () => {
  it("should handle complete request-response cycle", async () => {
    // Create a mock channel to capture client output
    const clientToServer: Uint8Array[] = [];

    // Client setup - use simple bytes output
    const clientOutput = createOutputStreamFromWritable(async (data) => {
      clientToServer.push(data);
    });

    // Create client session and send header
    const clientInput = createInputStreamFromBytes(new Uint8Array(0));
    const clientStream = createBidirectionalStream(clientInput, clientOutput);
    const clientSession = new ClientProtocolSession(clientStream, {
      service: "git-upload-pack",
      protocolVersion: "2",
    });

    await clientSession.sendHeader("/repo.git", "localhost");

    // Verify client sent correct header
    expect(clientToServer.length).toBeGreaterThan(0);
    const sentData = bytesToString(clientToServer[0]);
    expect(sentData).toContain("git-upload-pack /repo.git");
    expect(sentData).toContain("host=localhost");
    expect(sentData).toContain("version=2");
  });

  it("should handle protocol v0 format", async () => {
    // Test traditional protocol v0 format
    const headerPacket = "git-upload-pack /project.git\0host=github.com\0";
    const inputData = pktLine(headerPacket);

    const input = createInputStreamFromBytes(inputData);
    const output = new BufferedOutputStream();
    const stream = createBidirectionalStream(input, output);

    const session = new ServerProtocolSession(stream, {
      service: "git-upload-pack",
      protocolVersion: "0",
    });

    const header = await session.readHeader();

    expect(header.service).toBe("git-upload-pack");
    expect(header.path).toBe("/project.git");
    expect(header.host).toBe("github.com");
    expect(session.getState().version).toBe("0");
  });
});
