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
        const id = await ctx.storage.store(toAsyncIterable(content));

        expect(id).toBeDefined();
        expect(typeof id).toBe("string");

        const retrieved = await collectContent(ctx.storage.load(id));
        expect(decode(retrieved)).toBe("Hello, World!");
      });

      it("returns consistent IDs for same content", async () => {
        const content = encode("Test content for deduplication");
        const id1 = await ctx.storage.store(toAsyncIterable(content));
        const id2 = await ctx.storage.store(toAsyncIterable(content));
        expect(id1).toBe(id2);
      });

      it("returns different IDs for different content", async () => {
        const id1 = await ctx.storage.store(toAsyncIterable(encode("Content A")));
        const id2 = await ctx.storage.store(toAsyncIterable(encode("Content B")));
        expect(id1).not.toBe(id2);
      });

      it("checks existence correctly", async () => {
        const id = await ctx.storage.store(toAsyncIterable(encode("Test")));
        expect(await ctx.storage.has(id)).toBe(true);
        expect(await ctx.storage.has("nonexistent-id-that-does-not-exist")).toBe(false);
      });

      it("deletes objects", async () => {
        const id = await ctx.storage.store(toAsyncIterable(encode("Test")));
        expect(await ctx.storage.has(id)).toBe(true);

        const deleted = await ctx.storage.delete(id);
        expect(deleted).toBe(true);
        expect(await ctx.storage.has(id)).toBe(false);
      });

      it("returns false when deleting non-existent object", async () => {
        const deleted = await ctx.storage.delete("nonexistent-id-that-does-not-exist");
        expect(deleted).toBe(false);
      });
    });

    describe("Content Types", () => {
      it("handles empty content", async () => {
        const content = new Uint8Array(0);
        const id = await ctx.storage.store(toAsyncIterable(content));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved.length).toBe(0);
      });

      it("handles binary content with null bytes", async () => {
        const content = new Uint8Array([0, 1, 2, 0, 255, 0, 254]);
        const id = await ctx.storage.store(toAsyncIterable(content));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved).toEqual(content);
      });

      it("handles content with all byte values", async () => {
        const content = allBytesContent();
        const id = await ctx.storage.store(toAsyncIterable(content));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved).toEqual(content);
      });

      it("handles large content (1MB)", { timeout: 30000 }, async () => {
        const content = patternContent(1024 * 1024, 42);
        const id = await ctx.storage.store(toAsyncIterable(content));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(retrieved).toEqual(content);
      });
    });

    describe("Streaming", () => {
      it("accepts multi-chunk input", async () => {
        const chunks = [encode("Hello, "), encode("World"), encode("!")];
        const id = await ctx.storage.store(toAsyncIterableMulti(chunks));
        const retrieved = await collectContent(ctx.storage.load(id));
        expect(decode(retrieved)).toBe("Hello, World!");
      });

      it("yields content correctly regardless of chunking", async () => {
        const content = patternContent(100000, 65);
        const id = await ctx.storage.store(toAsyncIterable(content));

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
        const ids = await Promise.all(promises);

        // All should return same ID
        expect(new Set(ids).size).toBe(1);
      });

      it("handles concurrent stores of different content", async () => {
        const promises = Array(10)
          .fill(null)
          .map((_, i) => ctx.storage.store(toAsyncIterable(encode(`Content ${i}`))));
        const ids = await Promise.all(promises);

        // All should be different
        expect(new Set(ids).size).toBe(10);
      });
    });
  });
}
