/**
 * Tests for InMemoryDeltaRepository
 */

import { describe, expect, it } from "vitest";
import { InMemoryDeltaRepository } from "../../src/storage-impl/mem/delta-repository.js";

describe("InMemoryDeltaRepository", () => {
  it("should store and retrieve delta entries", async () => {
    const repo = new InMemoryDeltaRepository();

    const entry = {
      objectRecordId: 10,
      baseRecordId: 5,
      deltaSize: 100,
    };

    await repo.set(entry);

    const retrieved = await repo.get(10);
    expect(retrieved).toEqual(entry);
  });

  it("should return undefined for non-existent deltas", async () => {
    const repo = new InMemoryDeltaRepository();
    expect(await repo.get(999)).toBeUndefined();
  });

  it("should check if delta exists", async () => {
    const repo = new InMemoryDeltaRepository();

    await repo.set({
      objectRecordId: 10,
      baseRecordId: 5,
      deltaSize: 100,
    });

    expect(await repo.has(10)).toBe(true);
    expect(await repo.has(999)).toBe(false);
  });

  it("should delete delta entries", async () => {
    const repo = new InMemoryDeltaRepository();

    await repo.set({
      objectRecordId: 10,
      baseRecordId: 5,
      deltaSize: 100,
    });

    expect(await repo.has(10)).toBe(true);

    await repo.delete(10);

    expect(await repo.has(10)).toBe(false);
    expect(await repo.get(10)).toBeUndefined();
  });

  it("should get base record ID", async () => {
    const repo = new InMemoryDeltaRepository();

    await repo.set({
      objectRecordId: 10,
      baseRecordId: 5,
      deltaSize: 100,
    });

    const baseId = await repo.getBaseRecordId(10);
    expect(baseId).toBe(5);
  });

  it("should return undefined for base ID of non-delta", async () => {
    const repo = new InMemoryDeltaRepository();
    const baseId = await repo.getBaseRecordId(999);
    expect(baseId).toBeUndefined();
  });

  it("should build delta chain", async () => {
    const repo = new InMemoryDeltaRepository();

    // Create chain: 30 -> 20 -> 10 -> base
    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 10, deltaSize: 60 });
    await repo.set({ objectRecordId: 30, baseRecordId: 20, deltaSize: 70 });

    const chain = await repo.getChain(30);

    expect(chain).toHaveLength(3);
    expect(chain[0].objectRecordId).toBe(30);
    expect(chain[1].objectRecordId).toBe(20);
    expect(chain[2].objectRecordId).toBe(10);
  });

  it("should return empty chain for base object", async () => {
    const repo = new InMemoryDeltaRepository();

    // Object 1 is a base (no delta entry)
    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });

    const chain = await repo.getChain(1);
    expect(chain).toHaveLength(0);
  });

  it("should get chain depth", async () => {
    const repo = new InMemoryDeltaRepository();

    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 10, deltaSize: 60 });
    await repo.set({ objectRecordId: 30, baseRecordId: 20, deltaSize: 70 });

    expect(await repo.getChainDepth(30)).toBe(3);
    expect(await repo.getChainDepth(20)).toBe(2);
    expect(await repo.getChainDepth(10)).toBe(1);
    expect(await repo.getChainDepth(1)).toBe(0); // Base object
  });

  it("should track dependents", async () => {
    const repo = new InMemoryDeltaRepository();

    // Objects 10 and 20 both depend on base 1
    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 1, deltaSize: 60 });

    const dependents = await repo.getDependents(1);
    expect(dependents).toHaveLength(2);
    expect(dependents).toContain(10);
    expect(dependents).toContain(20);
  });

  it("should check if has dependents", async () => {
    const repo = new InMemoryDeltaRepository();

    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });

    expect(await repo.hasDependents(1)).toBe(true);
    expect(await repo.hasDependents(999)).toBe(false);
  });

  it("should update dependents when deleting", async () => {
    const repo = new InMemoryDeltaRepository();

    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 1, deltaSize: 60 });

    expect(await repo.hasDependents(1)).toBe(true);

    await repo.delete(10);

    const dependents = await repo.getDependents(1);
    expect(dependents).toHaveLength(1);
    expect(dependents).toContain(20);

    await repo.delete(20);

    expect(await repo.hasDependents(1)).toBe(false);
  });

  it("should detect direct cycles", async () => {
    const repo = new InMemoryDeltaRepository();

    // Try to make object delta against itself
    const wouldCycle = await repo.wouldCreateCycle(10, 10);
    expect(wouldCycle).toBe(true);
  });

  it("should detect indirect cycles", async () => {
    const repo = new InMemoryDeltaRepository();

    // Create chain: 20 -> 10 -> 1
    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 10, deltaSize: 60 });

    // Try to make 10 delta against 20 (would create cycle)
    const wouldCycle = await repo.wouldCreateCycle(10, 20);
    expect(wouldCycle).toBe(true);
  });

  it("should detect longer indirect cycles", async () => {
    const repo = new InMemoryDeltaRepository();

    // Create chain: 30 -> 20 -> 10 -> 1
    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 10, deltaSize: 60 });
    await repo.set({ objectRecordId: 30, baseRecordId: 20, deltaSize: 70 });

    // Try to make 10 delta against 30 (would create cycle)
    const wouldCycle = await repo.wouldCreateCycle(10, 30);
    expect(wouldCycle).toBe(true);
  });

  it("should allow valid delta relationships", async () => {
    const repo = new InMemoryDeltaRepository();

    // Create chain: 20 -> 10 -> 1
    await repo.set({ objectRecordId: 10, baseRecordId: 1, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 10, deltaSize: 60 });

    // Make 30 delta against 20 (valid, extends chain)
    const wouldCycle = await repo.wouldCreateCycle(30, 20);
    expect(wouldCycle).toBe(false);
  });

  it("should throw error on circular chain during getChain", async () => {
    const repo = new InMemoryDeltaRepository();

    // Manually create circular chain (bypassing validation)
    await repo.set({ objectRecordId: 10, baseRecordId: 20, deltaSize: 50 });
    await repo.set({ objectRecordId: 20, baseRecordId: 10, deltaSize: 60 });

    await expect(repo.getChain(10)).rejects.toThrow("Circular delta chain");
  });

  it("should throw error on very deep chains", async () => {
    const repo = new InMemoryDeltaRepository();

    // Create a very deep chain
    let prev = 1;
    for (let i = 2; i <= 1002; i++) {
      await repo.set({ objectRecordId: i, baseRecordId: prev, deltaSize: 10 });
      prev = i;
    }

    await expect(repo.getChain(1002)).rejects.toThrow("Delta chain too deep");
  });
});
