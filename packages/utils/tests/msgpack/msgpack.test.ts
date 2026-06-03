/**
 * MessagePack Tests
 *
 * Based on the original test cases from MessagePack-JS:
 * https://github.com/cuzic/MessagePack-JS
 */

import { describe, expect, it } from "vitest";
import { CharSet, Decoder, Encoder, pack, packToString, unpack } from "../../src/msgpack/index.js";

/**
 * Helper function to convert hex string to byte array
 */
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Helper function to convert byte array to hex string
 */
function _bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Helper function to create string from hex (for decoder tests)
 */
function hexToString(hex: string): string {
  let str = "";
  for (let i = 0; i < hex.length; i += 2) {
    str += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
  }
  return str;
}

describe("MessagePack", () => {
  describe("unpack (decoder)", () => {
    it("decodes positive fixnum", () => {
      const data = hexToString("00");
      const output = unpack(data);
      expect(output).toBe(0);
    });

    it("decodes negative fixnum", () => {
      const data = hexToString("ff");
      const output = unpack(data);
      expect(output).toBe(-1);
    });

    it("decodes uint8", () => {
      const data = hexToString("ccff");
      const output = unpack(data);
      expect(output).toBe(255);
    });

    it("decodes fixstr", () => {
      const data = hexToString("a161");
      const output = unpack(data);
      expect(output).toBe("a");
    });

    it("decodes fixarray", () => {
      const data = hexToString("9100");
      const output = unpack(data);
      expect(output).toEqual([0]);
    });

    it("decodes fixmap", () => {
      const data = hexToString("8100c0");
      const output = unpack(data);
      expect(output).toEqual({ "0": null });
    });

    it("decodes nil", () => {
      const data = hexToString("c0");
      const output = unpack(data);
      expect(output).toBe(null);
    });

    it("decodes true", () => {
      const data = hexToString("c3");
      const output = unpack(data);
      expect(output).toBe(true);
    });

    it("decodes false", () => {
      const data = hexToString("c2");
      const output = unpack(data);
      expect(output).toBe(false);
    });

    it("decodes double", () => {
      const data = hexToString("cb3fb999999999999a");
      const output = unpack(data);
      expect(output).toBeCloseTo(0.1, 15);
    });

    it("decodes uint16", () => {
      const data = hexToString("cd8000");
      const output = unpack(data);
      expect(output).toBe(32768);
    });

    it("decodes uint32", () => {
      const data = hexToString("ce00100000");
      const output = unpack(data);
      expect(output).toBe(1048576);
    });

    it("decodes uint64", () => {
      const data = hexToString("cf0000010000000000");
      const output = unpack(data);
      expect(output).toBe(1099511627776);
    });

    it("decodes int8", () => {
      const data = hexToString("d0c0");
      const output = unpack(data);
      expect(output).toBe(-64);
    });

    it("decodes int16", () => {
      const data = hexToString("d1fc00");
      const output = unpack(data);
      expect(output).toBe(-1024);
    });

    it("decodes int32", () => {
      const data = hexToString("d2fff00000");
      const output = unpack(data);
      expect(output).toBe(-1048576);
    });

    it("decodes int64", () => {
      const data = hexToString("d3ffffff0000000000");
      const output = unpack(data);
      expect(output).toBe(-1099511627776);
    });

    it("decodes str16 (40 spaces)", () => {
      const data = hexToString(
        "da002820202020202020202020202020202020202020202020202020202020202020202020202020202020",
      );
      const output = unpack(data);
      expect(output).toBe("                                        ");
    });

    it("decodes array16", () => {
      const data = hexToString("dc001000000000000000000000000000000000");
      const output = unpack(data);
      expect(output).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("decodes UTF-8 hiragana", () => {
      const data = hexToString("a6e38182e38184");
      const output = unpack(data);
      expect(output).toBe("\u3042\u3044"); // "あい"
    });

    it("decodes with Uint8Array input", () => {
      const data = hexToBytes("ccff");
      const output = unpack(data);
      expect(output).toBe(255);
    });
  });

  describe("pack (encoder)", () => {
    it("encodes positive fixnum", () => {
      const result = packToString(0);
      expect(result).toBe(hexToString("00"));
    });

    it("encodes negative fixnum", () => {
      const result = packToString(-1);
      expect(result).toBe(hexToString("ff"));
    });

    it("encodes uint8", () => {
      const result = packToString(255);
      expect(result).toBe(hexToString("ccff"));
    });

    it("encodes fixstr", () => {
      const result = packToString("a");
      expect(result).toBe(hexToString("a161"));
    });

    it("encodes fixarray", () => {
      const result = packToString([0]);
      expect(result).toBe(hexToString("9100"));
    });

    it("encodes fixmap", () => {
      const result = packToString({ a: 64 });
      expect(result).toBe(hexToString("81a16140"));
    });

    it("encodes nil", () => {
      const result = packToString(null);
      expect(result).toBe(hexToString("c0"));
    });

    it("encodes true", () => {
      const result = packToString(true);
      expect(result).toBe(hexToString("c3"));
    });

    it("encodes false", () => {
      const result = packToString(false);
      expect(result).toBe(hexToString("c2"));
    });

    it("encodes double", () => {
      const result = packToString(0.1);
      expect(result).toBe(hexToString("cb3fb999999999999a"));
    });

    it("encodes uint16", () => {
      const result = packToString(32768);
      expect(result).toBe(hexToString("cd8000"));
    });

    it("encodes uint32", () => {
      const result = packToString(1048576);
      expect(result).toBe(hexToString("ce00100000"));
    });

    it("encodes int8", () => {
      const result = packToString(-64);
      expect(result).toBe(hexToString("d0c0"));
    });

    it("encodes int16", () => {
      const result = packToString(-1024);
      expect(result).toBe(hexToString("d1fc00"));
    });

    it("encodes int32", () => {
      const result = packToString(-1048576);
      expect(result).toBe(hexToString("d2fff00000"));
    });

    it("encodes int64", () => {
      const result = packToString(-1099511627776);
      expect(result).toBe(hexToString("d3ffffff0000000000"));
    });

    it("encodes str8 (40 spaces)", () => {
      // Modern MessagePack uses str8 for strings 32-255 bytes (more efficient)
      // Original JS used str16 (0xda), but str8 (0xd9) is more compact
      const spaces = "                                        ";
      const result = packToString(spaces);
      // d9 = str8, 28 = length 40, then 40 space characters (0x20)
      expect(result).toBe(
        hexToString(
          "d92820202020202020202020202020202020202020202020202020202020202020202020202020202020",
        ),
      );
    });

    it("encodes array16", () => {
      const ary = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      const result = packToString(ary);
      expect(result).toBe(hexToString("dc001000000000000000000000000000000000"));
    });

    it("returns Uint8Array from pack()", () => {
      const result = pack(42);
      expect(result).toBeInstanceOf(Uint8Array);
      expect(result).toEqual(new Uint8Array([42]));
    });
  });

  describe("roundtrip", () => {
    it("roundtrips integers", () => {
      const values = [
        0, 1, 127, 128, 255, 256, 32767, 32768, 65535, 65536, 2147483647, -1, -32, -33, -128, -129,
        -32768, -32769, -2147483648,
      ];
      for (const value of values) {
        const packed = pack(value);
        const unpacked = unpack(packed);
        expect(unpacked).toBe(value);
      }
    });

    it("roundtrips floats", () => {
      const values = [0.1, 0.5, 1.5, -0.1, -0.5, Math.PI, Math.PI, Math.E];
      for (const value of values) {
        const packed = pack(value);
        const unpacked = unpack(packed);
        expect(unpacked).toBeCloseTo(value, 10);
      }
    });

    it("roundtrips strings", () => {
      const values = ["", "a", "hello", "hello world", "\u3042\u3044"];
      for (const value of values) {
        const packed = pack(value);
        const unpacked = unpack(packed);
        expect(unpacked).toBe(value);
      }
    });

    it("roundtrips arrays", () => {
      const values = [[], [1], [1, 2, 3], ["a", "b"], [1, "two", null, true]];
      for (const value of values) {
        const packed = pack(value);
        const unpacked = unpack(packed);
        expect(unpacked).toEqual(value);
      }
    });

    it("roundtrips objects", () => {
      const values = [{}, { a: 1 }, { a: 1, b: 2 }, { hello: "world" }, { nested: { deep: true } }];
      for (const value of values) {
        const packed = pack(value);
        const unpacked = unpack(packed);
        expect(unpacked).toEqual(value);
      }
    });

    it("roundtrips null", () => {
      const packed = pack(null);
      const unpacked = unpack(packed);
      expect(unpacked).toBe(null);
    });

    it("roundtrips booleans", () => {
      expect(unpack(pack(true))).toBe(true);
      expect(unpack(pack(false))).toBe(false);
    });

    it("roundtrips complex nested structures", () => {
      const value = {
        name: "test",
        count: 42,
        enabled: true,
        items: [1, 2, 3],
        nested: {
          deep: {
            value: "hello",
          },
        },
      };
      const packed = pack(value);
      const unpacked = unpack(packed);
      expect(unpacked).toEqual(value);
    });
  });

  describe("Decoder class", () => {
    it("supports charset option as string", () => {
      const data = hexToString("a161");
      const decoder = new Decoder(data, { charSet: "utf-8" });
      expect(decoder.unpack()).toBe("a");
    });

    it("supports charset option as enum", () => {
      const data = hexToString("a161");
      const decoder = new Decoder(data, { charSet: CharSet.UTF8 });
      expect(decoder.unpack()).toBe("a");
    });

    it("returns byte array with ByteArray charset", () => {
      const data = hexToString("a161");
      const decoder = new Decoder(data, { charSet: CharSet.ByteArray });
      expect(decoder.unpack()).toEqual([97]);
    });
  });

  describe("Encoder class", () => {
    it("creates reusable encoder", () => {
      const encoder = new Encoder();
      const result1 = encoder.pack(42);
      const result2 = encoder.pack("hello");
      expect(result1).toEqual(new Uint8Array([42]));
      expect(result2).toEqual(new Uint8Array([0xa5, 0x68, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it("supports packToString method", () => {
      const encoder = new Encoder();
      const result = encoder.packToString(42);
      expect(result).toBe("*"); // 42 = 0x2a = '*'
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const packed = pack("");
      const unpacked = unpack(packed);
      expect(unpacked).toBe("");
    });

    it("handles empty array", () => {
      const packed = pack([]);
      const unpacked = unpack(packed);
      expect(unpacked).toEqual([]);
    });

    it("handles empty object", () => {
      const packed = pack({});
      const unpacked = unpack(packed);
      expect(unpacked).toEqual({});
    });

    it("handles zero", () => {
      const packed = pack(0);
      const unpacked = unpack(packed);
      expect(unpacked).toBe(0);
    });

    it("handles negative zero as zero", () => {
      const packed = pack(-0);
      const unpacked = unpack(packed);
      expect(Object.is(unpacked, 0)).toBe(true);
    });

    it("handles large arrays", () => {
      const array = new Array(100).fill(0).map((_, i) => i);
      const packed = pack(array);
      const unpacked = unpack(packed);
      expect(unpacked).toEqual(array);
    });

    it("handles deeply nested structures", () => {
      const deep = { a: { b: { c: { d: { e: 1 } } } } };
      const packed = pack(deep);
      const unpacked = unpack(packed);
      expect(unpacked).toEqual(deep);
    });

    it("handles Unicode strings", () => {
      const strings = [
        "\u0000", // null character
        "\u00ff", // Latin-1
        "\u0100", // Latin Extended-A
        "\u3042\u3044\u3046", // Japanese hiragana
        "\u4e2d\u6587", // Chinese
        "\ud83d\ude00", // Emoji (surrogate pair)
      ];
      for (const str of strings) {
        const packed = pack(str);
        const unpacked = unpack(packed);
        expect(unpacked).toBe(str);
      }
    });
  });

  describe("format verification", () => {
    it("uses fixint for 0-127", () => {
      for (let i = 0; i <= 127; i++) {
        const packed = pack(i);
        expect(packed.length).toBe(1);
        expect(packed[0]).toBe(i);
      }
    });

    it("uses negative fixint for -32 to -1", () => {
      for (let i = -32; i <= -1; i++) {
        const packed = pack(i);
        expect(packed.length).toBe(1);
        expect(packed[0]).toBe(i + 256);
      }
    });

    it("uses fixstr for short strings", () => {
      const str = "hi";
      const packed = pack(str);
      expect(packed[0]).toBe(0xa0 + str.length); // fixstr prefix
    });

    it("uses fixarray for small arrays", () => {
      const arr = [1, 2, 3];
      const packed = pack(arr);
      expect(packed[0]).toBe(0x90 + arr.length); // fixarray prefix
    });

    it("uses fixmap for small objects", () => {
      const obj = { a: 1 };
      const packed = pack(obj);
      expect(packed[0]).toBe(0x80 + 1); // fixmap prefix with 1 pair
    });
  });
});
