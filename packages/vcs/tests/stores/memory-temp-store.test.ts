/**
 * Tests for MemoryTempStore
 */

import { describe, expect, it } from "vitest";
import { MemoryTempStore } from "../../src/stores/memory-temp-store.js";
import { collect } from "../../src/format/stream-utils.js";

describe("MemoryTempStore", () => {
  const encoder = new TextEncoder();

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  describe("store", () => {
    it("stores content and reports correct size", async () => {
      const store = new MemoryTempStore();
      const content = await store.store(chunks("Hello", " ", "World"));

      expect(content.size).toBe(11);
    });

    it("stores empty content", async () => {
      const store = new MemoryTempStore();
      const content = await store.store(chunks());

      expect(content.size).toBe(0);
    });

    it("stores large content", async () => {
      const store = new MemoryTempStore();
      const largeChunk = new Uint8Array(1024 * 1024).fill(42);

      async function* largeContent(): AsyncIterable<Uint8Array> {
        yield largeChunk;
      }

      const content = await store.store(largeContent());
      expect(content.size).toBe(1024 * 1024);
    });
  });

  describe("read", () => {
    it("reads stored content back", async () => {
      const store = new MemoryTempStore();
      const content = await store.store(chunks("Hello", " ", "World"));

      const result = await collect(content.read());
      const text = new TextDecoder().decode(result);

      expect(text).toBe("Hello World");
    });

    it("allows multiple reads", async () => {
      const store = new MemoryTempStore();
      const content = await store.store(chunks("Test"));

      const read1 = await collect(content.read());
      const read2 = await collect(content.read());

      expect(new TextDecoder().decode(read1)).toBe("Test");
      expect(new TextDecoder().decode(read2)).toBe("Test");
    });

    it("throws after dispose", async () => {
      const store = new MemoryTempStore();
      const content = await store.store(chunks("Test"));

      await content.dispose();

      expect(() => content.read()).toThrow("TempContent already disposed");
    });
  });

  describe("dispose", () => {
    it("can be called multiple times", async () => {
      const store = new MemoryTempStore();
      const content = await store.store(chunks("Test"));

      await content.dispose();
      await content.dispose(); // Should not throw
    });
  });
});
