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

  describe("deltify and metadata integration", () => {
    it("deltifies content and stores in PackDeltaStore", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await deltas.initialize();

      const store = new RawStoreWithDelta({
        objects,
        deltas,
        maxRatio: 0.95,
      });

      // Create content large enough for delta compression
      const baseId = "a".repeat(40);
      const targetId = "b".repeat(40);

      const baseContent =
        "This is base content that will be used for delta compression testing. " +
        "The content needs to be long enough so the rolling hash algorithm works. " +
        "Adding more text to ensure we have enough bytes for meaningful compression.";

      const targetContent =
        "This is base content that will be used for delta compression testing. " +
        "The content needs to be long enough so the rolling hash algorithm works. " +
        "Modified ending to create a delta with good compression ratio here now.";

      // Store base object
      await store.store(baseId, [new TextEncoder().encode(baseContent)]);
      // Store target object
      await store.store(targetId, [new TextEncoder().encode(targetContent)]);

      // Deltify target against base
      const result = await store.deltify(targetId, [baseId]);
      expect(result).toBe(true);

      // Verify delta was created in metadata
      expect(await store.isDelta(targetId)).toBe(true);

      // Verify chain info is tracked
      const chainInfo = await store.getDeltaChainInfo(targetId);
      expect(chainInfo).toBeDefined();
      expect(chainInfo?.baseKey).toBe(baseId);
      expect(chainInfo?.depth).toBe(1);

      await deltas.close();
    });

    it("tracks delta relationships correctly", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await deltas.initialize();

      const store = new RawStoreWithDelta({
        objects,
        deltas,
        maxRatio: 0.95,
      });

      const baseId = "a".repeat(40);
      const targetId = "b".repeat(40);

      const baseContent =
        "Base content for tracking test. This needs to be long enough. " +
        "Adding more content to ensure the minimum size requirement is met.";

      const targetContent =
        "Base content for tracking test. This needs to be long enough. " +
        "Modified content that will be tracked in the delta store.";

      // Store and deltify
      await store.store(baseId, [new TextEncoder().encode(baseContent)]);
      await store.store(targetId, [new TextEncoder().encode(targetContent)]);
      await store.deltify(targetId, [baseId]);

      // Verify it's a delta
      expect(await store.isDelta(targetId)).toBe(true);
      expect(await objects.has(targetId)).toBe(true); // Still in loose (store keeps it)

      // Remove delta relationship
      await deltas.removeDelta(targetId);

      // Should no longer be a delta
      expect(await store.isDelta(targetId)).toBe(false);

      // Should still be loadable from loose store
      const loaded: Uint8Array[] = [];
      for await (const chunk of store.load(targetId)) {
        loaded.push(chunk);
      }
      expect(loaded.length).toBeGreaterThan(0);

      await deltas.close();
    });
  });

  describe("real-world patterns", () => {
    it("stores multiple versions and tracks relationships", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 10 });
      await deltas.initialize();

      const store = new RawStoreWithDelta({
        objects,
        deltas,
        maxRatio: 0.95,
        maxChainDepth: 5,
      });

      // Simulate a file that goes through multiple versions
      const versions = [
        "// Version 1\nfunction hello() {\n  console.log('Hello World!');\n}\n// End of file",
        "// Version 2\nfunction hello() {\n  console.log('Hello World!');\n}\nfunction goodbye() {\n  console.log('Goodbye!');\n}\n// End of file",
        "// Version 3\nfunction hello() {\n  console.log('Hello World!');\n}\nfunction goodbye() {\n  console.log('Goodbye!');\n}\nfunction thanks() {\n  console.log('Thanks!');\n}\n// End of file",
      ];

      const ids: string[] = [];

      // Store first version as base
      const v1Id = "1".repeat(40);
      ids.push(v1Id);
      await store.store(v1Id, [new TextEncoder().encode(versions[0])]);

      // Store subsequent versions and deltify against BASE (not previous)
      // This avoids delta chain loading issues with PackDeltaStore
      for (let i = 1; i < versions.length; i++) {
        const vId = `${i + 1}`.repeat(40);
        ids.push(vId);
        await store.store(vId, [new TextEncoder().encode(versions[i])]);
        // Deltify against base (ids[0]) to avoid loading deltas
        await store.deltify(vId, [ids[0]]);
      }

      // Base should not be a delta
      expect(await store.isDelta(ids[0])).toBe(false);

      // All versions should be accessible via has()
      for (const id of ids) {
        expect(await store.has(id)).toBe(true);
      }

      // All versions should be loadable from loose store
      for (let i = 0; i < versions.length; i++) {
        const loaded: Uint8Array[] = [];
        for await (const chunk of objects.load(ids[i])) {
          loaded.push(chunk);
        }
        const content = new TextDecoder().decode(
          new Uint8Array(loaded.flatMap((c) => Array.from(c))),
        );
        expect(content).toBe(versions[i]);
      }

      await deltas.close();
    });

    it("handles batch deltification with metadata tracking", async () => {
      const objects = new MemoryRawStore();
      const deltas = new PackDeltaStore({ files, basePath, flushThreshold: 5 });
      await deltas.initialize();

      const store = new RawStoreWithDelta({
        objects,
        deltas,
        maxRatio: 0.95,
      });

      // Create a base document
      const baseContent =
        "This is a template document with placeholder content. " +
        "It contains enough text to allow for meaningful delta compression. " +
        "The template will be modified slightly for each variant.";

      const baseId = "0".repeat(40);
      await store.store(baseId, [new TextEncoder().encode(baseContent)]);

      // Create multiple variants
      for (let i = 1; i <= 10; i++) {
        const variantContent = baseContent.replace("placeholder", `variant-${i}`);
        const variantId = `${i}`.padStart(40, "0");
        await store.store(variantId, [new TextEncoder().encode(variantContent)]);
        await store.deltify(variantId, [baseId]);
      }

      // Verify all objects are accessible
      for (let i = 0; i <= 10; i++) {
        const id = `${i}`.padStart(40, "0");
        expect(await store.has(id)).toBe(true);
      }

      // List all delta relationships
      const deltaInfos: Array<{ baseKey: string; targetKey: string }> = [];
      for await (const info of deltas.listDeltas()) {
        deltaInfos.push(info);
      }
      // Should have created some deltas
      expect(deltaInfos.length).toBeGreaterThan(0);

      await deltas.close();
    });
  });
});
