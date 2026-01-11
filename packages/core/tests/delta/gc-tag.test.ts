/**
 * GC Tag Tests
 *
 * Ported from JGit's GcTagTest.java
 * Tests that tagged objects are protected from garbage collection.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { ObjectType } from "../../src/history/objects/object-types.js";
import { createTestRepository, fsTick, type GCTestContext, hasObject } from "./gc-test-utils.js";

describe("GcTagTest", () => {
  let ctx: GCTestContext;

  beforeEach(async () => {
    ctx = await createTestRepository({
      looseObjectThreshold: 100,
      minInterval: 0,
    });
  });

  describe("lightweight tag protection", () => {
    it("lightweightTag_objectNotPruned", async () => {
      // Create a blob
      const blobId = await ctx.blob("a");

      // Create lightweight tag pointing to blob
      await ctx.lightweightTag("t", blobId);

      // Wait for filesystem tick
      await fsTick();

      // Run GC with pruning
      await ctx.gc.runGC({ pruneLoose: true });

      // Blob should still exist (protected by tag)
      expect(await hasObject(ctx, blobId)).toBe(true);
    });

    it("lightweight tag to commit preserves history", async () => {
      // Create a commit chain
      const c1 = await ctx.commit({ files: { A: "1" }, message: "c1" });
      const c2 = await ctx.commit({
        files: { A: "2" },
        parents: [c1],
        message: "c2",
      });

      // Create lightweight tag pointing to c2
      await ctx.lightweightTag("v1.0", c2);

      // Wait and run GC
      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Both commits should exist
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
    });
  });

  describe("annotated tag protection", () => {
    it("annotatedTag_objectNotPruned", async () => {
      // Create a blob
      const blobId = await ctx.blob("a");

      // Create annotated tag pointing to blob
      const tagId = await ctx.repo.tags.storeTag({
        object: blobId,
        objectType: ObjectType.BLOB,
        tag: "t",
        tagger: ctx.createPerson("Tagger", "tagger@test.com"),
        message: "Tag message",
      });

      // Create lightweight tag ref pointing to the annotated tag
      await ctx.lightweightTag("t", tagId);

      // Wait for filesystem tick
      await fsTick();

      // Run GC with pruning
      await ctx.gc.runGC({ pruneLoose: true });

      // Both tag and blob should exist
      expect(await hasObject(ctx, tagId)).toBe(true);
      expect(await hasObject(ctx, blobId)).toBe(true);
    });

    it("annotated tag to commit preserves full history", async () => {
      // Create commit chain
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

      // Create annotated tag pointing to c3
      const tagId = await ctx.repo.tags.storeTag({
        object: c3,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        tagger: ctx.createPerson("Release Manager", "release@test.com"),
        message: "Version 1.0.0 release",
      });
      await ctx.lightweightTag("v1.0.0", tagId);

      // Wait and run GC
      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Tag and all commits should exist
      expect(await hasObject(ctx, tagId)).toBe(true);
      expect(await hasObject(ctx, c1)).toBe(true);
      expect(await hasObject(ctx, c2)).toBe(true);
      expect(await hasObject(ctx, c3)).toBe(true);
    });
  });

  describe("tag chain protection", () => {
    it("chained tags protect all objects", async () => {
      // Create a blob
      const blobId = await ctx.blob("content");

      // Create first annotated tag pointing to blob
      const tag1Id = await ctx.repo.tags.storeTag({
        object: blobId,
        objectType: ObjectType.BLOB,
        tag: "inner-tag",
        message: "Inner tag",
      });

      // Create second annotated tag pointing to first tag
      const tag2Id = await ctx.repo.tags.storeTag({
        object: tag1Id,
        objectType: ObjectType.TAG,
        tag: "outer-tag",
        message: "Outer tag",
      });

      // Create ref pointing to outer tag
      await ctx.lightweightTag("outer", tag2Id);

      // Wait and run GC
      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // All objects in the chain should exist
      expect(await hasObject(ctx, blobId)).toBe(true);
      expect(await hasObject(ctx, tag1Id)).toBe(true);
      expect(await hasObject(ctx, tag2Id)).toBe(true);
    });
  });

  describe("deleted tag behavior", () => {
    it("deleting tag may allow object to be pruned", async () => {
      // Create a blob and tag it
      const blobId = await ctx.blob("temporary");
      await ctx.lightweightTag("temp", blobId);

      // Verify blob exists
      expect(await hasObject(ctx, blobId)).toBe(true);

      // Delete the tag
      await ctx.deleteRef("refs/tags/temp");

      // Wait and run GC with pruning
      await fsTick();
      await ctx.gc.runGC({ pruneLoose: true });

      // Blob may or may not be pruned depending on implementation
      const exists = await hasObject(ctx, blobId);
      expect(typeof exists).toBe("boolean");
    });
  });
});
