/**
 * Parametrized test suite for DeltaObjectStorage implementations
 *
 * This suite tests delta compression functionality.
 * Storage implementations that support deltification must pass these tests.
 */

import type { DeltaObjectStorage } from "@webrun-vcs/storage";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectContent, decode, encode, toAsyncIterable } from "../test-utils.js";

/**
 * Context provided by the storage factory
 */
export interface DeltaObjectStorageTestContext {
  storage: DeltaObjectStorage;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a delta storage instance for testing
 */
export type DeltaObjectStorageFactory = () => Promise<DeltaObjectStorageTestContext>;

/**
 * Create the DeltaObjectStorage test suite with a specific factory
 *
 * @param name Name of the storage implementation
 * @param factory Factory function to create storage instances
 */
export function createDeltaObjectStorageTests(
  name: string,
  factory: DeltaObjectStorageFactory,
): void {
  describe(`DeltaObjectStorage [${name}]`, () => {
    let ctx: DeltaObjectStorageTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Delta Compression", () => {
      it("deltifies similar content", async () => {
        const base = encode(
          "Line 1 with enough content to exceed minimum\nLine 2 content\nLine 3 content\n",
        );
        const modified = encode(
          "Line 1 with enough content to exceed minimum\nLine 2 modified\nLine 3 content\n",
        );

        const baseId = await ctx.storage.store(toAsyncIterable(base));
        const modifiedId = await ctx.storage.store(toAsyncIterable(modified));

        const deltified = await ctx.storage.deltify(modifiedId, [baseId]);
        expect(deltified).toBe(true);

        // Content should still be retrievable
        const retrieved = await collectContent(ctx.storage.load(modifiedId));
        expect(retrieved).toEqual(modified);
      });

      it("rejects deltification of small content", async () => {
        const base = encode("Small");
        const modified = encode("Tiny");

        const baseId = await ctx.storage.store(toAsyncIterable(base));
        const modifiedId = await ctx.storage.store(toAsyncIterable(modified));

        const deltified = await ctx.storage.deltify(modifiedId, [baseId]);
        expect(deltified).toBe(false);
      });

      it("rejects poor compression ratio", async () => {
        const base = new Uint8Array(1000);
        base.fill(1);
        const modified = new Uint8Array(1000);
        modified.fill(2);

        const baseId = await ctx.storage.store(toAsyncIterable(base));
        const modifiedId = await ctx.storage.store(toAsyncIterable(modified));

        const deltified = await ctx.storage.deltify(modifiedId, [baseId]);
        expect(deltified).toBe(false);
      });

      it("undeltifies back to full storage", async () => {
        const base = encode(
          "This is a longer base content that exceeds the 50 byte minimum for deltification",
        );
        const modified = encode(
          "This is a longer modified content that exceeds the 50 byte minimum for deltification",
        );

        const baseId = await ctx.storage.store(toAsyncIterable(base));
        const modifiedId = await ctx.storage.store(toAsyncIterable(modified));

        await ctx.storage.deltify(modifiedId, [baseId]);
        await ctx.storage.undeltify(modifiedId);

        const retrieved = await collectContent(ctx.storage.load(modifiedId));
        expect(retrieved).toEqual(modified);
      });
    });

    describe("Cycle Prevention", () => {
      it("prevents direct cycles", async () => {
        const content = encode(
          "Content with enough text to meet the minimum size requirement for deltification",
        );

        const id = await ctx.storage.store(toAsyncIterable(content));

        // Try to deltify against itself
        const deltified = await ctx.storage.deltify(id, [id]);
        expect(deltified).toBe(false);
      });

      it("prevents indirect cycles", async () => {
        const v1 = encode(
          "Version 1 with enough text to meet the minimum size requirement for deltification",
        );
        const v2 = encode(
          "Version 2 with enough text to meet the minimum size requirement for deltification",
        );

        const v1Id = await ctx.storage.store(toAsyncIterable(v1));
        const v2Id = await ctx.storage.store(toAsyncIterable(v2));

        // Create chain: v2 -> v1
        await ctx.storage.deltify(v2Id, [v1Id]);

        // Try to make v1 delta against v2 (would create cycle)
        const deltified = await ctx.storage.deltify(v1Id, [v2Id]);
        expect(deltified).toBe(false);
      });

      it("prevents deletion of objects with dependents", async () => {
        const base = encode(
          "Base content with enough text to meet the minimum size requirement for deltification",
        );
        const derived = encode(
          "Derived content with enough text to meet the minimum size requirement for deltification",
        );

        const baseId = await ctx.storage.store(toAsyncIterable(base));
        const derivedId = await ctx.storage.store(toAsyncIterable(derived));

        await ctx.storage.deltify(derivedId, [baseId]);

        // Try to delete base (should fail)
        await expect(ctx.storage.delete(baseId)).rejects.toThrow(/depend/i);
      });
    });

    describe("Delta Chain Reconstruction", () => {
      it("reconstructs from simple delta chain", async () => {
        const v1 = encode(
          "Version 1 with enough text to meet the minimum size requirement for deltification",
        );
        const v2 = encode(
          "Version 2 with enough text to meet the minimum size requirement for deltification",
        );
        const v3 = encode(
          "Version 3 with enough text to meet the minimum size requirement for deltification",
        );

        const v1Id = await ctx.storage.store(toAsyncIterable(v1));
        const v2Id = await ctx.storage.store(toAsyncIterable(v2));
        const v3Id = await ctx.storage.store(toAsyncIterable(v3));

        // Create chain: v3 -> v2 -> v1
        await ctx.storage.deltify(v2Id, [v1Id]);
        await ctx.storage.deltify(v3Id, [v2Id]);

        // Verify v3 loads correctly
        const retrieved = await collectContent(ctx.storage.load(v3Id));
        expect(decode(retrieved)).toBe(decode(v3));
      });

      it("reconstructs from deep delta chain", async () => {
        const versions: Uint8Array[] = [];
        const versionIds: string[] = [];

        // Create 10 versions
        for (let i = 1; i <= 10; i++) {
          const content = encode(
            `Version ${i} with enough text to meet the minimum size requirement`,
          );
          versions.push(content);
          const id = await ctx.storage.store(toAsyncIterable(content));
          versionIds.push(id);
        }

        // Create delta chain
        for (let i = 1; i < versionIds.length; i++) {
          await ctx.storage.deltify(versionIds[i], [versionIds[i - 1]]);
        }

        // Verify each version loads correctly
        for (let i = 0; i < versionIds.length; i++) {
          const retrieved = await collectContent(ctx.storage.load(versionIds[i]));
          expect(retrieved).toEqual(versions[i]);
        }
      });
    });

    describe("Advanced Delta Operations", () => {
      it("deltifies against previous version", async () => {
        const v1 = encode(
          "Version 1 content with enough text to exceed the minimum size requirement",
        );
        const v2 = encode(
          "Version 2 content with enough text to exceed the minimum size requirement",
        );

        const v1Id = await ctx.storage.store(toAsyncIterable(v1));
        const v2Id = await ctx.storage.store(toAsyncIterable(v2));

        const deltified = await ctx.storage.deltifyAgainstPrevious(v2Id, v1Id);
        expect(deltified).toBe(true);
      });

      it("chooses best delta from multiple candidates", async () => {
        const target = encode(
          "Target content with enough text to exceed the minimum size requirement for deltification",
        );
        const similar = encode(
          "Target content with enough text to exceed the minimum size requirement for compression",
        );
        const different = encode(
          "Completely different content that has nothing in common with the target text at all",
        );

        const targetId = await ctx.storage.store(toAsyncIterable(target));
        const similarId = await ctx.storage.store(toAsyncIterable(similar));
        const differentId = await ctx.storage.store(toAsyncIterable(different));

        const deltified = await ctx.storage.deltifyAgainstBest(targetId, {
          similarFiles: [similarId, differentId],
        });

        expect(deltified).toBe(true);
      });
    });
  });
}
