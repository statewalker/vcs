/**
 * Tests for stream utilities
 */

import { describe, expect, it } from "vitest";
import {
  asAsyncIterable,
  collect,
  concat,
  decodeString,
  encodeLine,
  encodeString,
  isAsyncIterable,
  readLine,
  toArray,
} from "../../src/format/stream-utils.js";

describe("stream-utils", () => {
  describe("collect", () => {
    it("collects empty stream to empty array", async () => {
      async function* empty(): AsyncIterable<Uint8Array> {}
      const result = await collect(empty());
      expect(result).toEqual(new Uint8Array(0));
    });

    it("collects single chunk unchanged", async () => {
      const chunk = new Uint8Array([1, 2, 3]);
      async function* single(): AsyncIterable<Uint8Array> {
        yield chunk;
      }
      const result = await collect(single());
      expect(result).toEqual(chunk);
    });

    it("concatenates multiple chunks in order", async () => {
      async function* multi(): AsyncIterable<Uint8Array> {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array([3, 4]);
        yield new Uint8Array([5]);
      }
      const result = await collect(multi());
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it("handles large number of small chunks", async () => {
      async function* manySmall(): AsyncIterable<Uint8Array> {
        for (let i = 0; i < 1000; i++) {
          yield new Uint8Array([i & 0xff]);
        }
      }
      const result = await collect(manySmall());
      expect(result.length).toBe(1000);
    });
  });

  describe("isAsyncIterable", () => {
    it("returns true for async generator", () => {
      async function* gen(): AsyncIterable<number> {
        yield 1;
      }
      expect(isAsyncIterable(gen())).toBe(true);
    });

    it("returns false for sync array", () => {
      expect(isAsyncIterable([1, 2, 3])).toBe(false);
    });

    it("returns false for sync generator", () => {
      function* gen(): Generator<number> {
        yield 1;
      }
      expect(isAsyncIterable(gen())).toBe(false);
    });

    it("returns false for null", () => {
      expect(isAsyncIterable(null)).toBe(false);
    });

    it("returns false for primitives", () => {
      expect(isAsyncIterable(42)).toBe(false);
      expect(isAsyncIterable("string")).toBe(false);
      expect(isAsyncIterable(undefined)).toBe(false);
    });
  });

  describe("asAsyncIterable", () => {
    it("returns async iterable unchanged", async () => {
      async function* gen(): AsyncIterable<number> {
        yield 1;
        yield 2;
      }
      const input = gen();
      const result = asAsyncIterable(input);
      expect(result).toBe(input);
    });

    it("converts array to async iterable", async () => {
      const arr = [1, 2, 3];
      const result = asAsyncIterable(arr);
      const collected = await toArray(result);
      expect(collected).toEqual([1, 2, 3]);
    });

    it("converts sync generator to async iterable", async () => {
      function* gen(): Generator<number> {
        yield 10;
        yield 20;
      }
      const result = asAsyncIterable(gen());
      const collected = await toArray(result);
      expect(collected).toEqual([10, 20]);
    });
  });

  describe("toArray", () => {
    it("collects async iterable to array", async () => {
      async function* gen(): AsyncIterable<string> {
        yield "a";
        yield "b";
        yield "c";
      }
      const result = await toArray(gen());
      expect(result).toEqual(["a", "b", "c"]);
    });

    it("returns empty array for empty iterable", async () => {
      async function* empty(): AsyncIterable<number> {}
      const result = await toArray(empty());
      expect(result).toEqual([]);
    });
  });

  describe("concat", () => {
    it("concatenates two arrays", () => {
      const a = new Uint8Array([1, 2, 3]);
      const b = new Uint8Array([4, 5]);
      const result = concat(a, b);
      expect(result).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    });

    it("handles empty first array", () => {
      const a = new Uint8Array([]);
      const b = new Uint8Array([1, 2]);
      const result = concat(a, b);
      expect(result).toEqual(new Uint8Array([1, 2]));
    });

    it("handles empty second array", () => {
      const a = new Uint8Array([1, 2]);
      const b = new Uint8Array([]);
      const result = concat(a, b);
      expect(result).toEqual(new Uint8Array([1, 2]));
    });
  });

  describe("readLine", () => {
    it("reads line terminated by LF", () => {
      const data = new TextEncoder().encode("hello\nworld");
      const result = readLine(data, 0);
      expect(result).toEqual({ line: "hello", next: 6 });
    });

    it("reads line terminated by CRLF", () => {
      const data = new TextEncoder().encode("hello\r\nworld");
      const result = readLine(data, 0);
      expect(result).toEqual({ line: "hello", next: 7 });
    });

    it("returns null if no LF found", () => {
      const data = new TextEncoder().encode("no newline");
      const result = readLine(data, 0);
      expect(result).toBeNull();
    });

    it("reads from offset", () => {
      const data = new TextEncoder().encode("skip\nread\nmore");
      const result = readLine(data, 5);
      expect(result).toEqual({ line: "read", next: 10 });
    });

    it("handles empty line", () => {
      const data = new TextEncoder().encode("\n");
      const result = readLine(data, 0);
      expect(result).toEqual({ line: "", next: 1 });
    });
  });

  describe("encodeLine", () => {
    it("encodes text with LF terminator", () => {
      const result = encodeLine("hello");
      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe("hello\n");
    });

    it("handles empty string", () => {
      const result = encodeLine("");
      const decoded = new TextDecoder().decode(result);
      expect(decoded).toBe("\n");
    });
  });

  describe("encodeString/decodeString", () => {
    it("roundtrips ASCII text", () => {
      const text = "hello world";
      const encoded = encodeString(text);
      const decoded = decodeString(encoded);
      expect(decoded).toBe(text);
    });

    it("roundtrips UTF-8 text", () => {
      const text = "日本語 émoji 🎉";
      const encoded = encodeString(text);
      const decoded = decodeString(encoded);
      expect(decoded).toBe(text);
    });
  });
});
