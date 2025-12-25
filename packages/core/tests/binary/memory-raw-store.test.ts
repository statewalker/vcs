/**
 * Tests for MemoryRawStore
 */

import { collect } from "@webrun-vcs/utils";
import { describe, expect, it } from "vitest";
import { MemoryRawStore } from "../../src/binary/impl/memory-raw-store.js";

describe("MemoryRawStore", () => {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  async function collectText(stream: AsyncIterable<Uint8Array>): Promise<string> {
    const bytes = await collect(stream);
    return decoder.decode(bytes);
  }

  describe("store", () => {
    it("stores content and returns byte count", async () => {
      const store = new MemoryRawStore();
      const size = await store.store("key1", chunks("Hello", " ", "World"));

      expect(size).toBe(11);
    });

    it("stores empty content", async () => {
      const store = new MemoryRawStore();
      const size = await store.store("key1", chunks());

      expect(size).toBe(0);
    });

    it("stores binary content", async () => {
      const store = new MemoryRawStore();
      const binaryData = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x42]);

      async function* binaryContent(): AsyncIterable<Uint8Array> {
        yield binaryData;
      }

      const size = await store.store("key1", binaryContent());
      expect(size).toBe(5);
    });

    it("replaces existing content", async () => {
      const store = new MemoryRawStore();

      await store.store("key1", chunks("original"));
      await store.store("key1", chunks("replaced"));

      const result = await collectText(store.load("key1"));
      expect(result).toBe("replaced");
    });

    it("handles multiple chunks correctly", async () => {
      const store = new MemoryRawStore();
      const size = await store.store("key1", chunks("a", "bb", "ccc", "dddd"));

      expect(size).toBe(10); // 1 + 2 + 3 + 4
    });

    it("stores large content", async () => {
      const store = new MemoryRawStore();
      const largeChunk = new Uint8Array(1024 * 1024).fill(42);

      async function* largeContent(): AsyncIterable<Uint8Array> {
        yield largeChunk;
      }

      const size = await store.store("key1", largeContent());
      expect(size).toBe(1024 * 1024);
    });

    it("accepts synchronous iterables", async () => {
      const store = new MemoryRawStore();
      const syncContent = [encoder.encode("sync"), encoder.encode(" content")];

      const size = await store.store("key1", syncContent);
      expect(size).toBe(12);

      const result = await collectText(store.load("key1"));
      expect(result).toBe("sync content");
    });
  });

  describe("load", () => {
    it("loads stored content", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Hello", " ", "World"));

      const result = await collectText(store.load("key1"));
      expect(result).toBe("Hello World");
    });

    it("throws for non-existent key", async () => {
      const store = new MemoryRawStore();

      await expect(collect(store.load("missing"))).rejects.toThrow("Key not found: missing");
    });

    it("preserves binary data", async () => {
      const store = new MemoryRawStore();
      const binaryData = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x42]);

      async function* binaryContent(): AsyncIterable<Uint8Array> {
        yield binaryData;
      }

      await store.store("key1", binaryContent());
      const result = await collect(store.load("key1"));

      expect(Array.from(result)).toEqual([0x00, 0x01, 0xff, 0xfe, 0x42]);
    });

    it("allows multiple loads", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Test"));

      const result1 = await collectText(store.load("key1"));
      const result2 = await collectText(store.load("key1"));
      const result3 = await collectText(store.load("key1"));

      expect(result1).toBe("Test");
      expect(result2).toBe("Test");
      expect(result3).toBe("Test");
    });

    it("loads with offset", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Hello World"));

      const result = await collectText(store.load("key1", { offset: 6 }));
      expect(result).toBe("World");
    });

    it("loads with length", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Hello World"));

      const result = await collectText(store.load("key1", { length: 5 }));
      expect(result).toBe("Hello");
    });

    it("loads with offset and length", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Hello World"));

      const result = await collectText(store.load("key1", { offset: 3, length: 5 }));
      expect(result).toBe("lo Wo");
    });

    it("handles offset beyond content", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Short"));

      const result = await collectText(store.load("key1", { offset: 100 }));
      expect(result).toBe("");
    });

    it("handles length exceeding content", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Short"));

      const result = await collectText(store.load("key1", { length: 100 }));
      expect(result).toBe("Short");
    });

    it("handles multi-chunk slicing", async () => {
      const store = new MemoryRawStore();
      // Store in multiple chunks
      await store.store("key1", chunks("AB", "CD", "EF", "GH"));

      // Request slice that spans chunks
      const result = await collectText(store.load("key1", { offset: 1, length: 4 }));
      expect(result).toBe("BCDE");
    });
  });

  describe("has", () => {
    it("returns true for existing key", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("content"));

      expect(await store.has("key1")).toBe(true);
    });

    it("returns false for non-existent key", async () => {
      const store = new MemoryRawStore();

      expect(await store.has("missing")).toBe(false);
    });

    it("returns true for empty content", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks());

      expect(await store.has("key1")).toBe(true);
    });

    it("returns false after delete", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("content"));
      await store.delete("key1");

      expect(await store.has("key1")).toBe(false);
    });
  });

  describe("delete", () => {
    it("returns true when deleting existing key", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("content"));

      expect(await store.delete("key1")).toBe(true);
    });

    it("returns false when deleting non-existent key", async () => {
      const store = new MemoryRawStore();

      expect(await store.delete("missing")).toBe(false);
    });

    it("removes content after delete", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("content"));
      await store.delete("key1");

      await expect(collect(store.load("key1"))).rejects.toThrow();
    });

    it("does not affect other keys", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("content1"));
      await store.store("key2", chunks("content2"));

      await store.delete("key1");

      expect(await store.has("key2")).toBe(true);
      expect(await collectText(store.load("key2"))).toBe("content2");
    });
  });

  describe("keys", () => {
    it("returns empty iterator for empty store", async () => {
      const store = new MemoryRawStore();

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toEqual([]);
    });

    it("returns all stored keys", async () => {
      const store = new MemoryRawStore();
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

    it("does not include deleted keys", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("content1"));
      await store.store("key2", chunks("content2"));
      await store.delete("key1");

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toEqual(["key2"]);
    });
  });

  describe("size", () => {
    it("returns correct size for stored content", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Hello World"));

      const size = await store.size("key1");
      expect(size).toBe(11);
    });

    it("returns -1 for non-existent key", async () => {
      const store = new MemoryRawStore();

      const size = await store.size("missing");
      expect(size).toBe(-1);
    });

    it("returns 0 for empty content", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks());

      const size = await store.size("key1");
      expect(size).toBe(0);
    });

    it("returns correct size for multi-chunk content", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("a", "bb", "ccc"));

      const size = await store.size("key1");
      expect(size).toBe(6);
    });
  });

  describe("getData", () => {
    it("exposes internal data map", async () => {
      const store = new MemoryRawStore();
      await store.store("key1", chunks("Hello"));

      const data = store.getData();
      expect(data instanceof Map).toBe(true);
      expect(data.has("key1")).toBe(true);
    });

    it("returns same map instance", async () => {
      const store = new MemoryRawStore();

      const data1 = store.getData();
      const data2 = store.getData();

      expect(data1).toBe(data2);
    });
  });

  describe("multiple stores", () => {
    it("handles multiple independent keys", async () => {
      const store = new MemoryRawStore();

      await store.store("key1", chunks("First"));
      await store.store("key2", chunks("Second"));
      await store.store("key3", chunks("Third"));

      expect(await collectText(store.load("key1"))).toBe("First");
      expect(await collectText(store.load("key2"))).toBe("Second");
      expect(await collectText(store.load("key3"))).toBe("Third");
    });

    it("tracks sizes independently", async () => {
      const store = new MemoryRawStore();

      await store.store("key1", chunks("a"));
      await store.store("key2", chunks("bb"));
      await store.store("key3", chunks("ccc"));

      expect(await store.size("key1")).toBe(1);
      expect(await store.size("key2")).toBe(2);
      expect(await store.size("key3")).toBe(3);
    });
  });
});
