/**
 * Parametrized test suite for ObjectStorage implementations
 *
 * This suite tests the core ObjectStorage interface contract.
 * All storage implementations must pass these tests.
 */

import type { ObjectStorage } from "@webrun-vcs/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  allBytesContent,
  collectContent,
  decode,
  encode,
  patternContent,
  toAsyncIterable,
  toAsyncIterableMulti,
} from "../test-utils.js";

/**
 * Context provided by the storage factory
 */
export interface ObjectStorageTestContext {
  storage: ObjectStorage;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a storage instance for testing
 */
export type ObjectStorageFactory = () => Promise<ObjectStorageTestContext>;

/**
 * Create the ObjectStorage test suite with a specific factory
 *
 * @param name Name of the storage implementation (e.g., "InMemory", "SQLite")
 * @param factory Factory function to create storage instances
 */
export function createObjectStorageTests(name: string, factory: ObjectStorageFactory): void {
  describe(`ObjectStorage [${name}]`, () => {
    let ctx: ObjectStorageTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Basic Operations", () => {
      it("stores and retrieves content", async () => {
        const content = encode("Hello, World!");
        const info = await ctx.storage.store(toAsyncIterable(content));

        expect(info).toBeDefined();
        expect(info.id).toBeDefined();
        expect(typeof info.id).toBe("string");
        expect(info.size).toBe(content.length);

        const retrieved = await collectContent(ctx.storage.load(info.id));
        expect(decode(retrieved)).toBe("Hello, World!");
      });

      it("returns consistent IDs for same content", async () => {
        const content = encode("Test content for deduplication");
        const info1 = await ctx.storage.store(toAsyncIterable(content));
        const info2 = await ctx.storage.store(toAsyncIterable(content));
        expect(info1.id).toBe(info2.id);
        expect(info1.size).toBe(info2.size);
      });

      it("returns different IDs for different content", async () => {
        const info1 = await ctx.storage.store(toAsyncIterable(encode("Content A")));
        const info2 = await ctx.storage.store(toAsyncIterable(encode("Content B")));
        expect(info1.id).not.toBe(info2.id);
      });

      it("checks existence via getInfo", async () => {
        const { id } = await ctx.storage.store(toAsyncIterable(encode("Test")));
        const info = await ctx.storage.getInfo(id);
        expect(info).not.toBeNull();
        expect(info?.id).toBe(id);
        expect(info?.size).toBe(4); // "Test" is 4 bytes

        const nonExistent = await ctx.storage.getInfo("nonexistent-id-that-does-not-exist");
        expect(nonExistent).toBeNull();
      });

      it("deletes objects", async () => {
        const { id } = await ctx.storage.store(toAsyncIterable(encode("Test")));
        expect(await ctx.storage.getInfo(id)).not.toBeNull();

        const deleted = await ctx.storage.delete(id);
        expect(deleted).toBe(true);
        expect(await ctx.storage.getInfo(id)).toBeNull();
      });

      it("returns false when deleting non-existent object", async () => {
        const deleted = await ctx.storage.delete("nonexistent-id-that-does-not-exist");
        expect(deleted).toBe(false);
      });
    });

    describe("Content Types", () => {
      it("handles empty content", async () => {
        const content = new Uint8Array(0);
        const { id, size } = await ctx.storage.store(toAsyncIterable(content));
        expect(size).toBe(0);
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved.length).toBe(0);
      });

      it("handles binary content with null bytes", async () => {
        const content = new Uint8Array([0, 1, 2, 0, 255, 0, 254]);
        const { id } = await ctx.storage.store(toAsyncIterable(content));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved).toEqual(content);
      });

      it("handles content with all byte values", async () => {
        const content = allBytesContent();
        const { id } = await ctx.storage.store(toAsyncIterable(content));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved).toEqual(content);
      });

      it("handles large content (1MB)", { timeout: 30000 }, async () => {
        const content = patternContent(1024 * 1024, 42);
        const { id, size } = await ctx.storage.store(toAsyncIterable(content));
        expect(size).toBe(content.length);
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved).toEqual(content);
      });
    });

    describe("Streaming", () => {
      it("accepts multi-chunk async input", async () => {
        const chunks = [encode("Hello, "), encode("World"), encode("!")];
        const { id } = await ctx.storage.store(toAsyncIterableMulti(chunks));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(decode(retrieved)).toBe("Hello, World!");
      });

      it("accepts sync iterable input (array)", async () => {
        const content = encode("Sync iterable test");
        const { id, size } = await ctx.storage.store([content]);
        expect(size).toBe(content.length);
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(decode(retrieved)).toBe("Sync iterable test");
      });

      it("accepts sync generator input", async () => {
        function* chunks() {
          yield encode("Chunk1");
          yield encode("Chunk2");
        }
        const { id } = await ctx.storage.store(chunks());
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(decode(retrieved)).toBe("Chunk1Chunk2");
      });

      it("yields content correctly regardless of chunking", async () => {
        const content = patternContent(100000, 65);
        const { id } = await ctx.storage.store(toAsyncIterable(content));

        const chunks: Uint8Array[] = [];
        for await (const chunk of ctx.storage.load(id)) {
          chunks.push(chunk);
        }

        // Concatenated result must match original
        let totalLength = 0;
        for (const chunk of chunks) {
          totalLength += chunk.length;
        }
        expect(totalLength).toBe(content.length);
      });
    });

    describe("Partial Reads", () => {
      it("reads from offset", async () => {
        const content = encode("Hello, World!");
        const { id } = await ctx.storage.store([content]);

        const retrieved = await collectContent(ctx.storage.load(id, { offset: 7 }));
        expect(decode(retrieved)).toBe("World!");
      });

      it("reads with length limit", async () => {
        const content = encode("Hello, World!");
        const { id } = await ctx.storage.store([content]);

        const retrieved = await collectContent(ctx.storage.load(id, { length: 5 }));
        expect(decode(retrieved)).toBe("Hello");
      });

      it("reads with offset and length", async () => {
        const content = encode("Hello, World!");
        const { id } = await ctx.storage.store([content]);

        const retrieved = await collectContent(ctx.storage.load(id, { offset: 7, length: 5 }));
        expect(decode(retrieved)).toBe("World");
      });

      it("handles offset beyond content length", async () => {
        const content = encode("Hello");
        const { id } = await ctx.storage.store([content]);

        const retrieved = await collectContent(ctx.storage.load(id, { offset: 100 }));
        expect(retrieved.length).toBe(0);
      });

      it("handles length exceeding remaining content", async () => {
        const content = encode("Hello");
        const { id } = await ctx.storage.store([content]);

        const retrieved = await collectContent(ctx.storage.load(id, { offset: 3, length: 100 }));
        expect(decode(retrieved)).toBe("lo");
      });
    });

    describe("List Objects", () => {
      it("lists all stored objects with info", async () => {
        const content1 = encode("Content 1");
        const content2 = encode("Content 2");
        const content3 = encode("Content 3");

        const info1 = await ctx.storage.store([content1]);
        const info2 = await ctx.storage.store([content2]);
        const info3 = await ctx.storage.store([content3]);

        const listed: Array<{ id: string; size: number }> = [];
        for await (const info of ctx.storage.listObjects()) {
          listed.push(info);
        }

        expect(listed.length).toBe(3);

        const ids = listed.map((i) => i.id);
        expect(ids).toContain(info1.id);
        expect(ids).toContain(info2.id);
        expect(ids).toContain(info3.id);

        // Check sizes are correct
        const foundInfo1 = listed.find((i) => i.id === info1.id);
        expect(foundInfo1?.size).toBe(content1.length);
      });

      it("returns empty generator for empty storage", async () => {
        const listed: Array<{ id: string; size: number }> = [];
        for await (const info of ctx.storage.listObjects()) {
          listed.push(info);
        }
        expect(listed.length).toBe(0);
      });
    });

    describe("Error Handling", () => {
      it("throws on loading non-existent object", async () => {
        await expect(async () => {
          for await (const _ of ctx.storage.load("nonexistent-id-that-does-not-exist")) {
            // Should not reach here
          }
        }).rejects.toThrow();
      });

      it("handles concurrent stores of same content", async () => {
        const content = encode("Concurrent test content");
        const promises = Array(10)
          .fill(null)
          .map(() => ctx.storage.store(toAsyncIterable(content)));
        const infos = await Promise.all(promises);

        // All should return same ID
        const ids = infos.map((i) => i.id);
        expect(new Set(ids).size).toBe(1);
      });

      it("handles concurrent stores of different content", async () => {
        const promises = Array(10)
          .fill(null)
          .map((_, i) => ctx.storage.store(toAsyncIterable(encode(`Content ${i}`))));
        const infos = await Promise.all(promises);

        // All should be different
        const ids = infos.map((i) => i.id);
        expect(new Set(ids).size).toBe(10);
      });
    });
  });
}
