/**
 * GC Concurrent Tests
 *
 * Ported from JGit's GcConcurrentTest.java
 * Tests concurrent GC operations and thread safety.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectId } from "../../src/common/id/index.js";
import { createTestRepository, fsTick, type GCTestContext, hasObject } from "./gc-test-utils.js";

/**
 * Lock status for testing concurrent operations
 */
interface LockStatus {
  isLocked: boolean;
  lockedBy: string | null;
  lockedAt: number;
}

/**
 * Mock lock manager for testing concurrent GC operations
 */
class MockLockManager {
  private locks: Map<string, LockStatus> = new Map();

  /**
   * Try to acquire a lock
   */
  tryLock(resource: string, owner: string): boolean {
    const existing = this.locks.get(resource);
    if (existing?.isLocked) {
      return false; // Already locked
    }

    this.locks.set(resource, {
      isLocked: true,
      lockedBy: owner,
      lockedAt: Date.now(),
    });
    return true;
  }

  /**
   * Release a lock
   */
  unlock(resource: string, owner: string): boolean {
    const existing = this.locks.get(resource);
    if (!existing || !existing.isLocked) {
      return false; // Not locked
    }
    if (existing.lockedBy !== owner) {
      return false; // Not owner
    }

    this.locks.set(resource, {
      isLocked: false,
      lockedBy: null,
      lockedAt: 0,
    });
    return true;
  }

  /**
   * Check if a resource is locked
   */
  isLocked(resource: string): boolean {
    const status = this.locks.get(resource);
    return status?.isLocked ?? false;
  }

  /**
   * Get lock owner
   */
  getOwner(resource: string): string | null {
    return this.locks.get(resource)?.lockedBy ?? null;
  }

  /**
   * Force unlock (for cleanup)
   */
  forceUnlock(resource: string): void {
    this.locks.delete(resource);
  }

  /**
   * Clear all locks
   */
  clearAll(): void {
    this.locks.clear();
  }
}

/**
 * Extended test context with lock manager
 */
interface ConcurrentTestContext extends GCTestContext {
  lockManager: MockLockManager;
}

/**
 * Create test context with lock manager
 */
async function createConcurrentTestContext(): Promise<ConcurrentTestContext> {
  const baseCtx = await createTestRepository({
    looseObjectThreshold: 100,
    minInterval: 0,
  });

  const lockManager = new MockLockManager();

  return {
    ...baseCtx,
    lockManager,
  };
}

/**
 * Helper to run operations concurrently
 */
async function runConcurrently<T>(operations: Array<() => Promise<T>>): Promise<T[]> {
  return Promise.all(operations.map((op) => op()));
}

describe("GcConcurrentTest", () => {
  let ctx: ConcurrentTestContext;

  beforeEach(async () => {
    ctx = await createConcurrentTestContext();
  });

  describe("concurrent repack", () => {
    it("testConcurrentRepack", async () => {
      // Create some objects
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });
      await ctx.branch("master", c2);

      await fsTick();

      // Simulate concurrent repack attempts with locking
      const repack1 = async () => {
        if (ctx.lockManager.tryLock("gc", "repack-1")) {
          try {
            await ctx.gc.runGC();
            return "repack-1-success";
          } finally {
            ctx.lockManager.unlock("gc", "repack-1");
          }
        }
        return "repack-1-blocked";
      };

      const repack2 = async () => {
        // Small delay to ensure order
        await new Promise((r) => setTimeout(r, 5));
        if (ctx.lockManager.tryLock("gc", "repack-2")) {
          try {
            await ctx.gc.runGC();
            return "repack-2-success";
          } finally {
            ctx.lockManager.unlock("gc", "repack-2");
          }
        }
        return "repack-2-blocked";
      };

      const results = await runConcurrently([repack1, repack2]);

      // In JS single-threaded event loop, both may complete sequentially
      // At least one should succeed
      const successCount = results.filter((r) => r.endsWith("-success")).length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      // Objects should still be intact
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
    });

    it("testSequentialRepackAfterLockRelease", async () => {
      // Create objects
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // First repack with lock
      expect(ctx.lockManager.tryLock("gc", "first")).toBe(true);
      await ctx.gc.runGC();
      ctx.lockManager.unlock("gc", "first");

      // Second repack should succeed after lock release
      expect(ctx.lockManager.tryLock("gc", "second")).toBe(true);
      await ctx.gc.runGC();
      ctx.lockManager.unlock("gc", "second");

      expect(await hasObject(ctx, c1)).toBe(true);
    });
  });

  describe("concurrent prune", () => {
    it("testConcurrentPrune", async () => {
      // Create objects with some orphans
      const kept = await ctx.commit({ files: { A: "1" }, message: "kept" });
      await ctx.branch("master", kept);
      await ctx.blob("orphan-1");
      await ctx.blob("orphan-2");

      await fsTick();

      // Run concurrent prune operations
      const prune1 = async () => {
        if (ctx.lockManager.tryLock("prune", "prune-1")) {
          try {
            await ctx.gc.runGC({ pruneLoose: true });
            return "prune-1-done";
          } finally {
            ctx.lockManager.unlock("prune", "prune-1");
          }
        }
        return "prune-1-blocked";
      };

      const prune2 = async () => {
        await new Promise((r) => setTimeout(r, 5));
        if (ctx.lockManager.tryLock("prune", "prune-2")) {
          try {
            await ctx.gc.runGC({ pruneLoose: true });
            return "prune-2-done";
          } finally {
            ctx.lockManager.unlock("prune", "prune-2");
          }
        }
        return "prune-2-blocked";
      };

      const results = await runConcurrently([prune1, prune2]);

      // In JS single-threaded event loop, both may complete sequentially
      // At least one should succeed
      const doneCount = results.filter((r) => r.endsWith("-done")).length;
      expect(doneCount).toBeGreaterThanOrEqual(1);

      // Referenced object intact
      expect(await hasObject(ctx, kept)).toBe(true);
    });

    it("testPruneDoesNotCorruptData", async () => {
      // Create a chain of commits
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      const c2 = await ctx.commit({
        files: { A: "2", B: "B" },
        parents: [c1],
        message: "c2",
      });
      const c3 = await ctx.commit({
        files: { A: "3", B: "B", C: "C" },
        parents: [c2],
        message: "c3",
      });
      await ctx.branch("master", c3);

      await fsTick();

      // Run multiple prune operations sequentially
      for (let i = 0; i < 3; i++) {
        await ctx.gc.runGC({ pruneLoose: true });
        await fsTick();
      }

      // All commits should still be reachable
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
      expect(await hasObject(ctx, c3)).toBe(true);

      // Verify commit chain is intact
      const commit3 = await ctx.repo.commits.loadCommit(c3);
      expect(commit3.parents[0]).toBe(c2);

      const commit2 = await ctx.repo.commits.loadCommit(c2);
      expect(commit2.parents[0]).toBe(c1);
    });
  });

  describe("concurrent pack and prune", () => {
    it("testConcurrentPackAndPrune", async () => {
      // Create objects
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Create orphan
      await ctx.blob("orphan");

      await fsTick();

      // One operation packs, another prunes
      const pack = async () => {
        if (ctx.lockManager.tryLock("gc", "packer")) {
          try {
            await ctx.gc.runGC({ pruneLoose: false });
            return "pack-done";
          } finally {
            ctx.lockManager.unlock("gc", "packer");
          }
        }
        return "pack-blocked";
      };

      const prune = async () => {
        await new Promise((r) => setTimeout(r, 5));
        if (ctx.lockManager.tryLock("gc", "pruner")) {
          try {
            await ctx.gc.runGC({ pruneLoose: true });
            return "prune-done";
          } finally {
            ctx.lockManager.unlock("gc", "pruner");
          }
        }
        return "prune-blocked";
      };

      const results = await runConcurrently([pack, prune]);

      // In JS single-threaded event loop, both may complete sequentially
      // At least one should succeed
      const doneCount = results.filter((r) => r.endsWith("-done")).length;
      expect(doneCount).toBeGreaterThanOrEqual(1);

      // Referenced object intact
      expect(await hasObject(ctx, c1)).toBe(true);
    });
  });

  describe("concurrent quick pack", () => {
    it("testConcurrentQuickPack", async () => {
      // Create commits for quick pack
      const commits: ObjectId[] = [];
      for (let i = 0; i < 5; i++) {
        const c = await ctx.commit({ files: { A: String(i) }, message: `c${i}` });
        commits.push(c);
        await ctx.gc.onCommit(c);
      }

      await ctx.branch("master", commits[commits.length - 1]);

      // Run concurrent quick packs
      const qp1 = async () => {
        if (ctx.lockManager.tryLock("quickpack", "qp-1")) {
          try {
            await ctx.gc.quickPack();
            return "qp-1-done";
          } finally {
            ctx.lockManager.unlock("quickpack", "qp-1");
          }
        }
        return "qp-1-blocked";
      };

      const qp2 = async () => {
        if (ctx.lockManager.tryLock("quickpack", "qp-2")) {
          try {
            await ctx.gc.quickPack();
            return "qp-2-done";
          } finally {
            ctx.lockManager.unlock("quickpack", "qp-2");
          }
        }
        return "qp-2-blocked";
      };

      const results = await runConcurrently([qp1, qp2]);

      // One should succeed
      expect(results.filter((r) => r.endsWith("-done")).length).toBeGreaterThan(0);

      // All commits should exist
      for (const c of commits) {
        expect(await hasObject(ctx, c)).toBe(true);
      }
    });
  });

  describe("concurrent GC runs", () => {
    it("testConcurrentGCRuns", async () => {
      // Create a complex repository
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });
      await ctx.branch("master", c2);

      const c3 = await ctx.commit({
        files: { B: "1" },
        parents: [c1],
        message: "c3",
      });
      await ctx.branch("feature", c3);

      await fsTick();

      // Multiple GC attempts
      const gc1 = async () => {
        if (ctx.lockManager.tryLock("full-gc", "gc-1")) {
          try {
            await ctx.gc.runGC({ pruneLoose: true });
            return "gc-1-complete";
          } finally {
            ctx.lockManager.unlock("full-gc", "gc-1");
          }
        }
        return "gc-1-skipped";
      };

      const gc2 = async () => {
        await new Promise((r) => setTimeout(r, 2));
        if (ctx.lockManager.tryLock("full-gc", "gc-2")) {
          try {
            await ctx.gc.runGC({ pruneLoose: true });
            return "gc-2-complete";
          } finally {
            ctx.lockManager.unlock("full-gc", "gc-2");
          }
        }
        return "gc-2-skipped";
      };

      const gc3 = async () => {
        await new Promise((r) => setTimeout(r, 4));
        if (ctx.lockManager.tryLock("full-gc", "gc-3")) {
          try {
            await ctx.gc.runGC({ pruneLoose: true });
            return "gc-3-complete";
          } finally {
            ctx.lockManager.unlock("full-gc", "gc-3");
          }
        }
        return "gc-3-skipped";
      };

      const results = await runConcurrently([gc1, gc2, gc3]);

      // At least one should complete
      const completed = results.filter((r) => r.endsWith("-complete"));
      expect(completed.length).toBeGreaterThanOrEqual(1);

      // All branches should be intact
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
      expect(await hasObject(ctx, c3)).toBe(true);
    });

    it("testGCWithConcurrentCommits", async () => {
      // Initial commit
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      await fsTick();

      // GC and commit happening concurrently
      const gcOp = async () => {
        if (ctx.lockManager.tryLock("gc", "gc-thread")) {
          try {
            await ctx.gc.runGC({ pruneLoose: true });
            return "gc-done";
          } finally {
            ctx.lockManager.unlock("gc", "gc-thread");
          }
        }
        return "gc-blocked";
      };

      const commitOp = async () => {
        // Commits don't need to wait for GC lock
        const c2 = await ctx.commit({
          files: { A: "2" },
          parents: [c1],
          message: "c2",
        });
        await ctx.branch("master", c2);
        return c2;
      };

      const [gcResult, newCommitId] = await runConcurrently([gcOp, commitOp]);

      expect(gcResult).toBe("gc-done");
      expect(newCommitId).toBeDefined();

      // Both commits should exist
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, newCommitId as ObjectId)).toBe(true);
    });
  });

  describe("lock timeout handling", () => {
    it("testLockTimeoutHandling", async () => {
      // Create content
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);

      // Acquire lock and hold it
      expect(ctx.lockManager.tryLock("gc", "holder")).toBe(true);

      // Another operation tries to get the lock
      const blocked = !ctx.lockManager.tryLock("gc", "waiter");
      expect(blocked).toBe(true);

      // Simulate timeout - force release stale lock
      ctx.lockManager.forceUnlock("gc");

      // Now waiter can proceed
      expect(ctx.lockManager.tryLock("gc", "waiter")).toBe(true);
      await ctx.gc.runGC();
      ctx.lockManager.unlock("gc", "waiter");

      // Object intact
      expect(await hasObject(ctx, c1)).toBe(true);
    });
  });

  describe("data integrity under concurrency", () => {
    it("testDataIntegrityUnderConcurrency", async () => {
      // Create a complex commit graph
      const base = await ctx.commit({ files: { A: "base" }, message: "base" });

      const branch1 = await ctx.commit({
        files: { A: "b1", B: "B" },
        parents: [base],
        message: "branch1",
      });

      const branch2 = await ctx.commit({
        files: { A: "b2", C: "C" },
        parents: [base],
        message: "branch2",
      });

      // Merge commit
      const merge = await ctx.commit({
        files: { A: "merged", B: "B", C: "C" },
        parents: [branch1, branch2],
        message: "merge",
      });

      await ctx.branch("master", merge);
      await ctx.branch("feature", branch2);

      await fsTick();

      // Run multiple GC operations
      for (let i = 0; i < 5; i++) {
        await ctx.gc.runGC({ pruneLoose: i % 2 === 0 });
        await fsTick();
      }

      // Verify entire graph is intact
      expect(await hasObject(ctx, base)).toBe(true);
      expect(await hasObject(ctx, branch1)).toBe(true);
      expect(await hasObject(ctx, branch2)).toBe(true);
      expect(await hasObject(ctx, merge)).toBe(true);

      // Verify commit relationships
      const mergeCommit = await ctx.repo.commits.loadCommit(merge);
      expect(mergeCommit.parents).toContain(branch1);
      expect(mergeCommit.parents).toContain(branch2);

      const b1Commit = await ctx.repo.commits.loadCommit(branch1);
      expect(b1Commit.parents[0]).toBe(base);

      const b2Commit = await ctx.repo.commits.loadCommit(branch2);
      expect(b2Commit.parents[0]).toBe(base);
    });
  });
});
