/**
 * Tests for FileRawStore
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { collect } from "@webrun-vcs/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { FileRawStore } from "../../src/binary/raw-store.files.js";

describe("FileRawStore", () => {
  let files: FilesApi;
  let store: FileRawStore;
  const basePath = "/objects";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
    store = new FileRawStore(files, basePath);
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

  describe("store", () => {
    it("stores content and returns byte count", async () => {
      const size = await store.store("abcdef1234567890", chunks("Hello World"));
      expect(size).toBe(11);
    });

    it("creates proper directory structure", async () => {
      await store.store("abcdef1234567890", chunks("content"));

      // Check file exists at correct path
      const stats = await files.stats("/objects/ab/cdef1234567890");
      expect(stats).toBeDefined();
      expect(stats?.kind).toBe("file");
    });

    it("stores empty content", async () => {
      const size = await store.store("abcdef1234567890", chunks());
      expect(size).toBe(0);
    });

    it("replaces existing content", async () => {
      await store.store("abcdef1234567890", chunks("original"));
      await store.store("abcdef1234567890", chunks("replaced"));

      const result = await collectText(store.load("abcdef1234567890"));
      expect(result).toBe("replaced");
    });
  });

  describe("load", () => {
    it("loads stored content", async () => {
      await store.store("abcdef1234567890", chunks("Hello World"));

      const result = await collectText(store.load("abcdef1234567890"));
      expect(result).toBe("Hello World");
    });

    it("throws for non-existent key", async () => {
      await expect(collect(store.load("nonexistent12345"))).rejects.toThrow(
        "Key not found: nonexistent12345",
      );
    });

    it("preserves binary data", async () => {
      const binaryData = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x42]);

      async function* binaryContent(): AsyncIterable<Uint8Array> {
        yield binaryData;
      }

      await store.store("abcdef1234567890", binaryContent());
      const result = await collect(store.load("abcdef1234567890"));

      expect(Array.from(result)).toEqual([0x00, 0x01, 0xff, 0xfe, 0x42]);
    });
  });

  describe("has", () => {
    it("returns true for existing key", async () => {
      await store.store("abcdef1234567890", chunks("content"));
      expect(await store.has("abcdef1234567890")).toBe(true);
    });

    it("returns false for non-existent key", async () => {
      expect(await store.has("nonexistent12345")).toBe(false);
    });

    it("returns false after delete", async () => {
      await store.store("abcdef1234567890", chunks("content"));
      await store.delete("abcdef1234567890");
      expect(await store.has("abcdef1234567890")).toBe(false);
    });
  });

  describe("delete", () => {
    it("returns true when deleting existing key", async () => {
      await store.store("abcdef1234567890", chunks("content"));
      expect(await store.delete("abcdef1234567890")).toBe(true);
    });

    it("returns false when deleting non-existent key", async () => {
      expect(await store.delete("nonexistent12345")).toBe(false);
    });

    it("removes content after delete", async () => {
      await store.store("abcdef1234567890", chunks("content"));
      await store.delete("abcdef1234567890");

      await expect(collect(store.load("abcdef1234567890"))).rejects.toThrow();
    });
  });

  describe("keys", () => {
    it("returns empty iterator for empty store", async () => {
      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }
      expect(keys).toEqual([]);
    });

    it("returns all stored keys", async () => {
      await store.store("ab1234567890abcd", chunks("content1"));
      await store.store("cd5678901234abcd", chunks("content2"));
      await store.store("ef9012345678abcd", chunks("content3"));

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toHaveLength(3);
      expect(keys).toContain("ab1234567890abcd");
      expect(keys).toContain("cd5678901234abcd");
      expect(keys).toContain("ef9012345678abcd");
    });

    it("does not include deleted keys", async () => {
      await store.store("ab1234567890abcd", chunks("content1"));
      await store.store("cd5678901234abcd", chunks("content2"));
      await store.delete("ab1234567890abcd");

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toEqual(["cd5678901234abcd"]);
    });
  });

  describe("size", () => {
    it("returns correct size for stored content", async () => {
      await store.store("abcdef1234567890", chunks("Hello World"));
      const size = await store.size("abcdef1234567890");
      expect(size).toBe(11);
    });

    it("returns -1 for non-existent key", async () => {
      const size = await store.size("nonexistent12345");
      expect(size).toBe(-1);
    });

    it("returns 0 for empty content", async () => {
      await store.store("abcdef1234567890", chunks());
      const size = await store.size("abcdef1234567890");
      expect(size).toBe(0);
    });
  });

  describe("directory structure", () => {
    it("uses first two chars as prefix directory", async () => {
      await store.store("aa1111111111111111111111111111111111111", chunks("a"));
      await store.store("bb2222222222222222222222222222222222222", chunks("b"));

      // Check directory structure
      const aaStats = await files.stats("/objects/aa");
      const bbStats = await files.stats("/objects/bb");
      expect(aaStats?.kind).toBe("directory");
      expect(bbStats?.kind).toBe("directory");
    });

    it("stores multiple objects in same prefix directory", async () => {
      await store.store("aa1111111111111111111111111111111111111", chunks("a1"));
      await store.store("aa2222222222222222222222222222222222222", chunks("a2"));

      // Both should exist
      expect(await store.has("aa1111111111111111111111111111111111111")).toBe(true);
      expect(await store.has("aa2222222222222222222222222222222222222")).toBe(true);

      // Should be in same directory
      const entries: string[] = [];
      for await (const entry of files.list("/objects/aa")) {
        entries.push(entry.name);
      }
      expect(entries).toHaveLength(2);
    });
  });
});
