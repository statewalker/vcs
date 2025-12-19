/**
 * Tests for MemoryVolatileStore
 */

import { describe, expect, it } from "vitest";
import { collect } from "../../../src/format/stream-utils.js";
import { MemoryVolatileStore } from "../../../src/binary-storage/volatile/memory-volatile-store.js";

describe("MemoryVolatileStore", () => {
  const encoder = new TextEncoder();

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  describe("store", () => {
    it("stores content and reports correct size", async () => {
      const store = new MemoryVolatileStore();
      const content = await store.store(chunks("Hello", " ", "World"));

      expect(content.size).toBe(11);
    });

    it("stores empty content", async () => {
      const store = new MemoryVolatileStore();
      const content = await store.store(chunks());

      expect(content.size).toBe(0);
    });

    it("stores large content", async () => {
      const store = new MemoryVolatileStore();
      const largeChunk = new Uint8Array(1024 * 1024).fill(42);

      async function* largeContent(): AsyncIterable<Uint8Array> {
        yield largeChunk;
      }

      const content = await store.store(largeContent());
      expect(content.size).toBe(1024 * 1024);
    });

    it("computes size correctly for multiple chunks", async () => {
      const store = new MemoryVolatileStore();
      const content = await store.store(chunks("a", "bb", "ccc", "dddd"));

      expect(content.size).toBe(10); // 1 + 2 + 3 + 4
    });
  });

  describe("read", () => {
    it("reads stored content back", async () => {
      const store = new MemoryVolatileStore();
      const content = await store.store(chunks("Hello", " ", "World"));

      const result = await collect(content.read());
      const text = new TextDecoder().decode(result);

      expect(text).toBe("Hello World");
    });

    it("allows multiple reads", async () => {
      const store = new MemoryVolatileStore();
      const content = await store.store(chunks("Test"));

      const read1 = await collect(content.read());
      const read2 = await collect(content.read());
      const read3 = await collect(content.read());

      expect(new TextDecoder().decode(read1)).toBe("Test");
      expect(new TextDecoder().decode(read2)).toBe("Test");
      expect(new TextDecoder().decode(read3)).toBe("Test");
    });

    it("preserves binary data", async () => {
      const store = new MemoryVolatileStore();
      const binaryData = new Uint8Array([0x00, 0x01, 0xff, 0xfe, 0x42]);

      async function* binaryContent(): AsyncIterable<Uint8Array> {
        yield binaryData;
      }

      const content = await store.store(binaryContent());
      const result = await collect(content.read());

      expect(Array.from(result)).toEqual([0x00, 0x01, 0xff, 0xfe, 0x42]);
    });

    it("throws after dispose", async () => {
      const store = new MemoryVolatileStore();
      const content = await store.store(chunks("Test"));

      await content.dispose();

      expect(() => content.read()).toThrow("VolatileContent already disposed");
    });
  });

  describe("dispose", () => {
    it("can be called multiple times", async () => {
      const store = new MemoryVolatileStore();
      const content = await store.store(chunks("Test"));

      await content.dispose();
      await content.dispose(); // Should not throw
    });

    it("releases memory on dispose", async () => {
      const store = new MemoryVolatileStore();
      const largeChunk = new Uint8Array(1024 * 1024).fill(42);

      async function* largeContent(): AsyncIterable<Uint8Array> {
        yield largeChunk;
      }

      const content = await store.store(largeContent());
      expect(content.size).toBe(1024 * 1024);

      await content.dispose();
      // After dispose, read() should throw
      expect(() => content.read()).toThrow();
    });
  });

  describe("multiple stores", () => {
    it("handles multiple independent stores", async () => {
      const store = new MemoryVolatileStore();

      const content1 = await store.store(chunks("First"));
      const content2 = await store.store(chunks("Second"));
      const content3 = await store.store(chunks("Third"));

      expect(content1.size).toBe(5);
      expect(content2.size).toBe(6);
      expect(content3.size).toBe(5);

      const text1 = new TextDecoder().decode(await collect(content1.read()));
      const text2 = new TextDecoder().decode(await collect(content2.read()));
      const text3 = new TextDecoder().decode(await collect(content3.read()));

      expect(text1).toBe("First");
      expect(text2).toBe("Second");
      expect(text3).toBe("Third");
    });

    it("disposing one does not affect others", async () => {
      const store = new MemoryVolatileStore();

      const content1 = await store.store(chunks("First"));
      const content2 = await store.store(chunks("Second"));

      await content1.dispose();

      // content2 should still work
      const text2 = new TextDecoder().decode(await collect(content2.read()));
      expect(text2).toBe("Second");

      // content1 should throw
      expect(() => content1.read()).toThrow();
    });
  });
});
