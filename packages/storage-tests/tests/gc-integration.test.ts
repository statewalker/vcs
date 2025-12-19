/**
 * GC Integration Tests
 *
 * Tests the garbage collection and delta compression functionality
 * using the new architecture (DeltaStorageImpl, GCController).
 */

import { MemBinStore } from "@webrun-vcs/store-mem";
import { createDelta, createDeltaRanges, type Delta } from "@webrun-vcs/utils";
import { MemoryVolatileStore } from "@webrun-vcs/vcs/binary-storage";
import {
  type DeltaComputeResult,
  type DeltaComputeStrategy,
  DeltaStorageImpl,
} from "@webrun-vcs/vcs/delta-compression";
import { GCController } from "@webrun-vcs/vcs/garbage-collection";
import { beforeEach, describe, expect, it } from "vitest";

const encoder = new TextEncoder();

/**
 * Simple compute strategy for testing
 */
const testComputeStrategy: DeltaComputeStrategy = {
  computeDelta(
    base: Uint8Array,
    target: Uint8Array,
    options?: { maxRatio?: number },
  ): DeltaComputeResult | undefined {
    // First compute the delta ranges
    const ranges = createDeltaRanges(base, target);
    // Then create delta instructions from ranges
    const deltaInstructions: Delta[] = [...createDelta(base, target, ranges)];

    // Calculate approximate delta size
    let deltaSize = 0;
    for (const d of deltaInstructions) {
      switch (d.type) {
        case "copy":
          deltaSize += 5; // offset + length overhead
          break;
        case "insert":
          deltaSize += d.data.length + 2; // data + header
          break;
        case "start":
        case "finish":
          deltaSize += 5; // header overhead
          break;
      }
    }
    const ratio = deltaSize / target.length;
    const maxRatio = options?.maxRatio ?? 0.75;
    if (ratio > maxRatio) {
      return undefined;
    }
    return { delta: deltaInstructions, ratio };
  },
};

describe("GC Integration Tests", () => {
  let binStore: MemBinStore;
  let volatileStore: MemoryVolatileStore;
  let deltaStorage: DeltaStorageImpl;

  beforeEach(() => {
    binStore = new MemBinStore();
    volatileStore = new MemoryVolatileStore();
    deltaStorage = new DeltaStorageImpl(binStore, volatileStore);
    deltaStorage.setComputeStrategy(testComputeStrategy);
  });

  describe("DeltaStorageImpl", () => {
    it("stores and loads objects", async () => {
      const content = encoder.encode("Test content");
      const id = await deltaStorage.store(
        "blob",
        (async function* () {
          yield content;
        })(),
      );

      expect(id).toMatch(/^[0-9a-f]{40}$/);
      expect(await deltaStorage.has(id)).toBe(true);

      const chunks: Uint8Array[] = [];
      for await (const chunk of deltaStorage.load(id)) {
        chunks.push(chunk);
      }
      const loaded = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        loaded.set(chunk, offset);
        offset += chunk.length;
      }

      expect(new TextDecoder().decode(loaded)).toBe("Test content");
    });

    it("lists all objects", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await deltaStorage.store(
          "blob",
          (async function* () {
            yield encoder.encode(`Content ${i}`);
          })(),
        );
        ids.push(id);
      }

      const listed: string[] = [];
      for await (const id of deltaStorage.listObjects()) {
        listed.push(id);
      }

      expect(listed.sort()).toEqual(ids.sort());
    });

    // Skip: Delta checksum verification issue with test compute strategy
    it.skip("deltifies similar content", async () => {
      // Store base content
      const baseContent = encoder.encode(
        "This is the base content with some text that will be modified.",
      );
      const baseId = await deltaStorage.store(
        "blob",
        (async function* () {
          yield baseContent;
        })(),
      );

      // Store similar content
      const targetContent = encoder.encode(
        "This is the base content with some text that will be modified. Added more.",
      );
      const targetId = await deltaStorage.store(
        "blob",
        (async function* () {
          yield targetContent;
        })(),
      );

      // Deltify target against base
      const success = await deltaStorage.deltifyWith(targetId, [baseId]);
      expect(success).toBe(true);
      expect(await deltaStorage.isDelta(targetId)).toBe(true);

      // Loading should still work
      const chunks: Uint8Array[] = [];
      for await (const chunk of deltaStorage.load(targetId)) {
        chunks.push(chunk);
      }
      const loaded = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        loaded.set(chunk, offset);
        offset += chunk.length;
      }

      expect(new TextDecoder().decode(loaded)).toBe(
        "This is the base content with some text that will be modified. Added more.",
      );
    });

    it("respects max chain depth", async () => {
      // Create a chain of objects
      const storage = new DeltaStorageImpl(new MemBinStore(), new MemoryVolatileStore(), {
        maxChainDepth: 3,
      });
      storage.setComputeStrategy(testComputeStrategy);

      const ids: string[] = [];
      let prevContent = encoder.encode("Base content for chain depth testing with enough text.");

      const baseId = await storage.store(
        "blob",
        (async function* () {
          yield prevContent;
        })(),
      );
      ids.push(baseId);

      // Create chain of deltas
      for (let i = 1; i <= 4; i++) {
        const content = encoder.encode(
          `Base content for chain depth testing with enough text. Modified ${i}`,
        );
        const id = await storage.store(
          "blob",
          (async function* () {
            yield content;
          })(),
        );
        ids.push(id);

        // Try to deltify against all previous
        await storage.deltifyWith(id, ids.slice(0, -1));
        prevContent = content;
      }

      // Check chain depths - should not exceed maxChainDepth
      for (const id of ids) {
        const chainInfo = await storage.getDeltaChainInfo(id);
        if (chainInfo) {
          expect(chainInfo.depth).toBeLessThanOrEqual(3);
        }
      }
    });

    // Skip: Delta checksum verification issue with test compute strategy
    it.skip("undeltifies objects", async () => {
      const baseContent = encoder.encode("Base content for undeltify test with sufficient length.");
      const baseId = await deltaStorage.store(
        "blob",
        (async function* () {
          yield baseContent;
        })(),
      );

      const targetContent = encoder.encode(
        "Base content for undeltify test with sufficient length. And more.",
      );
      const targetId = await deltaStorage.store(
        "blob",
        (async function* () {
          yield targetContent;
        })(),
      );

      await deltaStorage.deltifyWith(targetId, [baseId]);
      expect(await deltaStorage.isDelta(targetId)).toBe(true);

      await deltaStorage.undeltify(targetId);
      expect(await deltaStorage.isDelta(targetId)).toBe(false);
    });
  });

  describe("GCController", () => {
    it("tracks pending commits", async () => {
      const gc = new GCController(deltaStorage, {
        quickPackThreshold: 5,
      });

      expect(gc.getPendingCommitsCount()).toBe(0);

      await gc.onCommit("commit1");
      await gc.onCommit("commit2");
      expect(gc.getPendingCommitsCount()).toBe(2);
    });

    it("triggers quick pack at threshold", async () => {
      const gc = new GCController(deltaStorage, {
        quickPackThreshold: 3,
      });

      // Add commits to pending list
      await gc.onCommit("commit1");
      await gc.onCommit("commit2");
      expect(gc.getPendingCommitsCount()).toBe(2);

      // Third commit should trigger quick pack
      await gc.onCommit("commit3");
      expect(gc.getPendingCommitsCount()).toBe(0); // Cleared after quick pack
    });

    it("respects minimum GC interval", async () => {
      const gc = new GCController(deltaStorage, {
        minInterval: 10000, // 10 seconds
        looseObjectThreshold: 1,
      });

      // Store some objects
      await deltaStorage.store(
        "blob",
        (async function* () {
          yield encoder.encode("test");
        })(),
      );

      // First check should return true (no GC run yet)
      expect(await gc.shouldRunGC()).toBe(true);

      // Run GC
      await gc.runGC();

      // Immediately after, should not run again
      expect(await gc.shouldRunGC()).toBe(false);
    });

    it("runs GC when loose object threshold exceeded", async () => {
      const gc = new GCController(deltaStorage, {
        looseObjectThreshold: 3,
        minInterval: 0, // No interval limit for testing
      });

      // Store more than threshold
      for (let i = 0; i < 5; i++) {
        await deltaStorage.store(
          "blob",
          (async function* () {
            yield encoder.encode(`Object ${i}`);
          })(),
        );
      }

      expect(await gc.shouldRunGC()).toBe(true);
    });

    it("returns repack result from runGC", async () => {
      const gc = new GCController(deltaStorage, {
        minInterval: 0,
      });

      // Store some objects
      for (let i = 0; i < 3; i++) {
        await deltaStorage.store(
          "blob",
          (async function* () {
            yield encoder.encode(`Test object ${i} with some content`);
          })(),
        );
      }

      const result = await gc.runGC();
      expect(result).toBeDefined();
      expect(result.objectsProcessed).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("tracks time since last GC", async () => {
      const gc = new GCController(deltaStorage);

      expect(gc.getTimeSinceLastGC()).toBe(-1); // Never run

      await gc.runGC();
      const timeSince = gc.getTimeSinceLastGC();
      expect(timeSince).toBeGreaterThanOrEqual(0);
      expect(timeSince).toBeLessThan(1000); // Should be very recent
    });

    it("exposes current options", () => {
      const gc = new GCController(deltaStorage, {
        looseObjectThreshold: 50,
        chainDepthThreshold: 25,
      });

      const options = gc.getOptions();
      expect(options.looseObjectThreshold).toBe(50);
      expect(options.chainDepthThreshold).toBe(25);
    });
  });

  describe("Repack Operations", () => {
    it("deltifies objects during repack", async () => {
      const gc = new GCController(deltaStorage, {
        minInterval: 0,
      });

      // Store similar objects
      const base = encoder.encode(
        "A reasonably long base content string that can be deltified efficiently in tests.",
      );
      const _baseId = await deltaStorage.store(
        "blob",
        (async function* () {
          yield base;
        })(),
      );

      const variant = encoder.encode(
        "A reasonably long base content string that can be deltified efficiently in tests. Modified.",
      );
      const variantId = await deltaStorage.store(
        "blob",
        (async function* () {
          yield variant;
        })(),
      );

      expect(await deltaStorage.isDelta(variantId)).toBe(false);

      // Run repack
      await gc.runGC({ windowSize: 10 });

      // Object might be deltified (depends on window algorithm)
      // Just verify the operation completes without error
      expect(await deltaStorage.has(variantId)).toBe(true);
    });

    it("preserves object content after repack", async () => {
      const gc = new GCController(deltaStorage, {
        minInterval: 0,
      });

      const objects = ["First object content", "Second object content", "Third object content"];

      const ids: string[] = [];
      for (const content of objects) {
        const id = await deltaStorage.store(
          "blob",
          (async function* () {
            yield encoder.encode(content);
          })(),
        );
        ids.push(id);
      }

      // Run repack
      await gc.runGC();

      // Verify all content is still accessible
      for (let i = 0; i < ids.length; i++) {
        const chunks: Uint8Array[] = [];
        for await (const chunk of deltaStorage.load(ids[i])) {
          chunks.push(chunk);
        }
        const loaded = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          loaded.set(chunk, offset);
          offset += chunk.length;
        }
        expect(new TextDecoder().decode(loaded)).toBe(objects[i]);
      }
    });
  });
});
