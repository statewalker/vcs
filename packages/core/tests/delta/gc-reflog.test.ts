/**
 * GC Reflog Tests
 *
 * Ported from JGit's GcReflogTest.java
 * Tests that reflog entries protect referenced objects from GC.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectId } from "../../src/id/index.js";
import { createTestRepository, fsTick, type GCTestContext, hasObject } from "./gc-test-utils.js";

/**
 * Mock reflog entry
 */
interface ReflogEntry {
  oldId: ObjectId | null;
  newId: ObjectId;
  timestamp: number;
  message: string;
}

/**
 * Mock reflog store for testing GC behavior with reflogs
 */
class MockReflogStore {
  private entries: Map<string, ReflogEntry[]> = new Map();

  /**
   * Add a reflog entry for a ref
   */
  addEntry(refName: string, entry: ReflogEntry): void {
    if (!this.entries.has(refName)) {
      this.entries.set(refName, []);
    }
    const refEntries = this.entries.get(refName);
    if (refEntries) {
      refEntries.push(entry);
    }
  }

  /**
   * Get all entries for a ref
   */
  getEntries(refName: string): ReflogEntry[] {
    return this.entries.get(refName) ?? [];
  }

  /**
   * Get all object IDs referenced by reflog entries
   */
  getReferencedObjects(): ObjectId[] {
    const objects: ObjectId[] = [];
    for (const entries of this.entries.values()) {
      for (const entry of entries) {
        if (entry.oldId) objects.push(entry.oldId);
        objects.push(entry.newId);
      }
    }
    return objects;
  }

  /**
   * Expire entries older than given timestamp
   */
  expire(beforeTimestamp: number): number {
    let removed = 0;
    for (const [refName, entries] of this.entries.entries()) {
      const remaining = entries.filter((e) => e.timestamp >= beforeTimestamp);
      removed += entries.length - remaining.length;
      this.entries.set(refName, remaining);
    }
    return removed;
  }

  /**
   * Clear all entries for a ref
   */
  clear(refName: string): void {
    this.entries.delete(refName);
  }

  /**
   * Check if an object ID is referenced by any reflog entry
   */
  isReferenced(objectId: ObjectId): boolean {
    for (const entries of this.entries.values()) {
      for (const entry of entries) {
        if (entry.oldId === objectId || entry.newId === objectId) {
          return true;
        }
      }
    }
    return false;
  }
}

/**
 * Extended test context with reflog support
 */
interface ReflogTestContext extends GCTestContext {
  reflog: MockReflogStore;
  /** Create reflog entry for a ref update */
  logRefUpdate: (refName: string, oldId: ObjectId | null, newId: ObjectId, message: string) => void;
}

/**
 * Create test context with reflog support
 */
async function createReflogTestContext(): Promise<ReflogTestContext> {
  const baseCtx = await createTestRepository({
    looseObjectThreshold: 100,
    minInterval: 0,
  });

  const reflog = new MockReflogStore();

  const logRefUpdate = (
    refName: string,
    oldId: ObjectId | null,
    newId: ObjectId,
    message: string,
  ): void => {
    reflog.addEntry(refName, {
      oldId,
      newId,
      timestamp: Date.now(),
      message,
    });
  };

  return {
    ...baseCtx,
    reflog,
    logRefUpdate,
  };
}

describe("GcReflogTest", () => {
  let ctx: ReflogTestContext;

  beforeEach(async () => {
    ctx = await createReflogTestContext();
  });

  describe("reflog protects objects", () => {
    it("testReflogProtectsObjects", async () => {
      // Create first commit
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("master", c1);
      ctx.logRefUpdate("refs/heads/master", null, c1, "initial commit");

      // Create second commit
      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });
      await ctx.branch("master", c2);
      ctx.logRefUpdate("refs/heads/master", c1, c2, "second commit");

      // Create third commit (overwriting c2)
      const c3 = await ctx.commit({
        files: { A: "3" },
        parents: [c1],
        message: "c3",
      });
      await ctx.branch("master", c3);
      ctx.logRefUpdate("refs/heads/master", c2, c3, "third commit");

      // c2 is no longer pointed to by any ref, but is in reflog
      await fsTick();

      // Verify reflog has the reference
      expect(ctx.reflog.isReferenced(c2)).toBe(true);

      // Run GC - objects in reflog should be protected
      await ctx.gc.runGC({ pruneLoose: true });

      // All commits should exist (c2 protected by reflog)
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
      expect(await hasObject(ctx, c3)).toBe(true);
    });

    it("testHeadReflogProtectsCommits", async () => {
      // Create commit chain with HEAD reflog tracking
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      ctx.logRefUpdate("HEAD", null, c1, "commit: c1");

      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });
      ctx.logRefUpdate("HEAD", c1, c2, "commit: c2");

      // Only c2 is on a branch, c1 only in HEAD reflog
      await ctx.branch("master", c2);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Both commits should exist (c1 protected by HEAD reflog)
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
    });
  });

  describe("expired reflog entries pruned", () => {
    it("testExpiredReflogEntriesPruned", async () => {
      // Create commits with timestamps
      const oldTime = Date.now() - 100000; // 100 seconds ago
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });

      // Add old reflog entry
      ctx.reflog.addEntry("refs/heads/master", {
        oldId: null,
        newId: c1,
        timestamp: oldTime,
        message: "old commit",
      });

      // Verify entry exists
      const entriesBefore = ctx.reflog.getEntries("refs/heads/master");
      expect(entriesBefore.length).toBe(1);

      // Expire old entries (anything older than 50 seconds)
      const expireTime = Date.now() - 50000;
      const expired = ctx.reflog.expire(expireTime);

      expect(expired).toBe(1);

      // Entry should be removed
      const entriesAfter = ctx.reflog.getEntries("refs/heads/master");
      expect(entriesAfter.length).toBe(0);

      // c1 is no longer protected by reflog
      expect(ctx.reflog.isReferenced(c1)).toBe(false);
    });

    it("testRecentReflogEntriesKept", async () => {
      // Create commits
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });

      // Add recent reflog entries
      ctx.logRefUpdate("refs/heads/master", null, c1, "first");
      ctx.logRefUpdate("refs/heads/master", c1, c2, "second");

      // Expire very old entries only
      const veryOld = Date.now() - 1000000;
      const expired = ctx.reflog.expire(veryOld);

      expect(expired).toBe(0);

      // Both entries should remain
      const entries = ctx.reflog.getEntries("refs/heads/master");
      expect(entries.length).toBe(2);

      // Both objects should be protected
      expect(ctx.reflog.isReferenced(c1)).toBe(true);
      expect(ctx.reflog.isReferenced(c2)).toBe(true);
    });
  });

  describe("reflog with branch delete", () => {
    it("testReflogWithBranchDelete", async () => {
      // Create commits on a branch
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      await ctx.branch("feature", c1);
      ctx.logRefUpdate("refs/heads/feature", null, c1, "branch created");

      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });
      await ctx.branch("feature", c2);
      ctx.logRefUpdate("refs/heads/feature", c1, c2, "update feature");

      // Delete the branch but keep reflog
      await ctx.deleteRef("refs/heads/feature");

      // Verify branch is deleted
      const refs = ctx.repo.refs;
      const featureRef = await refs.resolve("refs/heads/feature");
      expect(featureRef).toBeUndefined();

      // But reflog still references the commits
      expect(ctx.reflog.isReferenced(c1)).toBe(true);
      expect(ctx.reflog.isReferenced(c2)).toBe(true);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Objects should still exist (protected by reflog)
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
    });
  });

  describe("reflog expiration configuration", () => {
    it("testReflogExpiration", async () => {
      // Create commits with different ages
      const veryOldTime = Date.now() - 200000;
      const oldTime = Date.now() - 100000;
      const recentTime = Date.now() - 10000;

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

      // Add entries with different timestamps
      ctx.reflog.addEntry("refs/heads/master", {
        oldId: null,
        newId: c1,
        timestamp: veryOldTime,
        message: "very old",
      });
      ctx.reflog.addEntry("refs/heads/master", {
        oldId: c1,
        newId: c2,
        timestamp: oldTime,
        message: "old",
      });
      ctx.reflog.addEntry("refs/heads/master", {
        oldId: c2,
        newId: c3,
        timestamp: recentTime,
        message: "recent",
      });

      // Create branch pointing to c3 so it's not orphaned
      await ctx.branch("master", c3);

      // Expire entries older than 50 seconds
      const expireThreshold = Date.now() - 50000;
      const expired = ctx.reflog.expire(expireThreshold);

      expect(expired).toBe(2); // c1 and c2 entries expired

      // Only c3 entry remains
      const entries = ctx.reflog.getEntries("refs/heads/master");
      expect(entries.length).toBe(1);
      expect(entries[0].newId).toBe(c3);

      // c1 is no longer protected by reflog (its entry was expired)
      expect(ctx.reflog.isReferenced(c1)).toBe(false);
      // c2 is still referenced as oldId in the remaining entry
      expect(ctx.reflog.isReferenced(c2)).toBe(true);
      // c3 is referenced as newId in the remaining entry
      expect(ctx.reflog.isReferenced(c3)).toBe(true);
    });
  });
});
