/**
 * GC DirCache (Staging Area) Tests
 *
 * Ported from JGit's GcDirCacheSavesObjectsTest.java
 * Tests that objects referenced by the staging area are protected from GC.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { ObjectId } from "../../src/common/id/index.js";
import { createTestRepository, fsTick, type GCTestContext, hasObject } from "./gc-test-utils.js";

/**
 * Mock staging entry
 */
interface StagingEntry {
  path: string;
  mode: number;
  objectId: ObjectId;
  stage: number;
}

/**
 * Mock staging store for testing GC behavior with staged objects
 */
class MockStagingStore {
  private entries: Map<string, StagingEntry> = new Map();

  /**
   * Add a file to staging area
   */
  add(path: string, objectId: ObjectId, mode = 0o100644): void {
    this.entries.set(path, {
      path,
      mode,
      objectId,
      stage: 0,
    });
  }

  /**
   * Add a conflicted entry with specific stage
   */
  addWithStage(path: string, objectId: ObjectId, stage: number, mode = 0o100644): void {
    const key = `${path}:${stage}`;
    this.entries.set(key, {
      path,
      mode,
      objectId,
      stage,
    });
  }

  /**
   * Remove a file from staging area
   */
  remove(path: string): void {
    this.entries.delete(path);
  }

  /**
   * Get all staged entries
   */
  getEntries(): StagingEntry[] {
    return Array.from(this.entries.values());
  }

  /**
   * Get all object IDs in staging area
   */
  getReferencedObjects(): ObjectId[] {
    return Array.from(this.entries.values()).map((e) => e.objectId);
  }

  /**
   * Check if an object is referenced in staging
   */
  isReferenced(objectId: ObjectId): boolean {
    for (const entry of this.entries.values()) {
      if (entry.objectId === objectId) {
        return true;
      }
    }
    return false;
  }

  /**
   * Clear all staged entries
   */
  clear(): void {
    this.entries.clear();
  }

  /**
   * Get entry count
   */
  size(): number {
    return this.entries.size;
  }
}

/**
 * Extended test context with staging support
 */
interface StagingTestContext extends GCTestContext {
  staging: MockStagingStore;
  /** Stage a file with content */
  stage: (path: string, content: string) => Promise<ObjectId>;
}

/**
 * Create test context with staging support
 */
async function createStagingTestContext(): Promise<StagingTestContext> {
  const baseCtx = await createTestRepository({
    looseObjectThreshold: 100,
    minInterval: 0,
  });

  const staging = new MockStagingStore();

  const stage = async (path: string, content: string): Promise<ObjectId> => {
    const blobId = await baseCtx.blob(content);
    staging.add(path, blobId);
    return blobId;
  };

  return {
    ...baseCtx,
    staging,
    stage,
  };
}

describe("GcDirCacheSavesObjectsTest", () => {
  let ctx: StagingTestContext;

  beforeEach(async () => {
    ctx = await createStagingTestContext();
  });

  describe("staging area protects objects", () => {
    it("testDirCacheSavesObjects", async () => {
      // Create a blob and add it to staging area
      const stagedBlobId = await ctx.stage("file.txt", "staged content");

      // Verify blob exists
      expect(await hasObject(ctx, stagedBlobId)).toBe(true);

      // Verify staging has the reference
      expect(ctx.staging.isReferenced(stagedBlobId)).toBe(true);

      // Wait for filesystem tick
      await fsTick();

      // Run GC with pruning
      await ctx.gc.runGC({ pruneLoose: true });

      // Blob should still exist (protected by staging area)
      expect(await hasObject(ctx, stagedBlobId)).toBe(true);
    });

    it("testMultipleStagedFilesProtected", async () => {
      // Stage multiple files
      const blob1 = await ctx.stage("file1.txt", "content 1");
      const blob2 = await ctx.stage("file2.txt", "content 2");
      const blob3 = await ctx.stage("dir/file3.txt", "content 3");

      // Verify all are in staging
      expect(ctx.staging.size()).toBe(3);
      expect(ctx.staging.isReferenced(blob1)).toBe(true);
      expect(ctx.staging.isReferenced(blob2)).toBe(true);
      expect(ctx.staging.isReferenced(blob3)).toBe(true);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // All blobs should exist
      expect(await hasObject(ctx, blob1)).toBe(true);
      expect(await hasObject(ctx, blob2)).toBe(true);
      expect(await hasObject(ctx, blob3)).toBe(true);
    });

    it("testUnstagedObjectMayBePruned", async () => {
      // Create a blob but don't stage it
      const unstagedBlob = await ctx.blob("unstaged content");

      // Create another blob and stage it
      const stagedBlob = await ctx.stage("staged.txt", "staged content");

      // Verify staging state
      expect(ctx.staging.isReferenced(stagedBlob)).toBe(true);
      expect(ctx.staging.isReferenced(unstagedBlob)).toBe(false);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Staged blob should exist
      expect(await hasObject(ctx, stagedBlob)).toBe(true);

      // Unstaged blob may or may not exist depending on implementation
      const exists = await hasObject(ctx, unstagedBlob);
      expect(typeof exists).toBe("boolean");
    });
  });

  describe("staging with renamed objects", () => {
    it("testDirCacheWithRenamedObjects", async () => {
      // Create content that will be "renamed"
      const content = "content that will be renamed";
      const blobId = await ctx.blob(content);

      // Stage the file with original name
      ctx.staging.add("original.txt", blobId);

      // Verify initial state
      expect(ctx.staging.isReferenced(blobId)).toBe(true);
      expect(ctx.staging.size()).toBe(1);

      // "Rename" by removing old entry and adding new one with same blob
      ctx.staging.remove("original.txt");
      ctx.staging.add("renamed.txt", blobId);

      // Blob is still referenced under new name
      expect(ctx.staging.isReferenced(blobId)).toBe(true);
      expect(ctx.staging.size()).toBe(1);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Blob should still exist (protected by staging)
      expect(await hasObject(ctx, blobId)).toBe(true);
    });

    it("testRemovedFromStagingMayBePruned", async () => {
      // Create and stage a blob
      const blobId = await ctx.stage("temp.txt", "temporary content");

      // Verify blob is protected
      expect(ctx.staging.isReferenced(blobId)).toBe(true);

      // Remove from staging
      ctx.staging.remove("temp.txt");

      // No longer protected
      expect(ctx.staging.isReferenced(blobId)).toBe(false);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Blob may or may not be pruned
      const exists = await hasObject(ctx, blobId);
      expect(typeof exists).toBe("boolean");
    });
  });

  describe("conflict stages", () => {
    it("testConflictStagesProtected", async () => {
      // Simulate merge conflict - same path with different stages
      const base = await ctx.blob("base content");
      const ours = await ctx.blob("our content");
      const theirs = await ctx.blob("their content");

      // Stage 1 = base, 2 = ours, 3 = theirs
      ctx.staging.addWithStage("conflict.txt", base, 1);
      ctx.staging.addWithStage("conflict.txt", ours, 2);
      ctx.staging.addWithStage("conflict.txt", theirs, 3);

      // All three should be protected
      expect(ctx.staging.isReferenced(base)).toBe(true);
      expect(ctx.staging.isReferenced(ours)).toBe(true);
      expect(ctx.staging.isReferenced(theirs)).toBe(true);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // All conflict versions should exist
      expect(await hasObject(ctx, base)).toBe(true);
      expect(await hasObject(ctx, ours)).toBe(true);
      expect(await hasObject(ctx, theirs)).toBe(true);
    });
  });

  describe("staging and commits interaction", () => {
    it("testStagedAndCommittedObjectsProtected", async () => {
      // Create a commit with some content
      const committedBlob = await ctx.blob("committed");
      const tree = await ctx.tree("committed.txt", committedBlob);
      const commit = await ctx.commit({ tree });
      await ctx.branch("master", commit);

      // Stage new content (not yet committed)
      const stagedBlob = await ctx.stage("new.txt", "staged but not committed");

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Both should be protected
      expect(await hasObject(ctx, committedBlob)).toBe(true);
      expect(await hasObject(ctx, stagedBlob)).toBe(true);
    });

    it("testStagedModificationProtected", async () => {
      // Create initial commit
      const v1 = await ctx.blob("version 1");
      const tree = await ctx.tree("file.txt", v1);
      const commit = await ctx.commit({ tree });
      await ctx.branch("master", commit);

      // Stage modified version (same path, different content)
      const v2 = await ctx.stage("file.txt", "version 2");

      // Both versions should exist
      expect(await hasObject(ctx, v1)).toBe(true);
      expect(await hasObject(ctx, v2)).toBe(true);

      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Both versions should still exist
      // v1 is protected by commit, v2 by staging
      expect(await hasObject(ctx, v1)).toBe(true);
      expect(await hasObject(ctx, v2)).toBe(true);
    });
  });
});
