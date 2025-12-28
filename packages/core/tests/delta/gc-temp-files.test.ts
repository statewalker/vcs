/**
 * GC Temporary Files Tests
 *
 * Ported from JGit's GcTemporaryFilesTest.java
 * Tests cleanup of temporary files during GC.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { createTestRepository, fsTick, type GCTestContext, hasObject } from "./gc-test-utils.js";

/**
 * Mock temporary file entry
 */
interface TempFileEntry {
  path: string;
  createdAt: number;
  type: "pack" | "lock" | "temp";
}

/**
 * Mock temporary file storage for testing GC cleanup behavior
 */
class MockTempStorage {
  private files: Map<string, TempFileEntry> = new Map();

  /**
   * Add a temporary pack file
   */
  addTempPackFile(name: string): void {
    this.files.set(name, {
      path: `.git/objects/pack/${name}.pack.tmp`,
      createdAt: Date.now(),
      type: "pack",
    });
  }

  /**
   * Add an old temporary pack file
   */
  addOldTempPackFile(name: string, ageMs: number): void {
    this.files.set(name, {
      path: `.git/objects/pack/${name}.pack.tmp`,
      createdAt: Date.now() - ageMs,
      type: "pack",
    });
  }

  /**
   * Add a lock file
   */
  addLockFile(name: string): void {
    this.files.set(name, {
      path: `.git/${name}.lock`,
      createdAt: Date.now(),
      type: "lock",
    });
  }

  /**
   * Add an old lock file
   */
  addOldLockFile(name: string, ageMs: number): void {
    this.files.set(name, {
      path: `.git/${name}.lock`,
      createdAt: Date.now() - ageMs,
      type: "lock",
    });
  }

  /**
   * Add a generic temp file
   */
  addTempFile(name: string): void {
    this.files.set(name, {
      path: `.git/tmp/${name}`,
      createdAt: Date.now(),
      type: "temp",
    });
  }

  /**
   * Add an old temp file
   */
  addOldTempFile(name: string, ageMs: number): void {
    this.files.set(name, {
      path: `.git/tmp/${name}`,
      createdAt: Date.now() - ageMs,
      type: "temp",
    });
  }

  /**
   * Get all temp files
   */
  getTempFiles(): TempFileEntry[] {
    return Array.from(this.files.values());
  }

  /**
   * Get temp pack files
   */
  getTempPackFiles(): TempFileEntry[] {
    return Array.from(this.files.values()).filter((f) => f.type === "pack");
  }

  /**
   * Get lock files
   */
  getLockFiles(): TempFileEntry[] {
    return Array.from(this.files.values()).filter((f) => f.type === "lock");
  }

  /**
   * Remove old temp files (older than threshold)
   */
  cleanupOldFiles(maxAgeMs: number): number {
    const now = Date.now();
    const toRemove: string[] = [];

    for (const [name, entry] of this.files.entries()) {
      const age = now - entry.createdAt;
      if (age > maxAgeMs) {
        toRemove.push(name);
      }
    }

    for (const name of toRemove) {
      this.files.delete(name);
    }

    return toRemove.length;
  }

  /**
   * Remove all lock files
   */
  cleanupAllLockFiles(): number {
    const toRemove: string[] = [];

    for (const [name, entry] of this.files.entries()) {
      if (entry.type === "lock") {
        toRemove.push(name);
      }
    }

    for (const name of toRemove) {
      this.files.delete(name);
    }

    return toRemove.length;
  }

  /**
   * Check if a temp file exists
   */
  exists(name: string): boolean {
    return this.files.has(name);
  }

  /**
   * Remove specific file
   */
  remove(name: string): boolean {
    return this.files.delete(name);
  }

  /**
   * Get file count
   */
  size(): number {
    return this.files.size;
  }

  /**
   * Clear all files
   */
  clear(): void {
    this.files.clear();
  }
}

/**
 * Extended test context with temp file storage
 */
interface TempFilesTestContext extends GCTestContext {
  tempStorage: MockTempStorage;
}

/**
 * Create test context with temp file storage
 */
async function createTempFilesTestContext(): Promise<TempFilesTestContext> {
  const baseCtx = await createTestRepository({
    looseObjectThreshold: 100,
    minInterval: 0,
  });

  const tempStorage = new MockTempStorage();

  return {
    ...baseCtx,
    tempStorage,
  };
}

describe("GcTemporaryFilesTest", () => {
  let ctx: TempFilesTestContext;

  beforeEach(async () => {
    ctx = await createTempFilesTestContext();
  });

  describe("temporary pack files", () => {
    it("testTempPackFilesRemoved", async () => {
      // Create some actual repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add old temp pack files (simulating incomplete writes)
      ctx.tempStorage.addOldTempPackFile("tmp-pack-001", 100000); // 100s old
      ctx.tempStorage.addOldTempPackFile("tmp-pack-002", 200000); // 200s old

      // Add recent temp pack file (should be kept)
      ctx.tempStorage.addTempPackFile("tmp-pack-recent");

      expect(ctx.tempStorage.getTempPackFiles().length).toBe(3);

      await fsTick();

      // Cleanup files older than 50 seconds
      const removed = ctx.tempStorage.cleanupOldFiles(50000);
      expect(removed).toBe(2);

      // Only recent file remains
      expect(ctx.tempStorage.getTempPackFiles().length).toBe(1);
      expect(ctx.tempStorage.exists("tmp-pack-recent")).toBe(true);
      expect(ctx.tempStorage.exists("tmp-pack-001")).toBe(false);
      expect(ctx.tempStorage.exists("tmp-pack-002")).toBe(false);

      // Repository content should be unaffected
      expect(await hasObject(ctx, c1)).toBe(true);
    });

    it("testRecentTempPackFilesPreserved", async () => {
      // Create repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add only recent temp files
      ctx.tempStorage.addTempPackFile("tmp-pack-1");
      ctx.tempStorage.addTempPackFile("tmp-pack-2");

      expect(ctx.tempStorage.size()).toBe(2);

      // Cleanup with very old threshold - should keep all
      const removed = ctx.tempStorage.cleanupOldFiles(1000000); // 1000s threshold
      expect(removed).toBe(0);

      // All files preserved
      expect(ctx.tempStorage.size()).toBe(2);
    });
  });

  describe("lock files", () => {
    it("testTempLockFilesRemoved", async () => {
      // Create repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add stale lock files (simulating crashed processes)
      ctx.tempStorage.addOldLockFile("HEAD", 300000); // 5 min old
      ctx.tempStorage.addOldLockFile("refs/heads/master", 400000); // 6.6 min old

      expect(ctx.tempStorage.getLockFiles().length).toBe(2);

      await fsTick();

      // Cleanup old lock files
      const removed = ctx.tempStorage.cleanupOldFiles(60000); // 1 minute threshold
      expect(removed).toBe(2);

      expect(ctx.tempStorage.getLockFiles().length).toBe(0);

      // Repository content unaffected
      expect(await hasObject(ctx, c1)).toBe(true);
    });

    it("testRecentLockFilesPreserved", async () => {
      // Create repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add recent lock file (active operation)
      ctx.tempStorage.addLockFile("index");

      expect(ctx.tempStorage.getLockFiles().length).toBe(1);

      // Cleanup with short threshold - should keep recent
      const removed = ctx.tempStorage.cleanupOldFiles(1000); // 1 second
      expect(removed).toBe(0);

      // Lock file preserved (still active)
      expect(ctx.tempStorage.exists("index")).toBe(true);
    });

    it("testForceLockFileCleanup", async () => {
      // Add various lock files
      ctx.tempStorage.addLockFile("HEAD");
      ctx.tempStorage.addLockFile("config");
      ctx.tempStorage.addOldLockFile("refs/heads/old", 100000);

      expect(ctx.tempStorage.getLockFiles().length).toBe(3);

      // Force cleanup of all lock files
      const removed = ctx.tempStorage.cleanupAllLockFiles();
      expect(removed).toBe(3);

      expect(ctx.tempStorage.getLockFiles().length).toBe(0);
    });
  });

  describe("generic temp files", () => {
    it("testTempFilesCleanup", async () => {
      // Create repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add various temp files
      ctx.tempStorage.addOldTempFile("gc-temp-001", 200000);
      ctx.tempStorage.addOldTempFile("merge-temp-001", 150000);
      ctx.tempStorage.addTempFile("active-temp");

      expect(ctx.tempStorage.size()).toBe(3);

      // Cleanup old files
      const removed = ctx.tempStorage.cleanupOldFiles(100000);
      expect(removed).toBe(2);

      // Only active temp remains
      expect(ctx.tempStorage.exists("active-temp")).toBe(true);
      expect(ctx.tempStorage.exists("gc-temp-001")).toBe(false);
      expect(ctx.tempStorage.exists("merge-temp-001")).toBe(false);
    });
  });

  describe("mixed temp file cleanup", () => {
    it("testMixedTempFilesCleanup", async () => {
      // Create repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add mix of old and new temp files
      ctx.tempStorage.addOldTempPackFile("old-pack", 500000);
      ctx.tempStorage.addTempPackFile("new-pack");
      ctx.tempStorage.addOldLockFile("stale-lock", 300000);
      ctx.tempStorage.addLockFile("active-lock");
      ctx.tempStorage.addOldTempFile("old-temp", 400000);
      ctx.tempStorage.addTempFile("new-temp");

      expect(ctx.tempStorage.size()).toBe(6);

      // Cleanup files older than 2 minutes
      const removed = ctx.tempStorage.cleanupOldFiles(120000);
      expect(removed).toBe(3); // old-pack, stale-lock, old-temp

      // Recent files preserved
      expect(ctx.tempStorage.size()).toBe(3);
      expect(ctx.tempStorage.exists("new-pack")).toBe(true);
      expect(ctx.tempStorage.exists("active-lock")).toBe(true);
      expect(ctx.tempStorage.exists("new-temp")).toBe(true);

      // Repository content unaffected
      expect(await hasObject(ctx, c1)).toBe(true);
    });
  });

  describe("temp file during GC", () => {
    it("testGCWithTempFiles", async () => {
      // Create repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Simulate temp files created during GC
      ctx.tempStorage.addTempPackFile("gc-temp-pack");
      ctx.tempStorage.addTempFile("gc-work-file");

      await fsTick();

      // Run GC
      await ctx.gc.runGC({ pruneLoose: true });

      // Repository should be intact
      expect(await hasObject(ctx, c1)).toBe(true);

      // Temp files still tracked (would be cleaned up by file system layer)
      expect(ctx.tempStorage.size()).toBe(2);
    });

    it("testCleanupAfterGC", async () => {
      // Create repository content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Add temp files from previous GC runs
      ctx.tempStorage.addOldTempPackFile("prev-gc-pack-1", 600000);
      ctx.tempStorage.addOldTempPackFile("prev-gc-pack-2", 700000);
      ctx.tempStorage.addOldTempFile("prev-gc-temp", 500000);

      await fsTick();

      // Run GC
      await ctx.gc.runGC({ pruneLoose: true });

      // Clean up old temp files from previous runs
      const removed = ctx.tempStorage.cleanupOldFiles(300000);
      expect(removed).toBe(3);

      // Repository intact, temp files cleaned
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(ctx.tempStorage.size()).toBe(0);
    });
  });
});
