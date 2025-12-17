/**
 * Tests for StreamingGitObjectStore
 */

import { describe, expect, it } from "vitest";
import { collect, toArray } from "../../src/format/stream-utils.js";
import { MemoryTempStore } from "../../src/stores/memory-temp-store.js";
import { StreamingGitObjectStore } from "../../src/stores/streaming-git-object-store.js";
import { MemoryRawStorage } from "./memory-raw-storage.js";

describe("StreamingGitObjectStore", () => {
  const encoder = new TextEncoder();

  function createStore() {
    return new StreamingGitObjectStore(new MemoryTempStore(), new MemoryRawStorage());
  }

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  describe("store", () => {
    it("stores blob and returns object ID", async () => {
      const store = createStore();
      const id = await store.store("blob", chunks("Hello World"));

      expect(id).toHaveLength(40);
      expect(id).toMatch(/^[0-9a-f]+$/);
    });

    it("produces consistent hash for same content", async () => {
      const store = createStore();
      const id1 = await store.store("blob", chunks("Test"));
      const id2 = await store.store("blob", chunks("Test"));

      expect(id1).toBe(id2);
    });

    it("produces different hash for different content", async () => {
      const store = createStore();
      const id1 = await store.store("blob", chunks("Hello"));
      const id2 = await store.store("blob", chunks("World"));

      expect(id1).not.toBe(id2);
    });

    it("produces different hash for different types", async () => {
      const store = createStore();
      const blobId = await store.store("blob", chunks("content"));
      const commitId = await store.store("commit", chunks("content"));

      expect(blobId).not.toBe(commitId);
    });

    it("produces Git-compatible blob hash", async () => {
      const store = createStore();
      // "Hello World" blob hash is well-known
      const id = await store.store("blob", chunks("Hello World"));

      // Git: echo -n "Hello World" | git hash-object --stdin
      expect(id).toBe("5e1c309dae7f45e0f39b1bf3ac3cd9db12e7d689");
    });
  });

  describe("storeWithSize", () => {
    it("stores with known size", async () => {
      const store = createStore();
      const id = await store.storeWithSize("blob", 5, chunks("Hello"));

      expect(id).toHaveLength(40);
    });

    it("throws on size mismatch", async () => {
      const store = createStore();

      await expect(store.storeWithSize("blob", 10, chunks("Short"))).rejects.toThrow(
        "Size mismatch",
      );
    });

    it("produces same hash as store()", async () => {
      const store = createStore();
      const id1 = await store.store("blob", chunks("Test"));
      const id2 = await store.storeWithSize("blob", 4, chunks("Test"));

      expect(id1).toBe(id2);
    });
  });

  describe("load", () => {
    it("loads stored content", async () => {
      const store = createStore();
      const id = await store.store("blob", chunks("Hello World"));

      const content = await collect(store.load(id));
      const text = new TextDecoder().decode(content);

      expect(text).toBe("Hello World");
    });

    it("strips header from content", async () => {
      const store = createStore();
      const id = await store.store("blob", chunks("Test"));

      const content = await collect(store.load(id));
      const text = new TextDecoder().decode(content);

      // Should not contain header
      expect(text).toBe("Test");
      expect(text).not.toContain("blob ");
    });
  });

  describe("loadRaw", () => {
    it("loads raw content with header", async () => {
      const store = createStore();
      const id = await store.store("blob", chunks("Test"));

      const raw = await collect(store.loadRaw(id));
      const text = new TextDecoder().decode(raw);

      expect(text).toBe("blob 4\0Test");
    });
  });

  describe("getHeader", () => {
    it("returns correct type and size", async () => {
      const store = createStore();
      const id = await store.store("blob", chunks("Hello World"));

      const header = await store.getHeader(id);

      expect(header.type).toBe("blob");
      expect(header.size).toBe(11);
    });

    it("works for different types", async () => {
      const store = createStore();
      const blobId = await store.store("blob", chunks("content"));
      const commitId = await store.store("commit", chunks("content"));

      const blobHeader = await store.getHeader(blobId);
      const commitHeader = await store.getHeader(commitId);

      expect(blobHeader.type).toBe("blob");
      expect(commitHeader.type).toBe("commit");
    });
  });

  describe("has", () => {
    it("returns true for existing object", async () => {
      const store = createStore();
      const id = await store.store("blob", chunks("Test"));

      expect(await store.has(id)).toBe(true);
    });

    it("returns false for non-existing object", async () => {
      const store = createStore();
      const fakeId = "0".repeat(40);

      expect(await store.has(fakeId)).toBe(false);
    });
  });

  describe("delete", () => {
    it("deletes existing object", async () => {
      const store = createStore();
      const id = await store.store("blob", chunks("Test"));

      const deleted = await store.delete(id);

      expect(deleted).toBe(true);
      expect(await store.has(id)).toBe(false);
    });

    it("returns false for non-existing object", async () => {
      const store = createStore();
      const fakeId = "0".repeat(40);

      expect(await store.delete(fakeId)).toBe(false);
    });
  });

  describe("list", () => {
    it("lists all object IDs", async () => {
      const store = createStore();
      const id1 = await store.store("blob", chunks("One"));
      const id2 = await store.store("blob", chunks("Two"));
      const id3 = await store.store("blob", chunks("Three"));

      const ids = await toArray(store.list());

      expect(ids).toHaveLength(3);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toContain(id3);
    });

    it("returns empty for empty store", async () => {
      const store = createStore();
      const ids = await toArray(store.list());

      expect(ids).toHaveLength(0);
    });
  });

  describe("roundtrip", () => {
    it("roundtrips blob content", async () => {
      const store = createStore();
      const original = "Hello World!";
      const id = await store.store("blob", chunks(original));

      const loaded = await collect(store.load(id));
      const result = new TextDecoder().decode(loaded);

      expect(result).toBe(original);
    });

    it("roundtrips binary content", async () => {
      const store = createStore();
      const binary = new Uint8Array([0, 1, 2, 255, 254, 253]);

      async function* binaryStream(): AsyncIterable<Uint8Array> {
        yield binary;
      }

      const id = await store.store("blob", binaryStream());
      const loaded = await collect(store.load(id));

      expect(loaded).toEqual(binary);
    });

    it("roundtrips large content", async () => {
      const store = createStore();
      const large = new Uint8Array(100 * 1024).fill(42);

      async function* largeStream(): AsyncIterable<Uint8Array> {
        yield large;
      }

      const id = await store.store("blob", largeStream());
      const loaded = await collect(store.load(id));

      expect(loaded).toEqual(large);
    });
  });
});
