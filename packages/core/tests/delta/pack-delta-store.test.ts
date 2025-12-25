/**
 * Tests for PackDeltaStore
 *
 * Tests the DeltaStore interface implementation using pack files.
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import type { Delta } from "@webrun-vcs/utils";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PackDeltaStore } from "../../src/delta/pack-delta-store.js";

// Set up Node.js compression before tests
beforeAll(() => {
  setCompression(createNodeCompression());
});

describe("PackDeltaStore", () => {
  let files: FilesApi;
  const basePath = "/repo/objects/pack";

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  function createSimpleDelta(targetLen: number): Delta[] {
    return [
      { type: "start", targetLen },
      { type: "copy", start: 0, len: targetLen },
      { type: "finish", checksum: 0 },
    ];
  }

  function createInsertDelta(data: Uint8Array): Delta[] {
    return [
      { type: "start", targetLen: data.length },
      { type: "insert", data },
      { type: "finish", checksum: 0 },
    ];
  }

  describe("initialization", () => {
    it("creates store without errors", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();
      await store.close();
    });

    it("handles non-existent directory", async () => {
      const store = new PackDeltaStore({ files, basePath: "/nonexistent/pack" });
      await store.initialize();
      expect(await store.isDelta("anything")).toBe(false);
      await store.close();
    });
  });

  describe("storeDelta and isDelta", () => {
    it("stores a delta", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const delta = createSimpleDelta(100);

      const size = await store.storeDelta({ baseKey, targetKey }, delta);

      expect(size).toBeGreaterThan(0);
      expect(await store.isDelta(targetKey)).toBe(true);
      expect(await store.isDelta(baseKey)).toBe(false);

      await store.close();
    });

    it("stores multiple deltas", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 10 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      for (let i = 1; i <= 3; i++) {
        const targetKey = `${i}`.repeat(40);
        await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(50 + i));
      }

      expect(await store.isDelta("1".repeat(40))).toBe(true);
      expect(await store.isDelta("2".repeat(40))).toBe(true);
      expect(await store.isDelta("3".repeat(40))).toBe(true);

      await store.close();
    });
  });

  describe("loadDelta", () => {
    it("loads stored delta", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const originalDelta = createSimpleDelta(100);

      await store.storeDelta({ baseKey, targetKey }, originalDelta);

      const loaded = await store.loadDelta(targetKey);

      expect(loaded).toBeDefined();
      expect(loaded?.baseKey).toBe(baseKey);
      expect(loaded?.targetKey).toBe(targetKey);
      expect(loaded?.delta).toBeDefined();
      expect(loaded?.ratio).toBeGreaterThan(0);

      await store.close();
    });

    it("returns undefined for non-delta", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const loaded = await store.loadDelta("cccccccccccccccccccccccccccccccccccccccc");

      expect(loaded).toBeUndefined();

      await store.close();
    });

    it("loads delta with insert instructions", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const insertData = new TextEncoder().encode("hello world");
      const originalDelta = createInsertDelta(insertData);

      await store.storeDelta({ baseKey, targetKey }, originalDelta);

      const loaded = await store.loadDelta(targetKey);

      expect(loaded).toBeDefined();
      expect(loaded?.delta).toBeDefined();

      // Verify insert instruction is preserved
      const insertInstruction = loaded?.delta.find((d) => d.type === "insert");
      expect(insertInstruction).toBeDefined();
      if (insertInstruction?.type === "insert") {
        expect(new TextDecoder().decode(insertInstruction.data)).toBe("hello world");
      }

      await store.close();
    });
  });

  describe("getDeltaChainInfo", () => {
    it("returns chain info for delta", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      const chainInfo = await store.getDeltaChainInfo(targetKey);

      expect(chainInfo).toBeDefined();
      expect(chainInfo?.baseKey).toBe(baseKey);
      expect(chainInfo?.targetKey).toBe(targetKey);
      expect(chainInfo?.depth).toBe(1);
      expect(chainInfo?.chain).toContain(targetKey);
      expect(chainInfo?.chain).toContain(baseKey);

      await store.close();
    });

    it("returns undefined for non-delta", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const chainInfo = await store.getDeltaChainInfo("nonexistent");

      expect(chainInfo).toBeUndefined();

      await store.close();
    });

    it("tracks chain depth correctly", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      // Create chain: target3 -> target2 -> target1 -> base
      const base = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const t1 = "1111111111111111111111111111111111111111";
      const t2 = "2222222222222222222222222222222222222222";
      const t3 = "3333333333333333333333333333333333333333";

      await store.storeDelta({ baseKey: base, targetKey: t1 }, createSimpleDelta(100));
      await store.storeDelta({ baseKey: t1, targetKey: t2 }, createSimpleDelta(100));
      await store.storeDelta({ baseKey: t2, targetKey: t3 }, createSimpleDelta(100));

      const info1 = await store.getDeltaChainInfo(t1);
      const info2 = await store.getDeltaChainInfo(t2);
      const info3 = await store.getDeltaChainInfo(t3);

      expect(info1?.depth).toBe(1);
      expect(info2?.depth).toBe(2);
      expect(info3?.depth).toBe(3);

      await store.close();
    });
  });

  describe("removeDelta", () => {
    it("removes delta from index", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));
      expect(await store.isDelta(targetKey)).toBe(true);

      const removed = await store.removeDelta(targetKey);

      expect(removed).toBe(true);
      expect(await store.isDelta(targetKey)).toBe(false);

      await store.close();
    });

    it("returns false for non-existent delta", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const removed = await store.removeDelta("nonexistent");

      expect(removed).toBe(false);

      await store.close();
    });
  });

  describe("listDeltas", () => {
    it("lists all deltas", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      await store.storeDelta(
        { baseKey, targetKey: "1111111111111111111111111111111111111111" },
        createSimpleDelta(50),
      );
      await store.storeDelta(
        { baseKey, targetKey: "2222222222222222222222222222222222222222" },
        createSimpleDelta(60),
      );

      const deltas: Array<{ baseKey: string; targetKey: string }> = [];
      for await (const delta of store.listDeltas()) {
        deltas.push(delta);
      }

      expect(deltas).toHaveLength(2);
      expect(deltas.map((d) => d.targetKey)).toContain("1111111111111111111111111111111111111111");
      expect(deltas.map((d) => d.targetKey)).toContain("2222222222222222222222222222222222222222");

      await store.close();
    });

    it("returns empty for no deltas", async () => {
      const store = new PackDeltaStore({ files, basePath });
      await store.initialize();

      const deltas: Array<{ baseKey: string; targetKey: string }> = [];
      for await (const delta of store.listDeltas()) {
        deltas.push(delta);
      }

      expect(deltas).toHaveLength(0);

      await store.close();
    });
  });

  describe("flush", () => {
    it("flushes pending deltas to pack", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 100 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      // Force flush
      await store.flush();

      // Verify pack files exist
      const packDir = store.getPackDirectory();
      const packs = await packDir.scan();
      expect(packs.length).toBeGreaterThan(0);

      await store.close();
    });

    it("auto-flushes when threshold reached", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 3 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      // Add 3 deltas to trigger flush
      for (let i = 1; i <= 3; i++) {
        const targetKey = `${i}`.repeat(40);
        await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(50));
      }

      // Should have auto-flushed
      const packDir = store.getPackDirectory();
      const packs = await packDir.scan();
      expect(packs.length).toBeGreaterThan(0);

      await store.close();
    });
  });

  describe("persistence", () => {
    it("persists across store instances", async () => {
      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      // Store delta
      const store1 = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store1.initialize();
      await store1.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));
      await store1.close();

      // Load in new instance
      const store2 = new PackDeltaStore({ files, basePath });
      await store2.initialize();

      expect(await store2.isDelta(targetKey)).toBe(true);

      const loaded = await store2.loadDelta(targetKey);
      expect(loaded?.baseKey).toBe(baseKey);

      await store2.close();
    });
  });

  describe("edge cases", () => {
    it("handles empty delta", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const emptyDelta: Delta[] = [
        { type: "start", targetLen: 0 },
        { type: "finish", checksum: 0 },
      ];

      await store.storeDelta(
        {
          baseKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          targetKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        emptyDelta,
      );

      const loaded = await store.loadDelta("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      expect(loaded).toBeDefined();

      await store.close();
    });

    it("handles large delta", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      // Create delta with large insert
      const largeData = new Uint8Array(10000);
      for (let i = 0; i < largeData.length; i++) {
        largeData[i] = i % 256;
      }

      const largeDelta: Delta[] = [
        { type: "start", targetLen: 10000 },
        { type: "insert", data: largeData },
        { type: "finish", checksum: 0 },
      ];

      await store.storeDelta(
        {
          baseKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          targetKey: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        },
        largeDelta,
      );

      const loaded = await store.loadDelta("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
      expect(loaded).toBeDefined();

      // Verify data preserved - Git delta format splits inserts >127 bytes
      // into multiple instructions, so sum all insert data
      const insertInstructions = loaded?.delta.filter((d) => d.type === "insert") as Array<{
        type: "insert";
        data: Uint8Array;
      }>;
      const totalInsertBytes = insertInstructions.reduce((sum, ins) => sum + ins.data.length, 0);
      expect(totalInsertBytes).toBe(10000);

      await store.close();
    });
  });
});
