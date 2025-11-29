/**
 * Parametrized test suite for ObjectRepository implementations
 */

import type { ObjectRepository } from "@webrun-vcs/storage-default";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Context provided by the repository factory
 */
export interface ObjectRepositoryTestContext {
  repo: ObjectRepository;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a repository instance for testing
 */
export type ObjectRepositoryFactory = () => Promise<ObjectRepositoryTestContext>;

/**
 * Create the ObjectRepository test suite with a specific factory
 */
export function createObjectRepositoryTests(name: string, factory: ObjectRepositoryFactory): void {
  describe(`ObjectRepository [${name}]`, () => {
    let ctx: ObjectRepositoryTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Basic Operations", () => {
      it("stores and retrieves objects", async () => {
        const content = new Uint8Array([1, 2, 3, 4]);

        const entry = await ctx.repo.storeObject({
          id: "abc123",
          size: 100,
          content,
          created: Date.now(),
          accessed: Date.now(),
        });

        expect(entry.recordId).toBeDefined();

        const retrieved = await ctx.repo.loadObjectEntry("abc123");
        expect(retrieved).toEqual(entry);
      });

      it("assigns unique record IDs", async () => {
        const entry1 = await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: Date.now(),
          accessed: Date.now(),
        });

        const entry2 = await ctx.repo.storeObject({
          id: "obj2",
          size: 20,
          content: new Uint8Array([2]),
          created: Date.now(),
          accessed: Date.now(),
        });

        expect(entry1.recordId).not.toBe(entry2.recordId);
      });

      it("preserves record ID when updating existing object", async () => {
        const entry1 = await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: 1000,
          accessed: 1000,
        });

        const recordId = entry1.recordId;

        // Update with same ID
        const entry2 = await ctx.repo.storeObject({
          id: "obj1",
          size: 20,
          content: new Uint8Array([1, 2]),
          created: 2000,
          accessed: 2000,
        });

        expect(entry2.recordId).toBe(recordId);
        expect(entry2.size).toBe(20);
        expect(entry2.content).toEqual(new Uint8Array([1, 2]));
      });

      it("retrieves object by record ID", async () => {
        const entry = await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: Date.now(),
          accessed: Date.now(),
        });

        const retrieved = await ctx.repo.loadObjectByRecordId(entry.recordId);
        expect(retrieved).toEqual(entry);
      });

      it("retrieves object content by record ID", async () => {
        const content = new Uint8Array([1, 2, 3, 4, 5]);

        const entry = await ctx.repo.storeObject({
          id: "obj1",
          size: 5,
          content,
          created: Date.now(),
          accessed: Date.now(),
        });

        const retrieved = await ctx.repo.loadObjectContent(entry.recordId);
        expect(retrieved).toEqual(content);
      });

      it("returns undefined for non-existent objects", async () => {
        expect(await ctx.repo.loadObjectEntry("missing")).toBeUndefined();
        expect(await ctx.repo.loadObjectByRecordId(999)).toBeUndefined();
        expect(await ctx.repo.loadObjectContent(999)).toBeUndefined();
      });

      it("checks if object exists", async () => {
        await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: Date.now(),
          accessed: Date.now(),
        });

        expect(await ctx.repo.hasObject("obj1")).toBe(true);
        expect(await ctx.repo.hasObject("missing")).toBe(false);
      });

      it("deletes objects", async () => {
        const entry = await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: Date.now(),
          accessed: Date.now(),
        });

        expect(await ctx.repo.hasObject("obj1")).toBe(true);

        const deleted = await ctx.repo.deleteObject("obj1");
        expect(deleted).toBe(true);

        expect(await ctx.repo.hasObject("obj1")).toBe(false);
        expect(await ctx.repo.loadObjectByRecordId(entry.recordId)).toBeUndefined();
      });

      it("returns false when deleting non-existent object", async () => {
        const deleted = await ctx.repo.deleteObject("missing");
        expect(deleted).toBe(false);
      });
    });

    describe("Bulk Operations", () => {
      it("gets multiple objects", async () => {
        const entry1 = await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: Date.now(),
          accessed: Date.now(),
        });

        const entry2 = await ctx.repo.storeObject({
          id: "obj2",
          size: 20,
          content: new Uint8Array([2]),
          created: Date.now(),
          accessed: Date.now(),
        });

        const entries = await ctx.repo.getMany(["obj1", "obj2", "obj3"]);

        expect(entries).toHaveLength(2);
        expect(entries).toContainEqual(entry1);
        expect(entries).toContainEqual(entry2);
      });

      it("returns repository size", async () => {
        expect(await ctx.repo.size()).toBe(0);

        await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: Date.now(),
          accessed: Date.now(),
        });

        expect(await ctx.repo.size()).toBe(1);

        await ctx.repo.storeObject({
          id: "obj2",
          size: 20,
          content: new Uint8Array([2]),
          created: Date.now(),
          accessed: Date.now(),
        });

        expect(await ctx.repo.size()).toBe(2);
      });

      it("gets all object IDs", async () => {
        await ctx.repo.storeObject({
          id: "obj1",
          size: 10,
          content: new Uint8Array([1]),
          created: Date.now(),
          accessed: Date.now(),
        });

        await ctx.repo.storeObject({
          id: "obj2",
          size: 20,
          content: new Uint8Array([2]),
          created: Date.now(),
          accessed: Date.now(),
        });

        const ids = await ctx.repo.getAllIds();
        expect(ids).toHaveLength(2);
        expect(ids).toContain("obj1");
        expect(ids).toContain("obj2");
      });
    });
  });
}
