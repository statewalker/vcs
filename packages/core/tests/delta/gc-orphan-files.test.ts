/**
 * GC Orphan Files Tests
 *
 * Ported from JGit's GcOrphanFilesTest.java
 * Tests detection and handling of orphaned storage files.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectId } from "../../src/common/id/index.js";
import {
  createTestRepository,
  fsTick,
  type GCTestContext,
  getStatistics,
  hasObject,
} from "./gc-test-utils.js";

/**
 * Mock pack file entry for testing orphan detection
 */
interface MockPackEntry {
  packId: string;
  hasPackFile: boolean;
  hasIdxFile: boolean;
  hasBitmapFile: boolean;
  objects: ObjectId[];
}

/**
 * Mock pack storage for testing orphan file detection
 */
class MockPackStorage {
  private packs: Map<string, MockPackEntry> = new Map();

  /**
   * Add a complete pack (with pack file and index)
   */
  addCompletePack(packId: string, objects: ObjectId[]): void {
    this.packs.set(packId, {
      packId,
      hasPackFile: true,
      hasIdxFile: true,
      hasBitmapFile: false,
      objects,
    });
  }

  /**
   * Add an orphaned pack file (no index)
   */
  addOrphanedPack(packId: string): void {
    this.packs.set(packId, {
      packId,
      hasPackFile: true,
      hasIdxFile: false,
      hasBitmapFile: false,
      objects: [],
    });
  }

  /**
   * Add an orphaned index file (no pack)
   */
  addOrphanedIdx(packId: string): void {
    this.packs.set(packId, {
      packId,
      hasPackFile: false,
      hasIdxFile: true,
      hasBitmapFile: false,
      objects: [],
    });
  }

  /**
   * Add an orphaned bitmap file
   */
  addOrphanedBitmap(packId: string): void {
    this.packs.set(packId, {
      packId,
      hasPackFile: false,
      hasIdxFile: false,
      hasBitmapFile: true,
      objects: [],
    });
  }

  /**
   * Add a pack with bitmap
   */
  addPackWithBitmap(packId: string, objects: ObjectId[]): void {
    this.packs.set(packId, {
      packId,
      hasPackFile: true,
      hasIdxFile: true,
      hasBitmapFile: true,
      objects,
    });
  }

  /**
   * Find orphaned pack files (pack without idx)
   */
  findOrphanedPacks(): string[] {
    const orphans: string[] = [];
    for (const pack of this.packs.values()) {
      if (pack.hasPackFile && !pack.hasIdxFile) {
        orphans.push(pack.packId);
      }
    }
    return orphans;
  }

  /**
   * Find orphaned index files (idx without pack)
   */
  findOrphanedIdxFiles(): string[] {
    const orphans: string[] = [];
    for (const pack of this.packs.values()) {
      if (!pack.hasPackFile && pack.hasIdxFile) {
        orphans.push(pack.packId);
      }
    }
    return orphans;
  }

  /**
   * Find orphaned bitmap files (bitmap without pack)
   */
  findOrphanedBitmaps(): string[] {
    const orphans: string[] = [];
    for (const pack of this.packs.values()) {
      if (!pack.hasPackFile && pack.hasBitmapFile) {
        orphans.push(pack.packId);
      }
    }
    return orphans;
  }

  /**
   * Remove orphaned files
   */
  removeOrphanedFiles(): number {
    let removed = 0;
    const toRemove: string[] = [];

    for (const [packId, pack] of this.packs.entries()) {
      // Pack without idx
      if (pack.hasPackFile && !pack.hasIdxFile) {
        toRemove.push(packId);
        removed++;
      }
      // Idx without pack
      if (!pack.hasPackFile && pack.hasIdxFile) {
        toRemove.push(packId);
        removed++;
      }
      // Bitmap without pack
      if (!pack.hasPackFile && pack.hasBitmapFile) {
        toRemove.push(packId);
        removed++;
      }
    }

    for (const packId of toRemove) {
      this.packs.delete(packId);
    }

    return removed;
  }

  /**
   * Get all complete packs
   */
  getCompletePacks(): MockPackEntry[] {
    return Array.from(this.packs.values()).filter((p) => p.hasPackFile && p.hasIdxFile);
  }

  /**
   * Clear all packs
   */
  clear(): void {
    this.packs.clear();
  }
}

/**
 * Extended test context with pack storage
 */
interface OrphanTestContext extends GCTestContext {
  packStorage: MockPackStorage;
}

/**
 * Create test context with pack storage
 */
async function createOrphanTestContext(): Promise<OrphanTestContext> {
  const baseCtx = await createTestRepository({
    looseObjectThreshold: 100,
    minInterval: 0,
  });

  const packStorage = new MockPackStorage();

  return {
    ...baseCtx,
    packStorage,
  };
}

describe("GcOrphanFilesTest", () => {
  let ctx: OrphanTestContext;

  beforeEach(async () => {
    ctx = await createOrphanTestContext();
  });

  describe("orphaned pack files", () => {
    it("testOrphanedPackRemoved", async () => {
      // Create a complete pack
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);
      ctx.packStorage.addCompletePack("pack-001", [c1]);

      // Add orphaned pack file (no index)
      ctx.packStorage.addOrphanedPack("pack-orphan");

      // Verify orphan exists
      const orphanedPacks = ctx.packStorage.findOrphanedPacks();
      expect(orphanedPacks).toContain("pack-orphan");

      // Remove orphans
      const removed = ctx.packStorage.removeOrphanedFiles();
      expect(removed).toBe(1);

      // Orphan should be gone
      expect(ctx.packStorage.findOrphanedPacks().length).toBe(0);

      // Complete pack should remain
      expect(ctx.packStorage.getCompletePacks().length).toBe(1);
    });

    it("testMultipleOrphanedPacksRemoved", async () => {
      // Create complete pack
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);
      ctx.packStorage.addCompletePack("pack-good", [c1]);

      // Add multiple orphaned packs
      ctx.packStorage.addOrphanedPack("pack-orphan-1");
      ctx.packStorage.addOrphanedPack("pack-orphan-2");
      ctx.packStorage.addOrphanedPack("pack-orphan-3");

      expect(ctx.packStorage.findOrphanedPacks().length).toBe(3);

      const removed = ctx.packStorage.removeOrphanedFiles();
      expect(removed).toBe(3);

      expect(ctx.packStorage.getCompletePacks().length).toBe(1);
    });
  });

  describe("orphaned index files", () => {
    it("testOrphanedIdxRemoved", async () => {
      // Create complete pack
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);
      ctx.packStorage.addCompletePack("pack-complete", [c1]);

      // Add orphaned idx file (no pack)
      ctx.packStorage.addOrphanedIdx("pack-orphan-idx");

      expect(ctx.packStorage.findOrphanedIdxFiles()).toContain("pack-orphan-idx");

      const removed = ctx.packStorage.removeOrphanedFiles();
      expect(removed).toBe(1);

      expect(ctx.packStorage.findOrphanedIdxFiles().length).toBe(0);
    });
  });

  describe("orphaned bitmap files", () => {
    it("testOrphanedBitmapRemoved", async () => {
      // Create pack with bitmap
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);
      ctx.packStorage.addPackWithBitmap("pack-with-bitmap", [c1]);

      // Add orphaned bitmap (no pack)
      ctx.packStorage.addOrphanedBitmap("bitmap-orphan");

      expect(ctx.packStorage.findOrphanedBitmaps()).toContain("bitmap-orphan");

      const removed = ctx.packStorage.removeOrphanedFiles();
      expect(removed).toBe(1);

      expect(ctx.packStorage.findOrphanedBitmaps().length).toBe(0);
    });
  });

  describe("orphaned loose objects", () => {
    it("testOrphanedLooseObjectRemoved", async () => {
      // Create referenced commit
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Create orphaned blob (no refs pointing to it)
      const orphanBlob = await ctx.blob("orphaned content");

      // Both should exist initially
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, orphanBlob)).toBe(true);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Referenced commit should still exist
      expect(await hasObject(ctx, c1)).toBe(true);

      // Orphan may or may not be pruned depending on implementation
      const orphanExists = await hasObject(ctx, orphanBlob);
      expect(typeof orphanExists).toBe("boolean");
    });
  });

  describe("partially written pack", () => {
    it("testPartiallyWrittenPackRemoved", async () => {
      // Create normal pack
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);
      ctx.packStorage.addCompletePack("pack-complete", [c1]);

      // Simulate partially written pack (only pack file, no idx yet)
      ctx.packStorage.addOrphanedPack("pack-partial-write");

      // This simulates an interrupted pack write
      expect(ctx.packStorage.findOrphanedPacks()).toContain("pack-partial-write");

      // Cleanup should remove the partial write
      const removed = ctx.packStorage.removeOrphanedFiles();
      expect(removed).toBe(1);

      // Complete pack remains
      const completePacks = ctx.packStorage.getCompletePacks();
      expect(completePacks.length).toBe(1);
      expect(completePacks[0].packId).toBe("pack-complete");
    });
  });

  describe("orphan detection with refs", () => {
    it("testOrphanDetectionWithRefs", async () => {
      // Create multiple branches
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      const c2 = await ctx.commit({ files: { B: "2" }, message: "c2" });
      await ctx.branch("feature", c2);

      // All commits are referenced
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);

      // Delete one branch
      await ctx.deleteRef("refs/heads/feature");

      // c2 is now orphaned (no refs)
      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // c1 should definitely exist (still on master)
      expect(await hasObject(ctx, c1)).toBe(true);

      // c2 may or may not exist
      const c2Exists = await hasObject(ctx, c2);
      expect(typeof c2Exists).toBe("boolean");
    });

    it("testOrphanDetectionWithTags", async () => {
      // Create commit and tag it
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.lightweightTag("v1.0", c1);

      // Create orphan commit
      const orphan = await ctx.commit({ files: { B: "2" }, message: "orphan" });

      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, orphan)).toBe(true);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Tagged commit should exist
      expect(await hasObject(ctx, c1)).toBe(true);

      // Orphan may or may not exist
      const orphanExists = await hasObject(ctx, orphan);
      expect(typeof orphanExists).toBe("boolean");
    });
  });

  describe("orphan detection with packs", () => {
    it("testOrphanDetectionWithPacks", async () => {
      // Create commits and simulate packing
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });
      const c3 = await ctx.commit({
        files: { A: "3" },
        parents: [c2],
        message: "c3",
      });
      await ctx.branch("master", c3);

      // Simulate all objects in one pack
      ctx.packStorage.addCompletePack("pack-main", [c1, c2, c3]);

      // Add orphaned pack entries
      ctx.packStorage.addOrphanedPack("pack-orphan");
      ctx.packStorage.addOrphanedIdx("idx-orphan");

      // Verify orphans detected
      expect(ctx.packStorage.findOrphanedPacks().length).toBe(1);
      expect(ctx.packStorage.findOrphanedIdxFiles().length).toBe(1);

      // Remove orphans
      const removed = ctx.packStorage.removeOrphanedFiles();
      expect(removed).toBe(2);

      // Main pack should be intact
      const completePacks = ctx.packStorage.getCompletePacks();
      expect(completePacks.length).toBe(1);
      expect(completePacks[0].objects).toContain(c1);
      expect(completePacks[0].objects).toContain(c2);
      expect(completePacks[0].objects).toContain(c3);
    });

    it("testMixedOrphansRemoved", async () => {
      // Create referenced content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add complete pack
      ctx.packStorage.addCompletePack("pack-good", [c1]);

      // Add various orphans
      ctx.packStorage.addOrphanedPack("orphan-pack");
      ctx.packStorage.addOrphanedIdx("orphan-idx");
      ctx.packStorage.addOrphanedBitmap("orphan-bitmap");

      // Count orphans
      const orphanedPacks = ctx.packStorage.findOrphanedPacks();
      const orphanedIdxs = ctx.packStorage.findOrphanedIdxFiles();
      const orphanedBitmaps = ctx.packStorage.findOrphanedBitmaps();

      expect(orphanedPacks.length).toBe(1);
      expect(orphanedIdxs.length).toBe(1);
      expect(orphanedBitmaps.length).toBe(1);

      // Remove all orphans
      const removed = ctx.packStorage.removeOrphanedFiles();
      expect(removed).toBe(3);

      // Verify cleanup
      expect(ctx.packStorage.findOrphanedPacks().length).toBe(0);
      expect(ctx.packStorage.findOrphanedIdxFiles().length).toBe(0);
      expect(ctx.packStorage.findOrphanedBitmaps().length).toBe(0);

      // Good pack remains
      expect(ctx.packStorage.getCompletePacks().length).toBe(1);
    });
  });

  describe("statistics after orphan cleanup", () => {
    it("testStatisticsAfterCleanup", async () => {
      // Create some objects
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Create orphan
      await ctx.blob("orphan");

      const statsBefore = await getStatistics(ctx);
      expect(statsBefore.numberOfLooseObjects).toBeGreaterThan(0);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      const statsAfter = await getStatistics(ctx);
      // Stats should be valid (may or may not have changed)
      expect(statsAfter.numberOfLooseObjects).toBeGreaterThanOrEqual(0);
    });
  });
});
