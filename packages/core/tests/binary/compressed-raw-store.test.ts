/**
 * Tests for CompressedRawStore
 */

import { collect, setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { CompressedRawStore } from "../../src/binary/raw-store.compressed.js";
import { MemoryRawStore } from "../../src/binary/raw-store.memory.js";

// Set up Node.js compression before tests
beforeAll(() => {
  setCompression(createNodeCompression());
});

describe("CompressedRawStore", () => {
  let innerStore: MemoryRawStore;
  let store: CompressedRawStore;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  beforeEach(() => {
    innerStore = new MemoryRawStore();
    store = new CompressedRawStore(innerStore);
  });

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  async function collectText(stream: AsyncIterable<Uint8Array>): Promise<string> {
    const bytes = await collect(stream);
    return decoder.decode(bytes);
  }

  describe("store and load", () => {
    it("stores and loads content correctly", async () => {
      await store.store("key1", chunks("Hello World"));

      const result = await collectText(store.load("key1"));
      expect(result).toBe("Hello World");
    });

    it("compresses content in underlying store", async () => {
      const content = "Hello World - this is some test content to compress";
      await store.store("key1", chunks(content));

      // Get raw compressed data from inner store
      const compressed = await collect(innerStore.load("key1"));
      const original = encoder.encode(content);

      // Compressed data should be different from original (proves compression happened)
      expect(compressed).not.toEqual(original);
    });

    it("handles large content", async () => {
      // Create large repetitive content (compresses well)
      const chunk = "AAAAAAAAAA".repeat(1000);
      await store.store("key1", chunks(chunk));

      const result = await collectText(store.load("key1"));
      expect(result).toBe(chunk);

      // Verify compression is effective
      const compressed = await collect(innerStore.load("key1"));
      const original = encoder.encode(chunk);
      expect(compressed.length).toBeLessThan(original.length * 0.5);
    });

    it("handles empty content", async () => {
      await store.store("key1", chunks());

      const result = await collectText(store.load("key1"));
      expect(result).toBe("");
    });

    it("handles binary content with null bytes", async () => {
      const binary = new Uint8Array([0, 1, 2, 0, 255, 0, 128, 0]);

      async function* binaryContent(): AsyncIterable<Uint8Array> {
        yield binary;
      }

      await store.store("key1", binaryContent());
      const result = await collect(store.load("key1"));

      expect(Array.from(result)).toEqual([0, 1, 2, 0, 255, 0, 128, 0]);
    });

    it("loads with offset", async () => {
      await store.store("key1", chunks("Hello World"));

      const result = await collectText(store.load("key1", { offset: 6 }));
      expect(result).toBe("World");
    });

    it("loads with length", async () => {
      await store.store("key1", chunks("Hello World"));

      const result = await collectText(store.load("key1", { length: 5 }));
      expect(result).toBe("Hello");
    });

    it("loads with offset and length", async () => {
      await store.store("key1", chunks("Hello World"));

      const result = await collectText(store.load("key1", { offset: 3, length: 5 }));
      expect(result).toBe("lo Wo");
    });
  });

  describe("has", () => {
    it("returns true for existing key", async () => {
      await store.store("key1", chunks("content"));
      expect(await store.has("key1")).toBe(true);
    });

    it("returns false for non-existent key", async () => {
      expect(await store.has("nonexistent")).toBe(false);
    });
  });

  describe("delete", () => {
    it("deletes content", async () => {
      await store.store("key1", chunks("content"));
      expect(await store.has("key1")).toBe(true);

      const deleted = await store.delete("key1");
      expect(deleted).toBe(true);
      expect(await store.has("key1")).toBe(false);
    });

    it("returns false for non-existent key", async () => {
      const deleted = await store.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("keys", () => {
    it("returns all keys", async () => {
      await store.store("key1", chunks("content1"));
      await store.store("key2", chunks("content2"));
      await store.store("key3", chunks("content3"));

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toHaveLength(3);
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys).toContain("key3");
    });
  });

  describe("size", () => {
    it("returns uncompressed size", async () => {
      const content = "Hello World";
      await store.store("key1", chunks(content));

      const size = await store.size("key1");
      expect(size).toBe(content.length);
    });

    it("returns -1 for non-existent key", async () => {
      const size = await store.size("nonexistent");
      expect(size).toBe(-1);
    });

    it("returns correct size for large content", async () => {
      const chunk = "AAAAAAAAAA".repeat(1000);
      await store.store("key1", chunks(chunk));

      const size = await store.size("key1");
      expect(size).toBe(chunk.length);
    });

    it("returns 0 for empty content", async () => {
      await store.store("key1", chunks());

      const size = await store.size("key1");
      expect(size).toBe(0);
    });

    it("returns correct size for multi-chunk content", async () => {
      await store.store("key1", chunks("Hello", " ", "World", "!"));

      const size = await store.size("key1");
      expect(size).toBe(12); // "Hello World!".length = 5+1+5+1
    });

    it("returns correct size for binary content", async () => {
      const binary = new Uint8Array([0, 1, 2, 0, 255, 0, 128, 0]);

      async function* binaryContent(): AsyncIterable<Uint8Array> {
        yield binary;
      }

      await store.store("key1", binaryContent());
      const size = await store.size("key1");

      expect(size).toBe(8);
    });

    it("returns correct size regardless of compression ratio", async () => {
      // Highly compressible content
      const repetitive = "A".repeat(1000);
      await store.store("key1", chunks(repetitive));

      // Random-like content (poor compression) - use ASCII only (32-126) to avoid multi-byte UTF-8
      const randomLike = Array.from({ length: 1000 }, (_, i) =>
        String.fromCharCode(32 + ((i * 7) % 95)),
      ).join("");
      await store.store("key2", chunks(randomLike));

      expect(await store.size("key1")).toBe(1000);
      expect(await store.size("key2")).toBe(1000);
    });
  });
  describe("raw mode", () => {
    it("uses raw deflate when specified", async () => {
      const rawStore = new CompressedRawStore(innerStore, { raw: true });

      await rawStore.store("key1", chunks("Hello World"));
      const result = await collectText(rawStore.load("key1"));

      expect(result).toBe("Hello World");
    });

    it("produces different output for raw vs zlib mode", async () => {
      const innerStore1 = new MemoryRawStore();
      const innerStore2 = new MemoryRawStore();
      const zlibStore = new CompressedRawStore(innerStore1, { raw: false });
      const rawStore = new CompressedRawStore(innerStore2, { raw: true });

      const content = "Test content for comparison";
      await zlibStore.store("key1", chunks(content));
      await rawStore.store("key1", chunks(content));

      const zlibCompressed = await collect(innerStore1.load("key1"));
      const rawCompressed = await collect(innerStore2.load("key1"));

      // Both should decompress to same content
      expect(await collectText(zlibStore.load("key1"))).toBe(content);
      expect(await collectText(rawStore.load("key1"))).toBe(content);

      // But compressed data should be different (zlib has header)
      expect(zlibCompressed).not.toEqual(rawCompressed);
    });
  });

  describe("multiple chunks", () => {
    it("handles multi-chunk content", async () => {
      await store.store("key1", chunks("Hello", " ", "World", "!"));

      const result = await collectText(store.load("key1"));
      expect(result).toBe("Hello World!");
    });

    it("preserves content with interleaved chunks", async () => {
      const chunks1 = new Uint8Array([1, 2, 3]);
      const chunks2 = new Uint8Array([4, 5, 6]);
      const chunks3 = new Uint8Array([7, 8, 9]);

      await store.store(
        "key1",
        (async function* () {
          yield chunks1;
          yield chunks2;
          yield chunks3;
        })(),
      );

      const result = await collect(store.load("key1"));
      expect(Array.from(result)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
});
