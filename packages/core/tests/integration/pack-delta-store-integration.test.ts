/**
 * Integration tests for PackDeltaStore
 *
 * Tests the complete integration of PackDeltaStore with
 * RawStoreWithDelta, GCController, and PackConsolidator.
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MemoryRawStore } from "../../src/binary/impl/memory-raw-store.js";
import { GCController } from "../../src/delta/gc-controller.js";
import { PackDeltaStore } from "../../src/delta/pack-delta-store.js";
import { RawStoreWithDelta } from "../../src/delta/raw-store-with-delta.js";
import { PackConsolidator } from "../../src/pack/pack-consolidator.js";

// Set up Node.js compression before tests
beforeAll(() => {
  setCompression(createNodeCompression());
});

describe("PackDeltaStore Integration", () => {
  let files: FilesApi;
  const basePath = "/repo/objects/pack";

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  describe("RawStoreWithDelta integration", () => {
    it("works with PackDeltaStore as delta backend", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await deltas.initialize();

      const store = new RawStoreWithDelta({
        objects,
        deltas,
      });

      const id1 = "a".repeat(40);
      const id2 = "b".repeat(40);
      const content1 = new TextEncoder().encode("Base content for testing");

      // Store base object in raw store
      await objects.store(
        id1,
        (async function* () {
          yield content1;
        })(),
      );

      // Store delta directly in PackDeltaStore
      await deltas.storeDelta({ baseKey: id1, targetKey: id2 }, [
        { type: "start", targetLen: 20 },
        { type: "copy", start: 0, len: 20 },
        { type: "finish", checksum: 0 },
      ]);

      // Verify has() works through RawStoreWithDelta
      expect(await store.has(id1)).toBe(true);
      expect(await store.has(id2)).toBe(true);

      // Verify isDelta() works
      expect(await store.isDelta(id1)).toBe(false);
      expect(await store.isDelta(id2)).toBe(true);

      await deltas.close();
    });

    it("lists deltas through storage interface", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 10 });
      await deltas.initialize();

      const store = new RawStoreWithDelta({
        objects,
        deltas,
      });

      // Store base object
      const baseId = "0".repeat(40);
      await objects.store(
        baseId,
        (async function* () {
          yield new TextEncoder().encode("Base");
        })(),
      );

      // Store multiple deltas
      for (let i = 1; i <= 3; i++) {
        await deltas.storeDelta({ baseKey: baseId, targetKey: `${i}`.repeat(40) }, [
          { type: "start", targetLen: 10 },
          { type: "copy", start: 0, len: 4 },
          { type: "finish", checksum: 0 },
        ]);
      }

      // List all keys through store
      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toContain(baseId);
      expect(keys).toContain("1".repeat(40));
      expect(keys).toContain("2".repeat(40));
      expect(keys).toContain("3".repeat(40));

      await deltas.close();
    });
  });

  describe("GCController integration", () => {
    it("works with PackConsolidator", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await deltas.initialize();

      const packDir = deltas.getPackDirectory();
      const consolidator = new PackConsolidator(packDir, files, basePath);

      const store = new RawStoreWithDelta({
        objects,
        deltas,
      });

      const gc = new GCController(store, {
        consolidator,
        looseObjectThreshold: 2,
        minInterval: 0,
      });

      // Create several objects to trigger multiple packs
      for (let i = 0; i < 5; i++) {
        const id = `${i}`.repeat(40);
        await objects.store(
          id,
          (async function* () {
            yield new TextEncoder().encode(`Content ${i}`);
          })(),
        );
      }

      // Run GC
      const result = await gc.runGC();
      expect(result).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);

      await deltas.close();
    });

    it("reports consolidation in repack result", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await deltas.initialize();

      const packDir = deltas.getPackDirectory();
      const consolidator = new PackConsolidator(packDir, files, basePath);

      const store = new RawStoreWithDelta({
        objects,
        deltas,
      });

      const gc = new GCController(store, {
        consolidator,
        minInterval: 0,
      });

      // The result should include packsConsolidated field
      const result = await gc.runGC();
      expect(result).toHaveProperty("packsConsolidated");

      await deltas.close();
    });
  });

  describe("persistence across sessions", () => {
    it("survives store close and reopen", async () => {
      const id1 = "a".repeat(40);
      const id2 = "b".repeat(40);

      // First session - store delta directly
      {
        const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
        await deltas.initialize();

        await deltas.storeDelta({ baseKey: id1, targetKey: id2 }, [
          { type: "start", targetLen: 20 },
          { type: "copy", start: 0, len: 20 },
          { type: "finish", checksum: 0 },
        ]);

        await deltas.close();
      }

      // Second session - verify delta is still there
      {
        const deltas = new PackDeltaStore({ files, basePath });
        await deltas.initialize();

        expect(await deltas.isDelta(id2)).toBe(true);

        const chainInfo = await deltas.getDeltaChainInfo(id2);
        expect(chainInfo).toBeDefined();
        expect(chainInfo?.baseKey).toBe(id1);

        await deltas.close();
      }
    });
  });

  describe("multi-pack queries", () => {
    it("finds objects across multiple packs", async () => {
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 2 });
      await deltas.initialize();

      // Create objects that will span multiple packs
      const ids: string[] = [];
      for (let i = 0; i < 6; i++) {
        const baseKey = "0".repeat(40);
        const targetKey = `${i + 1}`.repeat(40);
        ids.push(targetKey);

        await deltas.storeDelta({ baseKey, targetKey }, [
          { type: "start", targetLen: 10 + i },
          { type: "copy", start: 0, len: 10 + i },
          { type: "finish", checksum: 0 },
        ]);
      }

      // Verify all objects are findable
      for (const id of ids) {
        expect(await deltas.isDelta(id)).toBe(true);
      }

      // Check pack directory has multiple packs
      const packDir = deltas.getPackDirectory();
      const packs = await packDir.scan();
      expect(packs.length).toBeGreaterThan(1);

      await deltas.close();
    });
  });
});
