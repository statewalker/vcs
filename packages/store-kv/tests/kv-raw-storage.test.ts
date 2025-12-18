/**
 * Tests for KvRawStorage
 */

import { describe, expect, it } from "vitest";
import { MemoryKVAdapter } from "../src/adapters/memory-adapter.js";
import { KvRawStorage } from "../src/kv-raw-storage.js";

describe("KvRawStorage", () => {
  const encoder = new TextEncoder();

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  async function collect(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
    const result: Uint8Array[] = [];
    for await (const chunk of input) {
      result.push(chunk);
    }
    const totalLength = result.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of result) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return combined;
  }

  async function toArray<T>(input: AsyncIterable<T>): Promise<T[]> {
    const result: T[] = [];
    for await (const item of input) {
      result.push(item);
    }
    return result;
  }

  describe("store", () => {
    it("stores content under key", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("key1", chunks("Hello World"));

      expect(await storage.has("key1")).toBe(true);
    });

    it("stores multiple items", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("a", chunks("Content A"));
      await storage.store("b", chunks("Content B"));
      await storage.store("c", chunks("Content C"));

      expect(await storage.has("a")).toBe(true);
      expect(await storage.has("b")).toBe(true);
      expect(await storage.has("c")).toBe(true);
    });

    it("overwrites existing content", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("key", chunks("Original"));
      await storage.store("key", chunks("Updated"));

      const loaded = await collect(storage.load("key"));
      expect(new TextDecoder().decode(loaded)).toBe("Updated");
    });

    it("handles empty content", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("empty", chunks());

      const loaded = await collect(storage.load("empty"));
      expect(loaded.length).toBe(0);
    });

    it("uses custom prefix", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv, "custom/prefix/");
      await storage.store("key", chunks("value"));

      // Key should be stored with prefix
      expect(await kv.has("custom/prefix/key")).toBe(true);
      expect(await kv.has("objects/key")).toBe(false);
    });
  });

  describe("load", () => {
    it("loads stored content", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("key", chunks("Hello", " ", "World"));

      const loaded = await collect(storage.load("key"));
      expect(new TextDecoder().decode(loaded)).toBe("Hello World");
    });

    it("throws for non-existing key", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);

      await expect(async () => {
        await collect(storage.load("missing"));
      }).rejects.toThrow("Key not found");
    });

    it("loads binary content correctly", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      const binary = new Uint8Array([0, 1, 2, 255, 254, 253]);

      async function* binaryStream(): AsyncIterable<Uint8Array> {
        yield binary;
      }

      await storage.store("binary", binaryStream());
      const loaded = await collect(storage.load("binary"));

      expect(loaded).toEqual(binary);
    });
  });

  describe("has", () => {
    it("returns true for existing key", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("exists", chunks("content"));

      expect(await storage.has("exists")).toBe(true);
    });

    it("returns false for non-existing key", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);

      expect(await storage.has("missing")).toBe(false);
    });
  });

  describe("delete", () => {
    it("deletes existing key", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("key", chunks("content"));

      const deleted = await storage.delete("key");

      expect(deleted).toBe(true);
      expect(await storage.has("key")).toBe(false);
    });

    it("returns false for non-existing key", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);

      const deleted = await storage.delete("missing");

      expect(deleted).toBe(false);
    });
  });

  describe("keys", () => {
    it("lists all keys", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);
      await storage.store("a", chunks("A"));
      await storage.store("b", chunks("B"));
      await storage.store("c", chunks("C"));

      const keys = await toArray(storage.keys());

      expect(keys).toHaveLength(3);
      expect(keys).toContain("a");
      expect(keys).toContain("b");
      expect(keys).toContain("c");
    });

    it("returns empty for empty storage", async () => {
      const kv = new MemoryKVAdapter();
      const storage = new KvRawStorage(kv);

      const keys = await toArray(storage.keys());

      expect(keys).toHaveLength(0);
    });

    it("only lists keys with matching prefix", async () => {
      const kv = new MemoryKVAdapter();
      const storage1 = new KvRawStorage(kv, "prefix1/");
      const storage2 = new KvRawStorage(kv, "prefix2/");

      await storage1.store("a", chunks("A"));
      await storage2.store("b", chunks("B"));

      const keys1 = await toArray(storage1.keys());
      const keys2 = await toArray(storage2.keys());

      expect(keys1).toEqual(["a"]);
      expect(keys2).toEqual(["b"]);
    });
  });
});
