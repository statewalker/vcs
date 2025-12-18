/**
 * Tests for SqlRawStorage
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlJsAdapter } from "../src/adapters/sql-js-adapter.js";
import type { DatabaseClient } from "../src/database-client.js";
import { SqlRawStorage } from "../src/sql-raw-storage.js";

describe("SqlRawStorage", () => {
  const encoder = new TextEncoder();
  let db: DatabaseClient;
  let storage: SqlRawStorage;

  beforeEach(async () => {
    db = await SqlJsAdapter.create();
    storage = new SqlRawStorage(db);
  });

  afterEach(async () => {
    await db.close();
  });

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
      await storage.store("key1", chunks("Hello World"));

      expect(await storage.has("key1")).toBe(true);
    });

    it("stores multiple items", async () => {
      await storage.store("a", chunks("Content A"));
      await storage.store("b", chunks("Content B"));
      await storage.store("c", chunks("Content C"));

      expect(await storage.has("a")).toBe(true);
      expect(await storage.has("b")).toBe(true);
      expect(await storage.has("c")).toBe(true);
    });

    it("overwrites existing content", async () => {
      await storage.store("key", chunks("Original"));
      await storage.store("key", chunks("Updated"));

      const loaded = await collect(storage.load("key"));
      expect(new TextDecoder().decode(loaded)).toBe("Updated");
    });

    it("handles empty content", async () => {
      await storage.store("empty", chunks());

      const loaded = await collect(storage.load("empty"));
      expect(loaded.length).toBe(0);
    });

    it("uses custom table name", async () => {
      const customStorage = new SqlRawStorage(db, "custom_objects");
      await customStorage.store("key", chunks("value"));

      expect(await customStorage.has("key")).toBe(true);

      // Original storage shouldn't see it
      expect(await storage.has("key")).toBe(false);
    });
  });

  describe("load", () => {
    it("loads stored content", async () => {
      await storage.store("key", chunks("Hello", " ", "World"));

      const loaded = await collect(storage.load("key"));
      expect(new TextDecoder().decode(loaded)).toBe("Hello World");
    });

    it("throws for non-existing key", async () => {
      await expect(async () => {
        await collect(storage.load("missing"));
      }).rejects.toThrow("Key not found");
    });

    it("loads binary content correctly", async () => {
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
      await storage.store("exists", chunks("content"));

      expect(await storage.has("exists")).toBe(true);
    });

    it("returns false for non-existing key", async () => {
      expect(await storage.has("missing")).toBe(false);
    });
  });

  describe("delete", () => {
    it("deletes existing key", async () => {
      await storage.store("key", chunks("content"));

      const deleted = await storage.delete("key");

      expect(deleted).toBe(true);
      expect(await storage.has("key")).toBe(false);
    });

    it("returns false for non-existing key", async () => {
      const deleted = await storage.delete("missing");

      expect(deleted).toBe(false);
    });
  });

  describe("keys", () => {
    it("lists all keys", async () => {
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
      const keys = await toArray(storage.keys());

      expect(keys).toHaveLength(0);
    });
  });
});
