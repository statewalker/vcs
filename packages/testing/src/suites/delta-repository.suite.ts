/**
 * Parametrized test suite for DeltaRepository implementations
 */

import type { DeltaRepository } from "@webrun-vcs/vcs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Context provided by the repository factory
 */
export interface DeltaRepositoryTestContext {
  repo: DeltaRepository;
  cleanup?: () => Promise<void>;
}

/**
 * Factory function to create a repository instance for testing
 */
export type DeltaRepositoryFactory = () => Promise<DeltaRepositoryTestContext>;

/**
 * Create the DeltaRepository test suite with a specific factory
 */
export function createDeltaRepositoryTests(name: string, factory: DeltaRepositoryFactory): void {
  describe(`DeltaRepository [${name}]`, () => {
    let ctx: DeltaRepositoryTestContext;

    beforeEach(async () => {
      ctx = await factory();
    });

    afterEach(async () => {
      await ctx.cleanup?.();
    });

    describe("Basic Operations", () => {
      it("stores and retrieves delta entries", async () => {
        const entry = {
          objectRecordId: 10,
          baseRecordId: 5,
          deltaSize: 100,
        };

        await ctx.repo.set(entry);

        const retrieved = await ctx.repo.get(10);
        expect(retrieved).toEqual(entry);
      });

      it("returns undefined for non-existent deltas", async () => {
        expect(await ctx.repo.get(999)).toBeUndefined();
      });

      it("checks if delta exists", async () => {
        await ctx.repo.set({
          objectRecordId: 10,
          baseRecordId: 5,
          deltaSize: 100,
        });

        expect(await ctx.repo.has(10)).toBe(true);
        expect(await ctx.repo.has(999)).toBe(false);
      });

      it("deletes delta entries", async () => {
        await ctx.repo.set({
          objectRecordId: 10,
          baseRecordId: 5,
          deltaSize: 100,
        });

        expect(await ctx.repo.has(10)).toBe(true);

        await ctx.repo.delete(10);

        expect(await ctx.repo.has(10)).toBe(false);
        expect(await ctx.repo.get(10)).toBeUndefined();
      });

      it("gets base record ID", async () => {
        await ctx.repo.set({
          objectRecordId: 10,
          baseRecordId: 5,
          deltaSize: 100,
        });

        const baseId = await ctx.repo.getBaseRecordId(10);
        expect(baseId).toBe(5);
      });

      it("returns undefined for base ID of non-delta", async () => {
        const baseId = await ctx.repo.getBaseRecordId(999);
        expect(baseId).toBeUndefined();
      });
    });

    describe("Chain Operations", () => {
      it("builds delta chain", async () => {
        // Create chain: 30 -> 20 -> 10 -> base
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
        await ctx.repo.set({
          objectRecordId: 20,
          baseRecordId: 10,
          deltaSize: 60,
        });
        await ctx.repo.set({
          objectRecordId: 30,
          baseRecordId: 20,
          deltaSize: 70,
        });

        const chain = await ctx.repo.getChain(30);

        expect(chain).toHaveLength(3);
        expect(chain[0].objectRecordId).toBe(30);
        expect(chain[1].objectRecordId).toBe(20);
        expect(chain[2].objectRecordId).toBe(10);
      });

      it("returns empty chain for base object", async () => {
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });

        const chain = await ctx.repo.getChain(1);
        expect(chain).toHaveLength(0);
      });

      it("gets chain depth", async () => {
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
        await ctx.repo.set({
          objectRecordId: 20,
          baseRecordId: 10,
          deltaSize: 60,
        });
        await ctx.repo.set({
          objectRecordId: 30,
          baseRecordId: 20,
          deltaSize: 70,
        });

        expect(await ctx.repo.getChainDepth(30)).toBe(3);
        expect(await ctx.repo.getChainDepth(20)).toBe(2);
        expect(await ctx.repo.getChainDepth(10)).toBe(1);
        expect(await ctx.repo.getChainDepth(1)).toBe(0); // Base object
      });
    });

    describe("Dependency Tracking", () => {
      it("tracks dependents", async () => {
        // Objects 10 and 20 both depend on base 1
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
        await ctx.repo.set({ objectRecordId: 20, baseRecordId: 1, deltaSize: 60 });

        const dependents = await ctx.repo.getDependents(1);
        expect(dependents).toHaveLength(2);
        expect(dependents).toContain(10);
        expect(dependents).toContain(20);
      });

      it("checks if has dependents", async () => {
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });

        expect(await ctx.repo.hasDependents(1)).toBe(true);
        expect(await ctx.repo.hasDependents(999)).toBe(false);
      });

      it("updates dependents when deleting", async () => {
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
        await ctx.repo.set({ objectRecordId: 20, baseRecordId: 1, deltaSize: 60 });

        expect(await ctx.repo.hasDependents(1)).toBe(true);

        await ctx.repo.delete(10);

        const dependents = await ctx.repo.getDependents(1);
        expect(dependents).toHaveLength(1);
        expect(dependents).toContain(20);

        await ctx.repo.delete(20);

        expect(await ctx.repo.hasDependents(1)).toBe(false);
      });
    });

    describe("Cycle Detection", () => {
      it("detects direct cycles", async () => {
        const wouldCycle = await ctx.repo.wouldCreateCycle(10, 10);
        expect(wouldCycle).toBe(true);
      });

      it("detects indirect cycles", async () => {
        // Create chain: 20 -> 10 -> 1
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
        await ctx.repo.set({
          objectRecordId: 20,
          baseRecordId: 10,
          deltaSize: 60,
        });

        // Try to make 10 delta against 20 (would create cycle)
        const wouldCycle = await ctx.repo.wouldCreateCycle(10, 20);
        expect(wouldCycle).toBe(true);
      });

      it("detects longer indirect cycles", async () => {
        // Create chain: 30 -> 20 -> 10 -> 1
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
        await ctx.repo.set({
          objectRecordId: 20,
          baseRecordId: 10,
          deltaSize: 60,
        });
        await ctx.repo.set({
          objectRecordId: 30,
          baseRecordId: 20,
          deltaSize: 70,
        });

        // Try to make 10 delta against 30 (would create cycle)
        const wouldCycle = await ctx.repo.wouldCreateCycle(10, 30);
        expect(wouldCycle).toBe(true);
      });

      it("allows valid delta relationships", async () => {
        // Create chain: 20 -> 10 -> 1
        await ctx.repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
        await ctx.repo.set({
          objectRecordId: 20,
          baseRecordId: 10,
          deltaSize: 60,
        });

        // Make 30 delta against 20 (valid, extends chain)
        const wouldCycle = await ctx.repo.wouldCreateCycle(30, 20);
        expect(wouldCycle).toBe(false);
      });
    });

    describe("Error Handling", () => {
      it("throws error on circular chain during getChain", async () => {
        // Manually create circular chain (bypassing validation)
        await ctx.repo.set({
          objectRecordId: 10,
          baseRecordId: 20,
          deltaSize: 50,
        });
        await ctx.repo.set({
          objectRecordId: 20,
          baseRecordId: 10,
          deltaSize: 60,
        });

        await expect(ctx.repo.getChain(10)).rejects.toThrow(/[Cc]ircular/);
      });

      it("throws error on very deep chains", async () => {
        // Create a very deep chain
        let prev = 1;
        for (let i = 2; i <= 1002; i++) {
          await ctx.repo.set({
            objectRecordId: i,
            baseRecordId: prev,
            deltaSize: 10,
          });
          prev = i;
        }

        await expect(ctx.repo.getChain(1002)).rejects.toThrow(/deep/i);
      });
    });
  });
}
