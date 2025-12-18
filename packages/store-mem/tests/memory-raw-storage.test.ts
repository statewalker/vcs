/**
 * Tests for MemoryRawStorage
 */

import { describe, expect, it } from "vitest";
import { MemoryRawStorage } from "../src/memory-raw-storage.js";

describe("MemoryRawStorage", () => {
  const encoder = new TextEncoder();

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  async function collect(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of input) {
      chunks.push(chunk);
    }
    const result = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
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
      const storage = new MemoryRawStorage();
      await storage.store("key1", chunks("Hello World"));

      expect(await storage.has("key1")).toBe(true);
    });

    it("stores multiple items", async () => {
      const storage = new MemoryRawStorage();
      await storage.store("a", chunks("Content A"));
      await storage.store("b", chunks("Content B"));
      await storage.store("c", chunks("Content C"));

      expect(storage.size).toBe(3);
    });

    it("overwrites existing content", async () => {
      const storage = new MemoryRawStorage();
      await storage.store("key", chunks("Original"));
      await storage.store("key", chunks("Updated"));

      const loaded = await collect(storage.load("key"));
      expect(new TextDecoder().decode(loaded)).toBe("Updated");
    });

    it("handles empty content", async () => {
      const storage = new MemoryRawStorage();
      await storage.store("empty", chunks());

      const loaded = await collect(storage.load("empty"));
      expect(loaded.length).toBe(0);
    });
  });

  describe("load", () => {
    it("loads stored content", async () => {
      const storage = new MemoryRawStorage();
      await storage.store("key", chunks("Hello", " ", "World"));

      const loaded = await collect(storage.load("key"));
      expect(new TextDecoder().decode(loaded)).toBe("Hello World");
    });

    it("throws for non-existing key", async () => {
      const storage = new MemoryRawStorage();

      await expect(async () => {
        await collect(storage.load("missing"));
      }).rejects.toThrow("Key not found");
    });

    it("loads binary content correctly", async () => {
      const storage = new MemoryRawStorage();
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
      const storage = new MemoryRawStorage();
      await storage.store("exists", chunks("content"));

      expect(await storage.has("exists")).toBe(true);
    });

    it("returns false for non-existing key", async () => {
      const storage = new MemoryRawStorage();

      expect(await storage.has("missing")).toBe(false);
    });
  });

  describe("delete", () => {
    it("deletes existing key", async () => {
      const storage = new MemoryRawStorage();
      await storage.store("key", chunks("content"));

      const deleted = await storage.delete("key");

      expect(deleted).toBe(true);
      expect(await storage.has("key")).toBe(false);
    });

    it("returns false for non-existing key", async () => {
      const storage = new MemoryRawStorage();

      const deleted = await storage.delete("missing");

      expect(deleted).toBe(false);
    });
  });

  describe("keys", () => {
    it("lists all keys", async () => {
      const storage = new MemoryRawStorage();
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
      const storage = new MemoryRawStorage();

      const keys = await toArray(storage.keys());

      expect(keys).toHaveLength(0);
    });
  });

  describe("clear", () => {
    it("removes all items", async () => {
      const storage = new MemoryRawStorage();
      await storage.store("a", chunks("A"));
      await storage.store("b", chunks("B"));

      storage.clear();

      expect(storage.size).toBe(0);
      expect(await storage.has("a")).toBe(false);
      expect(await storage.has("b")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns number of items", async () => {
      const storage = new MemoryRawStorage();
      expect(storage.size).toBe(0);

      await storage.store("a", chunks("A"));
      expect(storage.size).toBe(1);

      await storage.store("b", chunks("B"));
      expect(storage.size).toBe(2);

      await storage.delete("a");
      expect(storage.size).toBe(1);
    });
  });
});
