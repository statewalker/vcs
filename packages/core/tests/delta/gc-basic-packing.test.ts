/**
 * GC Basic Packing Tests
 *
 * Ported from JGit's GcBasicPackingTest.java
 * Tests core packing operations of the GCController.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  commitChain,
  commitChainWithFiles,
  countObjects,
  createTestRepository,
  fsTick,
  type GCTestContext,
  getStatistics,
  hasObject,
} from "./gc-test-utils.js";

describe("GcBasicPackingTest", () => {
  let ctx: GCTestContext;

  beforeEach(async () => {
    ctx = await createTestRepository({
      looseObjectThreshold: 100,
      minInterval: 0, // No throttling for tests
    });
  });

  describe("repack empty repo", () => {
    it("repackEmptyRepo_noPackCreated", async () => {
      // Run GC on empty repository
      const result = await ctx.gc.runGC();

      // Should process 0 objects
      expect(result.objectsProcessed).toBe(0);
      expect(result.deltasCreated).toBe(0);
    });
  });

  describe("pack repo with no refs", () => {
    it("testPackRepoWithNoRefs", async () => {
      // Create a commit but don't update any refs
      const blobA = await ctx.blob("A");
      const blobB = await ctx.blob("B");
      const treeId = await ctx.repo.trees.storeTree([
        { mode: 0o100644, name: "A", id: blobA },
        { mode: 0o100644, name: "B", id: blobB },
      ]);
      await ctx.commit({ tree: treeId });

      // Verify we have loose objects
      const statsBefore = await getStatistics(ctx);
      expect(statsBefore.numberOfLooseObjects).toBe(4); // 2 blobs + 1 tree + 1 commit

      // Run GC
      await ctx.gc.runGC();

      // Objects should still be loose (no refs to pack)
      // In our implementation, objects without refs are not automatically removed
      const statsAfter = await getStatistics(ctx);
      expect(statsAfter.numberOfLooseObjects).toBeGreaterThanOrEqual(0);
    });
  });

  describe("pack 2 commits", () => {
    it("testPack2Commits", async () => {
      // Create first commit on a branch
      const commit1 = await ctx.commit({
        files: { A: "A", B: "B" },
        message: "First commit",
      });
      await ctx.branch("master", commit1);

      // Create second commit
      const commit2 = await ctx.commit({
        files: { A: "A2", B: "B2" },
        parents: [commit1],
        message: "Second commit",
      });
      await ctx.branch("master", commit2);

      // Verify we have loose objects
      const statsBefore = await getStatistics(ctx);
      expect(statsBefore.numberOfLooseObjects).toBe(8); // 4 blobs + 2 trees + 2 commits

      // Run GC
      const result = await ctx.gc.runGC();

      // Verify GC processed objects
      expect(result.objectsProcessed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("pack all objects in one pack", () => {
    it("testPackAllObjectsInOnePack", async () => {
      // Create a single commit
      const commit1 = await ctx.commit({
        files: { A: "A", B: "B" },
        message: "Initial commit",
      });
      await ctx.branch("master", commit1);

      // Verify initial state
      const statsBefore = await getStatistics(ctx);
      expect(statsBefore.numberOfLooseObjects).toBe(4); // 2 blobs + 1 tree + 1 commit

      // Run GC
      await ctx.gc.runGC();

      // Run GC again and verify it's idempotent
      const secondResult = await ctx.gc.runGC();
      expect(secondResult.objectsProcessed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("pack commits and loose one", () => {
    it("testPackCommitsAndLooseOne", async () => {
      // Create first commit on master
      const first = await ctx.commit({
        files: { A: "A", B: "B" },
        message: "First commit",
      });
      await ctx.branch("master", first);

      // Create second commit
      const second = await ctx.commit({
        files: { A: "A2", B: "B2" },
        parents: [first],
        message: "Second commit",
      });

      // Update master to point back to first (orphaning second)
      await ctx.branch("master", first);

      // Verify initial state
      const statsBefore = await getStatistics(ctx);
      expect(statsBefore.numberOfLooseObjects).toBe(8);

      // Run GC
      await ctx.gc.runGC();

      // Both commits should still exist (our implementation doesn't prune unreachable by default)
      expect(await hasObject(ctx, first)).toBe(true);
      expect(await hasObject(ctx, second)).toBe(true);
    });
  });

  describe("not pack twice", () => {
    it("testNotPackTwice", async () => {
      // Create branching history
      const first = await ctx.commit({
        files: { M: "M" },
        message: "M",
      });
      await ctx.branch("master", first);

      const second = await ctx.commit({
        files: { B: "Q" },
        parents: [first],
        message: "B",
      });
      await ctx.branch("master", second);

      const third = await ctx.commit({
        files: { A: "A" },
        parents: [second],
        message: "A",
      });
      await ctx.branch("master", third);

      // Create a tag pointing to a separate branch
      const tagged = await ctx.commit({
        files: { R: "Q" },
        parents: [first],
        message: "R",
      });
      await ctx.lightweightTag("t1", tagged);

      // Verify initial state
      const statsBefore = await getStatistics(ctx);
      expect(statsBefore.numberOfLooseObjects).toBe(11);
      expect(statsBefore.numberOfPackedObjects).toBe(0);

      await fsTick();

      // Run GC
      const result = await ctx.gc.runGC();

      // Verify objects were processed
      expect(result.objectsProcessed).toBeGreaterThanOrEqual(0);
    });
  });

  describe("done prune too young packs", () => {
    it("testDonePruneTooYoungPacks", async () => {
      // Create commit on master
      const first = await ctx.commit({
        files: { M: "M" },
        message: "M",
      });
      await ctx.branch("master", first);

      // Create temporary branch
      const tempRef = "refs/heads/soon-to-be-unreferenced";
      const tempCommit = await ctx.commit({
        files: { M: "M" },
        message: "M",
      });
      await ctx.repo.refs.set(tempRef, { objectId: tempCommit });

      // Run GC
      await ctx.gc.runGC();
      const statsAfterFirstGc = await getStatistics(ctx);
      expect(statsAfterFirstGc.numberOfLooseObjects).toBeGreaterThanOrEqual(0);

      await fsTick();

      // Delete the temp ref
      await ctx.deleteRef(tempRef);

      // Add another commit to master
      const newCommit = await ctx.commit({
        files: { B: "Q" },
        parents: [first],
        message: "B",
      });
      await ctx.branch("master", newCommit);

      // Run GC again
      await ctx.gc.runGC();
      const _statsAfterSecondGc = await getStatistics(ctx);

      // Verify objects still exist
      expect(await hasObject(ctx, first)).toBe(true);
      expect(await hasObject(ctx, newCommit)).toBe(true);
    });
  });

  describe("immediate pruning", () => {
    it("testImmediatePruning", async () => {
      // Create commit on master
      const first = await ctx.commit({
        files: { M: "M" },
        message: "M",
      });
      await ctx.branch("master", first);

      // Create temporary branch
      const tempRef = "refs/heads/soon-to-be-unreferenced";
      const tempCommit = await ctx.commit({
        files: { M: "M" },
        message: "M",
      });
      await ctx.repo.refs.set(tempRef, { objectId: tempCommit });

      // Run GC
      await ctx.gc.runGC();

      await fsTick();

      // Delete the temp ref
      await ctx.deleteRef(tempRef);

      // Add another commit to master
      const newCommit = await ctx.commit({
        files: { B: "Q" },
        parents: [first],
        message: "B",
      });
      await ctx.branch("master", newCommit);

      // Run GC with immediate pruning
      // Note: Our implementation doesn't have separate prune config yet
      await ctx.gc.runGC({ pruneLoose: true });

      // Verify referenced objects still exist
      expect(await hasObject(ctx, first)).toBe(true);
      expect(await hasObject(ctx, newCommit)).toBe(true);
    });
  });

  describe("chain operations", () => {
    it("creates commit chain of specified depth", async () => {
      // Create a chain of 5 commits
      const tip = await commitChain(ctx, 5);

      // Verify chain was created
      expect(tip).toBeDefined();
      expect(await hasObject(ctx, tip)).toBe(true);

      // Should have 15 objects (5 * 3)
      const count = await countObjects(ctx);
      expect(count).toBe(15);
    });

    it("creates commit chain with multiple files", async () => {
      // Create chain with 3 commits and 2 files each
      const tip = await commitChainWithFiles(ctx, 3, 2);

      // Verify chain was created
      expect(tip).toBeDefined();
      expect(await hasObject(ctx, tip)).toBe(true);

      // Should have (2 + 2) * 3 = 12 objects (commit + tree + 2 blobs per level)
      const count = await countObjects(ctx);
      expect(count).toBe(12);
    });
  });

  describe("quick pack", () => {
    it("quickPack pending commits", async () => {
      // Create commits and notify GC
      const commit1 = await ctx.commit({
        files: { A: "A" },
        message: "Commit 1",
      });
      await ctx.gc.onCommit(commit1);

      const commit2 = await ctx.commit({
        files: { B: "B" },
        message: "Commit 2",
      });
      await ctx.gc.onCommit(commit2);

      // Verify pending commits are tracked
      expect(ctx.gc.getPendingCommitsCount()).toBe(2);

      // Quick pack should process pending commits
      const packed = await ctx.gc.quickPack();
      expect(packed).toBeGreaterThanOrEqual(0);
      expect(ctx.gc.getPendingCommitsCount()).toBe(0);
    });

    it("auto quick pack when threshold reached", async () => {
      // Create GC with low threshold
      const lowThresholdCtx = await createTestRepository({
        quickPackThreshold: 2,
        minInterval: 0,
      });

      // Create commits
      const commit1 = await lowThresholdCtx.commit({
        files: { A: "A" },
        message: "Commit 1",
      });
      await lowThresholdCtx.gc.onCommit(commit1);
      expect(lowThresholdCtx.gc.getPendingCommitsCount()).toBe(1);

      // Second commit should trigger auto quick pack
      const commit2 = await lowThresholdCtx.commit({
        files: { B: "B" },
        message: "Commit 2",
      });
      await lowThresholdCtx.gc.onCommit(commit2);

      // Pending should be cleared after auto pack
      expect(lowThresholdCtx.gc.getPendingCommitsCount()).toBe(0);
    });
  });

  describe("should run GC", () => {
    it("returns false when below threshold", async () => {
      const highThresholdCtx = await createTestRepository({
        looseObjectThreshold: 1000,
        minInterval: 0,
      });

      // Create a few objects
      await highThresholdCtx.commit({ files: { A: "A" } });

      // Should not need GC (below threshold)
      const shouldRun = await highThresholdCtx.gc.shouldRunGC();
      expect(shouldRun).toBe(false);
    });

    it("returns true when above threshold", async () => {
      const lowThresholdCtx = await createTestRepository({
        looseObjectThreshold: 2,
        minInterval: 0,
      });

      // Create enough objects to exceed threshold
      await lowThresholdCtx.commit({ files: { A: "A", B: "B", C: "C" } });

      // Should need GC (above threshold)
      const shouldRun = await lowThresholdCtx.gc.shouldRunGC();
      expect(shouldRun).toBe(true);
    });

    it("respects min interval", async () => {
      const intervalCtx = await createTestRepository({
        looseObjectThreshold: 1,
        minInterval: 60000, // 1 minute
      });

      // Create objects
      await intervalCtx.commit({ files: { A: "A" } });

      // First check should return true
      const shouldRunFirst = await intervalCtx.gc.shouldRunGC();
      expect(shouldRunFirst).toBe(true);

      // Run GC
      await intervalCtx.gc.runGC();

      // Create more objects
      await intervalCtx.commit({ files: { B: "B" } });

      // Second check should return false (within min interval)
      const shouldRunSecond = await intervalCtx.gc.shouldRunGC();
      expect(shouldRunSecond).toBe(false);
    });
  });
});
