/**
 * Tests for sideband multiplexing.
 * Ported from JGit's SideBandInputStreamTest.java and SideBandOutputStreamTest.java
 */

import { describe, expect, it } from "vitest";
import { ServerError } from "../src/protocol/errors.js";
import { pktLineReader } from "../src/protocol/pkt-line-codec.js";
import {
  demuxSideband,
  encodeSidebandPacket,
  SIDEBAND_DATA,
  SIDEBAND_ERROR,
  SIDEBAND_HDR_SIZE,
  SIDEBAND_MAX_BUF,
  SIDEBAND_PROGRESS,
  SIDEBAND_SMALL_BUF,
  SideBandOutputStream,
  SideBandProgressParser,
} from "../src/protocol/sideband.js";
import type { SidebandMessage } from "../src/protocol/types.js";

// Helper to create packet bytes with sideband channel
function packet(channel: number, data: string): Uint8Array {
  const dataBytes = new TextEncoder().encode(data);
  const length = dataBytes.length + 5; // 4 for length, 1 for channel
  const headerStr = length.toString(16).padStart(4, "0");
  const headerBytes = new TextEncoder().encode(headerStr);

  const result = new Uint8Array(length);
  result.set(headerBytes, 0);
  result[4] = channel;
  result.set(dataBytes, 5);
  return result;
}

// Helper to create flush packet
const flushPacket = new TextEncoder().encode("0000");

// Helper to concatenate Uint8Arrays
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// Helper to create stream from bytes
async function* bytesToStream(data: Uint8Array): AsyncGenerator<Uint8Array> {
  yield data;
}

// Helper to collect sideband messages
async function collectSideband(...packets: Uint8Array[]): Promise<SidebandMessage[]> {
  const allData = concatBytes(...packets, flushPacket);
  const pktStream = pktLineReader(bytesToStream(allData));
  const result: SidebandMessage[] = [];
  for await (const msg of demuxSideband(pktStream)) {
    result.push(msg);
  }
  return result;
}

describe("SideBandInputStream", () => {
  describe("progress messages", () => {
    it("should handle progress with single CR", async () => {
      const pkt = packet(SIDEBAND_PROGRESS, "message\r");
      const messages = await collectSideband(pkt);

      expect(messages).toHaveLength(1);
      expect(messages[0].channel).toBe(SIDEBAND_PROGRESS);
      expect(new TextDecoder().decode(messages[0].data)).toBe("message\r");
    });

    it("should handle progress with single LF", async () => {
      const pkt = packet(SIDEBAND_PROGRESS, "message\n");
      const messages = await collectSideband(pkt);

      expect(messages).toHaveLength(1);
      expect(new TextDecoder().decode(messages[0].data)).toBe("message\n");
    });

    it("should handle progress with CRLF", async () => {
      const pkt = packet(SIDEBAND_PROGRESS, "message\r\n");
      const messages = await collectSideband(pkt);

      expect(messages).toHaveLength(1);
      expect(new TextDecoder().decode(messages[0].data)).toBe("message\r\n");
    });

    it("should handle multiple progress messages", async () => {
      const pkt1 = packet(SIDEBAND_PROGRESS, "message   0%\r");
      const pkt2 = packet(SIDEBAND_PROGRESS, "message 100%\r");
      const messages = await collectSideband(pkt1, pkt2);

      expect(messages).toHaveLength(2);
      expect(new TextDecoder().decode(messages[0].data)).toBe("message   0%\r");
      expect(new TextDecoder().decode(messages[1].data)).toBe("message 100%\r");
    });

    it("should interleave data and progress", async () => {
      const pkt1 = packet(SIDEBAND_PROGRESS, "message   0%\r");
      const pkt2 = packet(SIDEBAND_DATA, "a");
      const pkt3 = packet(SIDEBAND_PROGRESS, "message 100%\n");
      const messages = await collectSideband(pkt1, pkt2, pkt3);

      expect(messages).toHaveLength(3);
      expect(messages[0].channel).toBe(SIDEBAND_PROGRESS);
      expect(messages[1].channel).toBe(SIDEBAND_DATA);
      expect(messages[2].channel).toBe(SIDEBAND_PROGRESS);
      expect(new TextDecoder().decode(messages[1].data)).toBe("a");
    });
  });

  describe("data channel", () => {
    it("should extract data from channel 1", async () => {
      const pkt = packet(SIDEBAND_DATA, "abc");
      const messages = await collectSideband(pkt);

      expect(messages).toHaveLength(1);
      expect(messages[0].channel).toBe(SIDEBAND_DATA);
      expect(new TextDecoder().decode(messages[0].data)).toBe("abc");
    });
  });

  describe("error channel", () => {
    it("should throw ServerError for channel 3", async () => {
      const pkt = packet(SIDEBAND_ERROR, "error message");
      await expect(collectSideband(pkt)).rejects.toThrow(ServerError);
      await expect(collectSideband(pkt)).rejects.toThrow("error message");
    });
  });
});

describe("SideBandOutputStream", () => {
  describe("write to CH_DATA", () => {
    it("should write data with correct prefix", () => {
      const out = new SideBandOutputStream({
        channel: SIDEBAND_DATA,
        maxBuf: SIDEBAND_SMALL_BUF,
      });
      out.write(new TextEncoder().encode("abc"));
      out.flush();

      const output = out.getOutput();
      expect(output).toHaveLength(1);
      expect(new TextDecoder().decode(output[0])).toBe("0008\x01abc");
    });
  });

  describe("write to CH_PROGRESS", () => {
    it("should write progress with correct prefix", () => {
      const out = new SideBandOutputStream({
        channel: SIDEBAND_PROGRESS,
        maxBuf: SIDEBAND_SMALL_BUF,
      });
      out.write(new TextEncoder().encode("abc"));
      out.flush();

      const output = out.getOutput();
      expect(output).toHaveLength(1);
      expect(new TextDecoder().decode(output[0])).toBe("0008\x02abc");
    });
  });

  describe("write to CH_ERROR", () => {
    it("should write error with correct prefix", () => {
      const out = new SideBandOutputStream({
        channel: SIDEBAND_ERROR,
        maxBuf: SIDEBAND_SMALL_BUF,
      });
      out.write(new TextEncoder().encode("abc"));
      out.flush();

      const output = out.getOutput();
      expect(output).toHaveLength(1);
      expect(new TextDecoder().decode(output[0])).toBe("0008\x03abc");
    });
  });

  describe("small writes", () => {
    it("should buffer small writes", () => {
      const out = new SideBandOutputStream({
        channel: SIDEBAND_DATA,
        maxBuf: SIDEBAND_SMALL_BUF,
      });
      out.writeByte(0x61); // 'a'
      out.writeByte(0x62); // 'b'
      out.writeByte(0x63); // 'c'
      out.flush();

      const output = out.getOutput();
      expect(output).toHaveLength(1);
      expect(new TextDecoder().decode(output[0])).toBe("0008\x01abc");
    });

    it("should split at buffer boundary", () => {
      const out = new SideBandOutputStream({
        channel: SIDEBAND_DATA,
        maxBuf: 6, // HDR_SIZE (5) + 1 byte data
      });
      out.writeByte(0x61); // 'a'
      out.writeByte(0x62); // 'b'
      out.writeByte(0x63); // 'c'
      out.flush();

      const output = out.getOutput();
      expect(output).toHaveLength(3);
      expect(new TextDecoder().decode(output[0])).toBe("0006\x01a");
      expect(new TextDecoder().decode(output[1])).toBe("0006\x01b");
      expect(new TextDecoder().decode(output[2])).toBe("0006\x01c");
    });
  });

  describe("large writes", () => {
    it("should write large buffers", () => {
      const buflen = SIDEBAND_MAX_BUF - SIDEBAND_HDR_SIZE;
      const buf = new Uint8Array(buflen);
      for (let i = 0; i < buf.length; i++) {
        buf[i] = i & 0xff;
      }

      const out = new SideBandOutputStream({
        channel: SIDEBAND_DATA,
        maxBuf: SIDEBAND_MAX_BUF,
      });
      out.write(buf);
      out.flush();

      const output = out.getOutput();
      expect(output).toHaveLength(1);
      expect(output[0].length).toBe(SIDEBAND_HDR_SIZE + buf.length);
      expect(output[0][4]).toBe(SIDEBAND_DATA);
    });
  });

  describe("constructor validation", () => {
    it("should reject invalid channel -1", () => {
      expect(() => new SideBandOutputStream({ channel: -1 })).toThrow(
        "channel -1 must be in range [1, 255]",
      );
    });

    it("should reject invalid channel 0", () => {
      expect(() => new SideBandOutputStream({ channel: 0 })).toThrow(
        "channel 0 must be in range [1, 255]",
      );
    });

    it("should reject invalid channel 256", () => {
      expect(() => new SideBandOutputStream({ channel: 256 })).toThrow(
        "channel 256 must be in range [1, 255]",
      );
    });

    it("should reject buffer size too small", () => {
      expect(() => new SideBandOutputStream({ channel: 1, maxBuf: 4 })).toThrow(
        "packet size 4 must be >= 5",
      );
    });

    it("should reject buffer size too large", () => {
      expect(() => new SideBandOutputStream({ channel: 1, maxBuf: SIDEBAND_MAX_BUF + 1 })).toThrow(
        `packet size ${SIDEBAND_MAX_BUF + 1} must be at most ${SIDEBAND_MAX_BUF}`,
      );
    });
  });
});

describe("encodeSidebandPacket", () => {
  it("should encode data packet", () => {
    const data = new TextEncoder().encode("hello");
    const result = encodeSidebandPacket(SIDEBAND_DATA, data);
    expect(new TextDecoder().decode(result)).toBe("000a\x01hello");
  });

  it("should reject invalid channel", () => {
    const data = new TextEncoder().encode("hello");
    expect(() => encodeSidebandPacket(0, data)).toThrow("channel 0 must be in range [1, 255]");
    expect(() => encodeSidebandPacket(256, data)).toThrow("channel 256 must be in range [1, 255]");
  });
});

describe("SideBandProgressParser", () => {
  it("should extract complete lines on CR", () => {
    const parser = new SideBandProgressParser();
    parser.feed(new TextEncoder().encode("message\r"));
    const messages = parser.getMessages();
    expect(messages).toEqual(["message\r"]);
  });

  it("should extract complete lines on LF", () => {
    const parser = new SideBandProgressParser();
    parser.feed(new TextEncoder().encode("message\n"));
    const messages = parser.getMessages();
    expect(messages).toEqual(["message\n"]);
  });

  it("should buffer partial messages", () => {
    const parser = new SideBandProgressParser();
    parser.feed(new TextEncoder().encode("partial"));
    expect(parser.getMessages()).toEqual([]);
    expect(parser.getPartial()).toBe("partial");
  });

  it("should drain partial on demand", () => {
    const parser = new SideBandProgressParser();
    parser.feed(new TextEncoder().encode("partial"));
    parser.drain();
    const messages = parser.getMessages();
    expect(messages).toEqual(["partial\n"]);
  });

  it("should handle multiple feeds", () => {
    const parser = new SideBandProgressParser();
    parser.feed(new TextEncoder().encode("line1\n"));
    parser.feed(new TextEncoder().encode("line2\r"));
    const messages = parser.getMessages();
    expect(messages).toEqual(["line1\n", "line2\r"]);
  });
});
