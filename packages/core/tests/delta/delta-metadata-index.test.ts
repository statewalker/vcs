/**
 * Tests for DeltaMetadataIndex
 *
 * Tests metadata tracking, persistence, and chain traversal.
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type DeltaMetadata, DeltaMetadataIndex } from "../../src/delta/delta-metadata-index.js";

describe("DeltaMetadataIndex", () => {
  let files: FilesApi;
  const basePath = "/repo/objects/pack";

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  function createTestMetadata(overrides: Partial<DeltaMetadata> = {}): DeltaMetadata {
    return {
      baseKey: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      packName: "pack-test",
      offset: 100,
      depth: 1,
      compressedSize: 50,
      originalSize: 200,
      ...overrides,
    };
  }

  describe("basic operations", () => {
    it("starts empty", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });
      expect(index.size).toBe(0);
      expect(index.isDirty).toBe(false);
    });

    it("adds entries", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });
      const metadata = createTestMetadata();

      index.setEntry("target1", metadata);

      expect(index.size).toBe(1);
      expect(index.isDelta("target1")).toBe(true);
      expect(index.getMetadata("target1")).toEqual(metadata);
      expect(index.isDirty).toBe(true);
    });

    it("updates existing entries", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index.setEntry("target1", createTestMetadata({ depth: 1 }));
      index.setEntry("target1", createTestMetadata({ depth: 2 }));

      expect(index.size).toBe(1);
      expect(index.getMetadata("target1")?.depth).toBe(2);
    });

    it("removes entries", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index.setEntry("target1", createTestMetadata());
      expect(index.removeEntry("target1")).toBe(true);

      expect(index.size).toBe(0);
      expect(index.isDelta("target1")).toBe(false);
      expect(index.getMetadata("target1")).toBeUndefined();
    });

    it("returns false when removing non-existent entry", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });
      expect(index.removeEntry("nonexistent")).toBe(false);
    });

    it("clears all entries", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index.setEntry("target1", createTestMetadata());
      index.setEntry("target2", createTestMetadata());
      index.clear();

      expect(index.size).toBe(0);
      expect(index.isDirty).toBe(true);
    });
  });

  describe("iteration", () => {
    it("iterates all entries", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index.setEntry("target1", createTestMetadata({ depth: 1 }));
      index.setEntry("target2", createTestMetadata({ depth: 2 }));
      index.setEntry("target3", createTestMetadata({ depth: 3 }));

      const entries = Array.from(index.allEntries());
      expect(entries).toHaveLength(3);

      const keys = entries.map(([k]) => k);
      expect(keys).toContain("target1");
      expect(keys).toContain("target2");
      expect(keys).toContain("target3");
    });
  });

  describe("chain traversal", () => {
    it("gets chain depth", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index.setEntry("target1", createTestMetadata({ baseKey: "base", depth: 1 }));
      index.setEntry("target2", createTestMetadata({ baseKey: "target1", depth: 2 }));
      index.setEntry("target3", createTestMetadata({ baseKey: "target2", depth: 3 }));

      expect(index.getChainDepth("target1")).toBe(1);
      expect(index.getChainDepth("target2")).toBe(2);
      expect(index.getChainDepth("target3")).toBe(3);
      expect(index.getChainDepth("nonexistent")).toBe(0);
    });

    it("gets full chain", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      // Chain: target3 -> target2 -> target1 -> base
      index.setEntry("target1", createTestMetadata({ baseKey: "base", depth: 1 }));
      index.setEntry("target2", createTestMetadata({ baseKey: "target1", depth: 2 }));
      index.setEntry("target3", createTestMetadata({ baseKey: "target2", depth: 3 }));

      const chain = index.getChain("target3");
      expect(chain).toEqual(["target3", "target2", "target1", "base"]);
    });

    it("finds dependents", () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      // Two targets depend on base1, one on base2
      index.setEntry("t1", createTestMetadata({ baseKey: "base1", depth: 1 }));
      index.setEntry("t2", createTestMetadata({ baseKey: "base1", depth: 1 }));
      index.setEntry("t3", createTestMetadata({ baseKey: "base2", depth: 1 }));

      const dependentsOfBase1 = index.findDependents("base1");
      expect(dependentsOfBase1).toHaveLength(2);
      expect(dependentsOfBase1).toContain("t1");
      expect(dependentsOfBase1).toContain("t2");

      const dependentsOfBase2 = index.findDependents("base2");
      expect(dependentsOfBase2).toEqual(["t3"]);

      const dependentsOfUnknown = index.findDependents("unknown");
      expect(dependentsOfUnknown).toEqual([]);
    });
  });

  describe("persistence", () => {
    it("saves and loads entries", async () => {
      const index1 = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index1.setEntry("target1", createTestMetadata({ depth: 1 }));
      index1.setEntry("target2", createTestMetadata({ depth: 2 }));
      await index1.save();

      // Create new index and load
      const index2 = new DeltaMetadataIndex({ files, basePath, autoSave: false });
      await index2.load();

      expect(index2.size).toBe(2);
      expect(index2.getMetadata("target1")?.depth).toBe(1);
      expect(index2.getMetadata("target2")?.depth).toBe(2);
      expect(index2.isDirty).toBe(false);
    });

    it("handles missing index file gracefully", async () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      // Should not throw
      await index.load();

      expect(index.size).toBe(0);
    });

    it("handles corrupted index file gracefully", async () => {
      // Write corrupted data
      await files.mkdir(basePath);
      await files.write(`${basePath}/delta-index.json`, [
        new TextEncoder().encode("not valid json"),
      ]);

      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      await index.load();
      warnSpy.mockRestore();

      expect(index.size).toBe(0);
    });

    it("creates directory if needed when saving", async () => {
      const index = new DeltaMetadataIndex({ files, basePath: "/new/path", autoSave: false });

      index.setEntry("target", createTestMetadata());
      await index.save();

      expect(await files.exists("/new/path/delta-index.json")).toBe(true);
    });

    it("marks clean after save", async () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index.setEntry("target", createTestMetadata());
      expect(index.isDirty).toBe(true);

      await index.save();
      expect(index.isDirty).toBe(false);
    });

    it("close saves if dirty", async () => {
      const index = new DeltaMetadataIndex({ files, basePath, autoSave: false });

      index.setEntry("target", createTestMetadata());
      await index.close();

      // Verify saved by loading in new index
      const index2 = new DeltaMetadataIndex({ files, basePath, autoSave: false });
      await index2.load();
      expect(index2.size).toBe(1);
    });
  });

  describe("auto-save", () => {
    it("schedules save after modification", async () => {
      vi.useFakeTimers();

      const index = new DeltaMetadataIndex({
        files,
        basePath,
        autoSave: true,
        saveDebounceMs: 100,
      });

      index.setEntry("target", createTestMetadata());

      // Not saved yet
      expect(await files.exists(`${basePath}/delta-index.json`)).toBe(false);

      // Advance timer past debounce
      await vi.advanceTimersByTimeAsync(150);

      // Now should be saved
      expect(await files.exists(`${basePath}/delta-index.json`)).toBe(true);

      vi.useRealTimers();
    });

    it("debounces multiple modifications", async () => {
      vi.useFakeTimers();

      const index = new DeltaMetadataIndex({
        files,
        basePath,
        autoSave: true,
        saveDebounceMs: 100,
      });

      // Multiple rapid modifications
      index.setEntry("t1", createTestMetadata());
      await vi.advanceTimersByTimeAsync(50);
      index.setEntry("t2", createTestMetadata());
      await vi.advanceTimersByTimeAsync(50);
      index.setEntry("t3", createTestMetadata());

      // Still not saved
      expect(await files.exists(`${basePath}/delta-index.json`)).toBe(false);

      // Final debounce wait
      await vi.advanceTimersByTimeAsync(150);

      // Now saved with all entries
      const index2 = new DeltaMetadataIndex({ files, basePath, autoSave: false });
      await index2.load();
      expect(index2.size).toBe(3);

      vi.useRealTimers();
    });

    it("cancels pending save on manual save", async () => {
      vi.useFakeTimers();

      const index = new DeltaMetadataIndex({
        files,
        basePath,
        autoSave: true,
        saveDebounceMs: 1000,
      });

      index.setEntry("target", createTestMetadata());

      // Manual save before auto-save triggers
      await index.save();
      expect(index.isDirty).toBe(false);

      // The timer should have been cancelled
      await vi.advanceTimersByTimeAsync(1500);
      // No error should occur

      vi.useRealTimers();
    });

    it("cancels pending save on close", async () => {
      vi.useFakeTimers();

      const index = new DeltaMetadataIndex({
        files,
        basePath,
        autoSave: true,
        saveDebounceMs: 1000,
      });

      index.setEntry("target", createTestMetadata());
      await index.close();

      // Data should be saved via close()
      const index2 = new DeltaMetadataIndex({ files, basePath, autoSave: false });
      await index2.load();
      expect(index2.size).toBe(1);

      vi.useRealTimers();
    });
  });
});
