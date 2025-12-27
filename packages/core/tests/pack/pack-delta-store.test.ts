/**
 * Tests for PackDeltaStore
 *
 * Tests the native pack-based delta store implementation.
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import type { Delta } from "@webrun-vcs/utils";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PackDeltaStore } from "../../src/pack/pack-delta-store.js";

// Set up Node.js compression before tests
beforeAll(() => {
  setCompression(createNodeCompression());
});

/**
 * Create a simple delta for testing
 * This creates a delta that copies from base and adds some bytes
 */
function createSimpleDelta(baseSize: number, resultSize: number = baseSize): Delta[] {
  return [{ type: "copy", offset: 0, length: Math.min(baseSize, resultSize) }];
}

describe("PackDeltaStore", () => {
  let files: FilesApi;
  const basePath = "/repo/objects/pack";

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  describe("initialization", () => {
    it("initializes without errors", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();
      await store.close();
    });

    it("can be initialized multiple times", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();
      await store.initialize(); // Should be a no-op
      await store.close();
    });
  });

  describe("storeDelta", () => {
    it("stores delta and returns compressed size", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const delta = createSimpleDelta(100, 100);

      const size = await store.storeDelta({ baseKey, targetKey }, delta);
      expect(size).toBeGreaterThan(0);

      await store.close();
    });

    it("auto-flushes when threshold reached", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 2 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const target1 = "1111111111111111111111111111111111111111";
      const target2 = "2222222222222222222222222222222222222222";

      await store.storeDelta({ baseKey, targetKey: target1 }, createSimpleDelta(100));
      await store.storeDelta({ baseKey, targetKey: target2 }, createSimpleDelta(100));

      // Check that pack was created
      const stats = await store.getPackDirectory().getStats();
      expect(stats.packCount).toBe(1);

      await store.close();
    });
  });

  describe("isDelta", () => {
    it("returns true for stored deltas", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      expect(await store.isDelta(targetKey)).toBe(true);

      await store.close();
    });

    it("returns false for non-existent objects", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      expect(await store.isDelta("cccccccccccccccccccccccccccccccccccccccc")).toBe(false);

      await store.close();
    });
  });

  describe("reverse index", () => {
    it("builds reverse index from pack headers", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const target1 = "1111111111111111111111111111111111111111";
      const target2 = "2222222222222222222222222222222222222222";

      await store.storeDelta({ baseKey, targetKey: target1 }, createSimpleDelta(100));
      await store.storeDelta({ baseKey, targetKey: target2 }, createSimpleDelta(100));

      await store.buildReverseIndex();

      const dependents = await store.findDependents(baseKey);
      expect(dependents).toContain(target1);
      expect(dependents).toContain(target2);
      expect(dependents).toHaveLength(2);

      await store.close();
    });

    it("finds dependents without building reverse index (slower)", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      // Don't build reverse index - should still work via pack scan
      const dependents = await store.findDependents(baseKey);
      expect(dependents).toContain(targetKey);

      await store.close();
    });

    it("invalidates reverse index", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));
      await store.buildReverseIndex();

      expect(store.getReverseIndex()).not.toBeNull();

      store.invalidateReverseIndex();

      expect(store.getReverseIndex()).toBeNull();

      await store.close();
    });
  });

  describe("isBase", () => {
    it("returns true for objects with dependents", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      expect(await store.isBase(baseKey)).toBe(true);

      await store.close();
    });

    it("returns false for objects without dependents", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      // targetKey has no dependents
      expect(await store.isBase(targetKey)).toBe(false);

      await store.close();
    });
  });

  describe("listDeltas", () => {
    it("lists all delta relationships", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const target1 = "1111111111111111111111111111111111111111";
      const target2 = "2222222222222222222222222222222222222222";

      await store.storeDelta({ baseKey, targetKey: target1 }, createSimpleDelta(100));
      await store.storeDelta({ baseKey, targetKey: target2 }, createSimpleDelta(100));

      const deltas: Array<{ baseKey: string; targetKey: string }> = [];
      for await (const delta of store.listDeltas()) {
        deltas.push(delta);
      }

      expect(deltas).toHaveLength(2);
      expect(deltas.map((d) => d.targetKey)).toContain(target1);
      expect(deltas.map((d) => d.targetKey)).toContain(target2);

      await store.close();
    });
  });

  describe("removeDelta", () => {
    it("marks delta as removed", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));
      await store.buildReverseIndex();

      expect(await store.removeDelta(targetKey)).toBe(true);

      // Reverse index should be updated
      expect(store.getReverseIndex()?.isDelta(targetKey)).toBe(false);

      await store.close();
    });

    it("returns false for non-deltas", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      expect(await store.removeDelta("cccccccccccccccccccccccccccccccccccccccc")).toBe(false);

      await store.close();
    });
  });

  describe("flush and close", () => {
    it("flushes pending deltas to pack file", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 100 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      // Not flushed yet (threshold is 100)
      let stats = await store.getPackDirectory().getStats();
      expect(stats.packCount).toBe(0);

      // Manual flush
      await store.flush();

      stats = await store.getPackDirectory().getStats();
      expect(stats.packCount).toBe(1);

      await store.close();
    });

    it("close flushes and cleans up", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 100 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));
      await store.buildReverseIndex();

      await store.close();

      // Reverse index should be cleared
      expect(store.getReverseIndex()).toBeNull();
    });
  });

  describe("getPackDirectory", () => {
    it("returns the pack directory", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const packDir = store.getPackDirectory();
      expect(packDir).toBeDefined();

      await store.close();
    });
  });
});
