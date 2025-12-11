/**
 * Tests for SQLDeltaBackend
 */

import { createDelta, createDeltaRanges, type Delta } from "@webrun-vcs/utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlJsAdapter } from "../src/adapters/sql-js-adapter.js";
import { SQLDeltaBackend } from "../src/backends/sql-delta-backend.js";
import type { DatabaseClient } from "../src/database-client.js";
import { initializeSchema } from "../src/migrations/index.js";

describe("SQLDeltaBackend", () => {
  let db: DatabaseClient;
  let backend: SQLDeltaBackend;

  // Helper to generate content - creates blocks that work well with delta algorithms
  function makeContent(seed: number, size: number): Uint8Array {
    const result = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      result[i] = ((seed + i) * 31) & 0xff;
    }
    return result;
  }

  // Helper to create similar content (with some modifications)
  function makeSimilarContent(base: Uint8Array, changeRatio = 0.1): Uint8Array {
    const result = new Uint8Array(base);
    const changeBytesCount = Math.floor(base.length * changeRatio);
    for (let i = 0; i < changeBytesCount; i++) {
      const pos = Math.floor(Math.random() * base.length);
      result[pos] = (result[pos] + 1) & 0xff;
    }
    return result;
  }

  // Helper to create a delta from base to target
  function computeDelta(base: Uint8Array, target: Uint8Array): Delta[] {
    const ranges = createDeltaRanges(base, target);
    return [...createDelta(base, target, ranges)];
  }

  // Helper to store a base object
  async function storeBaseObject(objectId: string, content: Uint8Array): Promise<void> {
    await db.execute(
      `INSERT INTO object (object_id, size, content, created_at, accessed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [objectId, content.length, content, Date.now(), Date.now()],
    );
  }

  beforeEach(async () => {
    db = await SqlJsAdapter.create();
    await initializeSchema(db);
    backend = new SQLDeltaBackend(db);
  });

  afterEach(async () => {
    await db.close();
  });

  describe("basic operations", () => {
    it("should store and load delta", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05); // 5% change

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      const stored = await backend.storeDelta("target-id", "base-id", delta);

      expect(stored).toBe(true);

      const loaded = await backend.loadDelta("target-id");
      expect(loaded).toBeDefined();
      if (loaded) {
        expect(loaded.targetId).toBe("target-id");
        expect(loaded.baseId).toBe("base-id");
        expect(loaded.delta).toBeDefined();
        expect(loaded.delta.length).toBeGreaterThan(0);
      }
    });

    it("should check if object is delta", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05);

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      await backend.storeDelta("target-id", "base-id", delta);

      expect(await backend.isDelta("target-id")).toBe(true);
      expect(await backend.isDelta("base-id")).toBe(false);
      expect(await backend.isDelta("nonexistent")).toBe(false);
    });

    it("should check if object exists", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05);

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      await backend.storeDelta("target-id", "base-id", delta);

      expect(await backend.has("target-id")).toBe(true);
      expect(await backend.has("base-id")).toBe(true);
      expect(await backend.has("nonexistent")).toBe(false);
    });
  });

  describe("delta resolution", () => {
    it("should resolve single delta to get object content", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05);

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      await backend.storeDelta("target-id", "base-id", delta);

      const resolved = await backend.loadObject("target-id");
      expect(resolved).toBeDefined();
      expect(resolved).toEqual(target);
    });

    it("should resolve chained deltas", async () => {
      const v1 = makeContent(1, 1000);
      const v2 = makeSimilarContent(v1, 0.05);
      const v3 = makeSimilarContent(v2, 0.05);

      await storeBaseObject("v1-id", v1);

      const delta1to2 = computeDelta(v1, v2);
      await backend.storeDelta("v2-id", "v1-id", delta1to2);

      const delta2to3 = computeDelta(v2, v3);
      await backend.storeDelta("v3-id", "v2-id", delta2to3);

      // Resolve through chain: v3 -> v2 -> v1
      const resolved = await backend.loadObject("v3-id");
      expect(resolved).toBeDefined();
      expect(resolved).toEqual(v3);
    });

    it("should return base object directly if not a delta", async () => {
      const base = makeContent(1, 500);
      await storeBaseObject("base-id", base);

      const resolved = await backend.loadObject("base-id");
      expect(resolved).toBeDefined();
      expect(resolved).toEqual(base);
    });

    it("should return undefined for nonexistent object", async () => {
      const resolved = await backend.loadObject("nonexistent");
      expect(resolved).toBeUndefined();
    });
  });

  describe("delta chain info", () => {
    it("should return delta chain info for delta object", async () => {
      const v1 = makeContent(1, 1000);
      const v2 = makeSimilarContent(v1, 0.05);
      const v3 = makeSimilarContent(v2, 0.05);

      await storeBaseObject("v1-id", v1);

      const delta1to2 = computeDelta(v1, v2);
      await backend.storeDelta("v2-id", "v1-id", delta1to2);

      const delta2to3 = computeDelta(v2, v3);
      await backend.storeDelta("v3-id", "v2-id", delta2to3);

      const info = await backend.getDeltaChainInfo("v3-id");
      expect(info).toBeDefined();
      if (info) {
        expect(info.baseId).toBe("v1-id");
        expect(info.depth).toBe(2);
        expect(info.chain).toEqual(["v3-id", "v2-id", "v1-id"]);
      }
    });

    it("should return undefined for non-delta object", async () => {
      const base = makeContent(1, 500);
      await storeBaseObject("base-id", base);

      const info = await backend.getDeltaChainInfo("base-id");
      expect(info).toBeUndefined();
    });
  });

  describe("remove delta", () => {
    it("should remove delta without keeping content", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05);

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      await backend.storeDelta("target-id", "base-id", delta);

      const removed = await backend.removeDelta("target-id", false);
      expect(removed).toBe(true);

      expect(await backend.isDelta("target-id")).toBe(false);
      expect(await backend.has("target-id")).toBe(false);
    });

    it("should remove delta and keep as base object", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05);

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      await backend.storeDelta("target-id", "base-id", delta);

      const removed = await backend.removeDelta("target-id", true);
      expect(removed).toBe(true);

      expect(await backend.isDelta("target-id")).toBe(false);
      expect(await backend.has("target-id")).toBe(true);

      // Content should be preserved
      const content = await backend.loadObject("target-id");
      expect(content).toEqual(target);
    });
  });

  describe("list operations", () => {
    it("should list all objects", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05);

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      await backend.storeDelta("target-id", "base-id", delta);

      const objects: string[] = [];
      for await (const id of backend.listObjects()) {
        objects.push(id);
      }

      expect(objects).toContain("base-id");
      expect(objects).toContain("target-id");
    });

    it("should list deltas", async () => {
      const base = makeContent(1, 1000);
      const target = makeSimilarContent(base, 0.05);

      await storeBaseObject("base-id", base);

      const delta = computeDelta(base, target);
      await backend.storeDelta("target-id", "base-id", delta);

      const deltas: { targetId: string; baseId: string }[] = [];
      for await (const d of backend.listDeltas()) {
        deltas.push(d);
      }

      expect(deltas).toHaveLength(1);
      expect(deltas[0].targetId).toBe("target-id");
      expect(deltas[0].baseId).toBe("base-id");
    });
  });

  describe("statistics", () => {
    it("should return correct stats", async () => {
      const v1 = makeContent(1, 1000);
      const v2 = makeSimilarContent(v1, 0.05);

      await storeBaseObject("v1-id", v1);

      const delta = computeDelta(v1, v2);
      await backend.storeDelta("v2-id", "v1-id", delta);

      const stats = await backend.getStats();

      expect(stats.baseCount).toBe(1);
      expect(stats.deltaCount).toBe(1);
      expect(stats.maxChainDepth).toBe(1);
      expect(stats.totalSize).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("should detect circular delta chains", async () => {
      // Create a circular chain: A -> B -> A
      await db.execute(
        `INSERT INTO delta_content
         (object_id, base_object_id, delta_data, delta_format, original_size, delta_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["A", "B", new Uint8Array([0x00, 0x00]), "git", 100, 2, Date.now()],
      );
      await db.execute(
        `INSERT INTO delta_content
         (object_id, base_object_id, delta_data, delta_format, original_size, delta_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ["B", "A", new Uint8Array([0x00, 0x00]), "git", 100, 2, Date.now()],
      );

      await expect(backend.loadObject("A")).rejects.toThrow("Circular delta chain");
    });
  });
});
