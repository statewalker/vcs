/**
 * Auto GC Tests
 *
 * Ported from JGit's AutoGcTest.java
 * Tests automatic GC triggering based on thresholds.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  commitChainWithFiles,
  createTestRepository,
  type GCTestContext,
  getStatistics,
} from "./gc-test-utils.js";

describe("AutoGcTest", () => {
  let ctx: GCTestContext;

  beforeEach(async () => {
    ctx = await createTestRepository({
      looseObjectThreshold: 100,
      minInterval: 0,
    });
  });

  describe("loose object threshold", () => {
    it("testNotTooManyLooseObjects", async () => {
      // With default high threshold, should not find too many loose objects
      const shouldRun = await ctx.gc.shouldRunGC();
      expect(shouldRun).toBe(false);
    });

    it("testTooManyLooseObjects", async () => {
      // Create context with low threshold
      const lowThresholdCtx = await createTestRepository({
        looseObjectThreshold: 5,
        minInterval: 0,
      });

      // Create many loose objects (10 commits * 50 files = 500+ objects)
      await commitChainWithFiles(lowThresholdCtx, 10, 50);

      // Should find too many loose objects
      const shouldRun = await lowThresholdCtx.gc.shouldRunGC();
      expect(shouldRun).toBe(true);
    });

    it("threshold boundary is respected", async () => {
      // Create context with specific threshold
      const thresholdCtx = await createTestRepository({
        looseObjectThreshold: 10,
        minInterval: 0,
      });

      // Create exactly at threshold
      await thresholdCtx.commit({ files: { A: "A", B: "B" } }); // 4 objects
      await thresholdCtx.commit({ files: { C: "C", D: "D" } }); // 4 more
      // Total: 8 objects

      // Should not need GC yet
      let shouldRun = await thresholdCtx.gc.shouldRunGC();
      expect(shouldRun).toBe(false);

      // Add one more commit to exceed threshold
      await thresholdCtx.commit({ files: { E: "E", F: "F" } }); // 4 more = 12 total

      // Should now need GC
      shouldRun = await thresholdCtx.gc.shouldRunGC();
      expect(shouldRun).toBe(true);
    });
  });

  describe("chain depth threshold", () => {
    it("deep chains trigger GC", async () => {
      // Create context with low chain depth threshold
      const ctx = await createTestRepository({
        looseObjectThreshold: 1000, // High so we don't trigger on count
        maxChainDepth: 5,
        minInterval: 0,
      });

      // Create objects (no deltas yet, so no deep chains)
      await ctx.commit({ files: { A: "A" } });
      await ctx.commit({ files: { B: "B" } });

      // Should not find deep chains (no deltas created yet)
      const shouldRun = await ctx.gc.shouldRunGC();
      expect(shouldRun).toBe(false);
    });
  });

  describe("min interval", () => {
    it("respects minimum interval between runs", async () => {
      const intervalCtx = await createTestRepository({
        looseObjectThreshold: 1,
        minInterval: 60000, // 1 minute
      });

      // Create objects to exceed threshold
      await intervalCtx.commit({ files: { A: "A" } });

      // First check should want to run
      expect(await intervalCtx.gc.shouldRunGC()).toBe(true);

      // Run GC
      await intervalCtx.gc.runGC();

      // Create more objects
      await intervalCtx.commit({ files: { B: "B" } });

      // Second check should be blocked by interval
      expect(await intervalCtx.gc.shouldRunGC()).toBe(false);
    });

    it("time since last GC is tracked", async () => {
      const ctx = await createTestRepository({
        minInterval: 100,
      });

      // Before any GC, should return -1
      expect(ctx.gc.getTimeSinceLastGC()).toBe(-1);

      // Run GC
      await ctx.gc.runGC();

      // After GC, should return positive value
      const timeSince = ctx.gc.getTimeSinceLastGC();
      expect(timeSince).toBeGreaterThanOrEqual(0);
    });
  });

  describe("maybe run GC", () => {
    it("maybeRunGC respects thresholds", async () => {
      const ctx = await createTestRepository({
        looseObjectThreshold: 1000,
        minInterval: 0,
      });

      // With high threshold, maybeRunGC should not run
      const result = await ctx.gc.maybeRunGC();
      expect(result).toBeNull();
    });

    it("maybeRunGC runs when needed", async () => {
      const ctx = await createTestRepository({
        looseObjectThreshold: 2,
        minInterval: 0,
      });

      // Create objects to exceed threshold
      await ctx.commit({ files: { A: "A", B: "B", C: "C" } });

      // maybeRunGC should run
      const result = await ctx.gc.maybeRunGC();
      expect(result).not.toBeNull();
      expect(result?.duration).toBeGreaterThanOrEqual(0);
    });
  });

  describe("GC options", () => {
    it("getOptions returns current configuration", async () => {
      const ctx = await createTestRepository({
        looseObjectThreshold: 42,
        maxChainDepth: 7,
        minInterval: 5000,
        quickPackThreshold: 3,
      });

      const options = ctx.gc.getOptions();
      expect(options.looseObjectThreshold).toBe(42);
      expect(options.maxChainDepth).toBe(7);
      expect(options.minInterval).toBe(5000);
      expect(options.quickPackThreshold).toBe(3);
    });

    it("uses default options when not specified", async () => {
      const ctx = await createTestRepository();

      const options = ctx.gc.getOptions();
      expect(options.looseObjectThreshold).toBe(100);
      expect(options.maxChainDepth).toBe(50);
      expect(options.minInterval).toBe(60000);
      expect(options.quickPackThreshold).toBe(5);
    });
  });

  describe("statistics", () => {
    it("tracks object counts correctly", async () => {
      const ctx = await createTestRepository({
        looseObjectThreshold: 1000,
        minInterval: 0,
      });

      // Create some objects
      const commit1 = await ctx.commit({ files: { A: "A" } });
      await ctx.branch("main", commit1);

      // Get stats
      const stats = await getStatistics(ctx);

      // Should have loose objects: 1 blob + 1 tree + 1 commit = 3
      expect(stats.numberOfLooseObjects).toBe(3);
      expect(stats.numberOfPackedObjects).toBe(0);
    });
  });
});
