/**
 * Parametrized test suite for RawStore implementations
 *
 * This suite tests the core RawStore interface contract.
 * All storage implementations must pass these tests.
 */

import type { RawStore } from "@statewalker/vcs-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Context provided by the storage factory
 */
export interface RawStoreTestContext {
  rawStore: RawStore;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a storage instance for testing
 */
export type RawStoreFactory = () => Promise<RawStoreTestContext>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Helper to collect async iterable of Uint8Array into single buffer
 */
async function collectBytes(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of input) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * Helper to collect async iterable to array
 */
async function toArray<T>(input: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of input) {
    result.push(item);
  }
  return result;
}

/**
 * Helper to create async iterable from Uint8Array
 */
async function* toStream(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

/**
 * Create the RawStore test suite with a specific factory
 *
 * @param name Name of the storage implementation (e.g., "Memory", "File")
 * @param factory Factory function to create storage instances
 */
export function createRawStoreTests(name: string, factory: RawStoreFactory): void {
  describe(`RawStore [${name}]`, () => {
    let ctx: RawStoreTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Basic Operations", () => {
      it("stores and loads content by key", async () => {
        const content = encoder.encode("Hello, World!");
        await ctx.rawStore.store("test-key", toStream(content));

        const loaded = await collectBytes(ctx.rawStore.load("test-key"));
        expect(decoder.decode(loaded)).toBe("Hello, World!");
      });

      it("store returns number of bytes stored", async () => {
        const content = encoder.encode("test content");
        const bytesStored = await ctx.rawStore.store("size-key", toStream(content));

        // May differ due to compression, but should be > 0
        expect(bytesStored).toBeGreaterThan(0);
      });

      it("overwrites existing content", async () => {
        const content1 = encoder.encode("original");
        const content2 = encoder.encode("replaced");

        await ctx.rawStore.store("overwrite-key", toStream(content1));
        await ctx.rawStore.store("overwrite-key", toStream(content2));

        const loaded = await collectBytes(ctx.rawStore.load("overwrite-key"));
        expect(decoder.decode(loaded)).toBe("replaced");
      });

      it("checks existence via has()", async () => {
        const content = encoder.encode("exists");
        await ctx.rawStore.store("exists-key", toStream(content));

        expect(await ctx.rawStore.has("exists-key")).toBe(true);
        expect(await ctx.rawStore.has("nonexistent-key")).toBe(false);
      });

      it("deletes content by key", async () => {
        const content = encoder.encode("to delete");
        await ctx.rawStore.store("delete-key", toStream(content));

        expect(await ctx.rawStore.has("delete-key")).toBe(true);

        const deleted = await ctx.rawStore.delete("delete-key");
        expect(deleted).toBe(true);
        expect(await ctx.rawStore.has("delete-key")).toBe(false);
      });

      it("returns false when deleting non-existent key", async () => {
        const deleted = await ctx.rawStore.delete("never-existed");
        expect(deleted).toBe(false);
      });

      it("lists all keys", async () => {
        await ctx.rawStore.store("key1", toStream(encoder.encode("content1")));
        await ctx.rawStore.store("key2", toStream(encoder.encode("content2")));
        await ctx.rawStore.store("key3", toStream(encoder.encode("content3")));

        const keys = await toArray(ctx.rawStore.keys());

        expect(keys).toContain("key1");
        expect(keys).toContain("key2");
        expect(keys).toContain("key3");
        expect(keys.length).toBe(3);
      });

      it("returns correct size for stored content", async () => {
        const content = encoder.encode("Hello, World!");
        await ctx.rawStore.store("size-test", toStream(content));

        const size = await ctx.rawStore.size("size-test");
        expect(size).toBe(content.length);
      });

      it("returns -1 for size of non-existent key", async () => {
        const size = await ctx.rawStore.size("nonexistent");
        expect(size).toBe(-1);
      });
    });

    describe("Partial Reads", () => {
      it("loads with offset", async () => {
        const content = encoder.encode("0123456789");
        await ctx.rawStore.store("offset-key", toStream(content));

        const loaded = await collectBytes(ctx.rawStore.load("offset-key", { offset: 5 }));
        expect(decoder.decode(loaded)).toBe("56789");
      });

      it("loads with length limit", async () => {
        const content = encoder.encode("0123456789");
        await ctx.rawStore.store("length-key", toStream(content));

        const loaded = await collectBytes(ctx.rawStore.load("length-key", { length: 5 }));
        expect(decoder.decode(loaded)).toBe("01234");
      });

      it("loads with offset and length", async () => {
        const content = encoder.encode("0123456789");
        await ctx.rawStore.store("range-key", toStream(content));

        const loaded = await collectBytes(ctx.rawStore.load("range-key", { offset: 3, length: 4 }));
        expect(decoder.decode(loaded)).toBe("3456");
      });

      it("handles offset at end of content", async () => {
        const content = encoder.encode("12345");
        await ctx.rawStore.store("end-offset", toStream(content));

        const loaded = await collectBytes(ctx.rawStore.load("end-offset", { offset: 5 }));
        expect(loaded.length).toBe(0);
      });

      it("handles length exceeding remaining content", async () => {
        const content = encoder.encode("12345");
        await ctx.rawStore.store("exceed-key", toStream(content));

        const loaded = await collectBytes(
          ctx.rawStore.load("exceed-key", { offset: 3, length: 100 }),
        );
        expect(decoder.decode(loaded)).toBe("45");
      });

      it("handles zero offset", async () => {
        const content = encoder.encode("content");
        await ctx.rawStore.store("zero-offset", toStream(content));

        const loaded = await collectBytes(ctx.rawStore.load("zero-offset", { offset: 0 }));
        expect(decoder.decode(loaded)).toBe("content");
      });
    });

    describe("Streaming", () => {
      it("stores from async iterable", async () => {
        async function* generateChunks(): AsyncIterable<Uint8Array> {
          yield encoder.encode("chunk1");
          yield encoder.encode("chunk2");
          yield encoder.encode("chunk3");
        }

        await ctx.rawStore.store("stream-key", generateChunks());
        const loaded = await collectBytes(ctx.rawStore.load("stream-key"));

        expect(decoder.decode(loaded)).toBe("chunk1chunk2chunk3");
      });

      it("stores from sync iterable", async () => {
        function* generateChunks(): Iterable<Uint8Array> {
          yield encoder.encode("sync1");
          yield encoder.encode("sync2");
        }

        await ctx.rawStore.store("sync-stream", generateChunks());
        const loaded = await collectBytes(ctx.rawStore.load("sync-stream"));

        expect(decoder.decode(loaded)).toBe("sync1sync2");
      });

      it.skipIf(process.env.CI)("handles large content via streaming", async () => {
        // 100KB content
        const largeContent = new Uint8Array(100 * 1024);
        for (let i = 0; i < largeContent.length; i++) {
          largeContent[i] = i % 256;
        }

        await ctx.rawStore.store("large-key", toStream(largeContent));

        const size = await ctx.rawStore.size("large-key");
        expect(size).toBe(largeContent.length);

        const loaded = await collectBytes(ctx.rawStore.load("large-key"));
        expect(loaded.length).toBe(largeContent.length);

        // Verify content integrity
        for (let i = 0; i < loaded.length; i++) {
          expect(loaded[i]).toBe(largeContent[i]);
        }
      });
    });

    describe("Binary Content", () => {
      it("preserves binary content exactly", async () => {
        const binaryContent = new Uint8Array(256);
        for (let i = 0; i < 256; i++) {
          binaryContent[i] = i;
        }

        await ctx.rawStore.store("binary-key", toStream(binaryContent));
        const loaded = await collectBytes(ctx.rawStore.load("binary-key"));

        expect(loaded.length).toBe(256);
        for (let i = 0; i < 256; i++) {
          expect(loaded[i]).toBe(i);
        }
      });

      it("handles null bytes in content", async () => {
        const contentWithNulls = new Uint8Array([0, 1, 0, 2, 0, 3]);
        await ctx.rawStore.store("nulls-key", toStream(contentWithNulls));

        const loaded = await collectBytes(ctx.rawStore.load("nulls-key"));
        expect(loaded).toEqual(contentWithNulls);
      });

      it("handles empty content", async () => {
        const emptyContent = new Uint8Array(0);
        await ctx.rawStore.store("empty-key", toStream(emptyContent));

        expect(await ctx.rawStore.has("empty-key")).toBe(true);
        expect(await ctx.rawStore.size("empty-key")).toBe(0);

        const loaded = await collectBytes(ctx.rawStore.load("empty-key"));
        expect(loaded.length).toBe(0);
      });
    });

    describe("Key Handling", () => {
      it("handles SHA-1 hash keys", async () => {
        const key = "b45ef6fec89518d314f546fd6c3025367b721684";
        await ctx.rawStore.store(key, toStream(encoder.encode("hash key content")));

        expect(await ctx.rawStore.has(key)).toBe(true);

        const loaded = await collectBytes(ctx.rawStore.load(key));
        expect(decoder.decode(loaded)).toBe("hash key content");
      });

      it("handles path-like keys", async () => {
        const key = "objects/ab/cdef123456";
        await ctx.rawStore.store(key, toStream(encoder.encode("path key")));

        expect(await ctx.rawStore.has(key)).toBe(true);
      });

      it("handles keys with special characters", async () => {
        const key = "key-with_special.chars";
        await ctx.rawStore.store(key, toStream(encoder.encode("special")));

        expect(await ctx.rawStore.has(key)).toBe(true);
      });
    });

    describe("Error Handling", () => {
      it("throws when loading non-existent key", async () => {
        await expect(async () => {
          for await (const _chunk of ctx.rawStore.load("nonexistent")) {
            // Should not reach here
          }
        }).rejects.toThrow();
      });
    });

    describe("Edge Cases", () => {
      it("handles empty keys listing", async () => {
        const keys = await toArray(ctx.rawStore.keys());
        expect(keys.length).toBe(0);
      });

      it("handles store/delete/store cycle", async () => {
        const content = encoder.encode("cycle content");

        await ctx.rawStore.store("cycle-key", toStream(content));
        expect(await ctx.rawStore.has("cycle-key")).toBe(true);

        await ctx.rawStore.delete("cycle-key");
        expect(await ctx.rawStore.has("cycle-key")).toBe(false);

        await ctx.rawStore.store("cycle-key", toStream(content));
        expect(await ctx.rawStore.has("cycle-key")).toBe(true);
      });

      it("handles multiple deletes of same key", async () => {
        await ctx.rawStore.store("multi-del", toStream(encoder.encode("x")));

        const deleted1 = await ctx.rawStore.delete("multi-del");
        expect(deleted1).toBe(true);

        const deleted2 = await ctx.rawStore.delete("multi-del");
        expect(deleted2).toBe(false);
      });
    });
  });
}
