/**
 * Parametrized test suite for MetadataRepository implementations
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MetadataRepository } from "../index.js";

/**
 * Context provided by the repository factory
 */
export interface MetadataRepositoryTestContext {
  repo: MetadataRepository;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a repository instance for testing
 */
export type MetadataRepositoryFactory = () => Promise<MetadataRepositoryTestContext>;

/**
 * Create the MetadataRepository test suite with a specific factory
 */
export function createMetadataRepositoryTests(
  name: string,
  factory: MetadataRepositoryFactory,
): void {
  describe(`MetadataRepository [${name}]`, () => {
    let ctx: MetadataRepositoryTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Access Tracking", () => {
      it("records access", async () => {
        await ctx.repo.recordAccess("obj1");

        const metadata = await ctx.repo.getMetadata("obj1");
        expect(metadata).toBeDefined();
        expect(metadata?.objectId).toBe("obj1");
        expect(metadata?.accessCount).toBe(1);
      });

      it("increments access count on repeated access", async () => {
        await ctx.repo.recordAccess("obj1");
        await ctx.repo.recordAccess("obj1");
        await ctx.repo.recordAccess("obj1");

        const metadata = await ctx.repo.getMetadata("obj1");
        expect(metadata?.accessCount).toBe(3);
      });

      it("updates last accessed timestamp", async () => {
        await ctx.repo.recordAccess("obj1");
        const metadata1 = await ctx.repo.getMetadata("obj1");
        const firstAccess = metadata1?.lastAccessed ?? 0;

        // Wait a bit
        await new Promise((resolve) => setTimeout(resolve, 10));

        await ctx.repo.recordAccess("obj1");
        const metadata2 = await ctx.repo.getMetadata("obj1");
        const secondAccess = metadata2?.lastAccessed ?? 0;

        expect(secondAccess).toBeGreaterThan(firstAccess);
      });
    });

    describe("LRU Candidates", () => {
      it("gets LRU candidates", async () => {
        // Record accesses with delays
        await ctx.repo.recordAccess("obj1");
        await new Promise((resolve) => setTimeout(resolve, 10));

        await ctx.repo.recordAccess("obj2");
        await new Promise((resolve) => setTimeout(resolve, 10));

        await ctx.repo.recordAccess("obj3");

        // Get LRU candidates (oldest first)
        const candidates = await ctx.repo.getLRUCandidates(2);

        expect(candidates).toHaveLength(2);
        expect(candidates[0]).toBe("obj1"); // Oldest
        expect(candidates[1]).toBe("obj2");
      });
    });

    describe("Size Tracking", () => {
      it("updates size metadata", async () => {
        await ctx.repo.updateSize("obj1", 1000);

        const metadata = await ctx.repo.getMetadata("obj1");
        expect(metadata?.size).toBe(1000);
      });

      it("calculates total size", async () => {
        await ctx.repo.updateSize("obj1", 1000);
        await ctx.repo.updateSize("obj2", 2000);
        await ctx.repo.updateSize("obj3", 3000);

        const totalSize = await ctx.repo.getTotalSize();
        expect(totalSize).toBe(6000);
      });

      it("creates metadata when updating size for new object", async () => {
        await ctx.repo.updateSize("obj1", 500);

        const metadata = await ctx.repo.getMetadata("obj1");
        expect(metadata).toBeDefined();
        expect(metadata?.size).toBe(500);
        expect(metadata?.accessCount).toBe(0); // Not accessed yet
      });
    });

    describe("Hot/Cold Management", () => {
      it("marks objects as hot", async () => {
        await ctx.repo.recordAccess("obj1");
        await ctx.repo.markHot("obj1");

        const hotObjects = await ctx.repo.getHotObjects(10);
        expect(hotObjects).toContain("obj1");
      });

      it("marks objects as cold", async () => {
        await ctx.repo.recordAccess("obj1");
        await ctx.repo.markCold("obj1");

        // Hot objects should not contain obj1
        const hotObjects = await ctx.repo.getHotObjects(10);
        expect(hotObjects).not.toContain("obj1");
      });

      it("toggles between hot and cold", async () => {
        await ctx.repo.recordAccess("obj1");
        await ctx.repo.markHot("obj1");

        let hotObjects = await ctx.repo.getHotObjects(10);
        expect(hotObjects).toContain("obj1");

        // Mark as cold
        await ctx.repo.markCold("obj1");

        hotObjects = await ctx.repo.getHotObjects(10);
        expect(hotObjects).not.toContain("obj1");
      });

      it("gets hot objects with limit", async () => {
        await ctx.repo.recordAccess("obj1");
        await ctx.repo.recordAccess("obj2");
        await ctx.repo.recordAccess("obj3");

        await ctx.repo.markHot("obj1");
        await ctx.repo.markHot("obj2");
        await ctx.repo.markHot("obj3");

        const hotObjects = await ctx.repo.getHotObjects(2);
        expect(hotObjects).toHaveLength(2);
      });
    });

    describe("Edge Cases", () => {
      it("returns undefined for non-tracked objects", async () => {
        const metadata = await ctx.repo.getMetadata("missing");
        expect(metadata).toBeUndefined();
      });
    });
  });
}
