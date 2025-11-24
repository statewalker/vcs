/**
 * Tests for IntermediateCache
 */

import { describe, expect, it } from "vitest";
import { IntermediateCache } from "../../src/storage/intermediate-cache.js";

describe("IntermediateCache", () => {
  it("should store and retrieve intermediate results", () => {
    const cache = new IntermediateCache();
    const content = new Uint8Array([1, 2, 3, 4]);

    cache.set(100, 8, content);

    const retrieved = cache.get("100:8");
    expect(retrieved).toEqual(content);
  });

  it("should retrieve by components", () => {
    const cache = new IntermediateCache();
    const content = new Uint8Array([1, 2, 3, 4]);

    cache.set(100, 8, content);

    const retrieved = cache.getByComponents(100, 8);
    expect(retrieved).toEqual(content);
  });

  it("should return undefined for missing entries", () => {
    const cache = new IntermediateCache();

    expect(cache.get("100:8")).toBeUndefined();
    expect(cache.getByComponents(100, 8)).toBeUndefined();
  });

  it("should cache multiple depths for same base", () => {
    const cache = new IntermediateCache();

    const content1 = new Uint8Array([1]);
    const content2 = new Uint8Array([2]);
    const content3 = new Uint8Array([3]);

    cache.set(100, 8, content1);
    cache.set(100, 16, content2);
    cache.set(100, 24, content3);

    expect(cache.get("100:8")).toEqual(content1);
    expect(cache.get("100:16")).toEqual(content2);
    expect(cache.get("100:24")).toEqual(content3);
  });

  it("should cache different bases independently", () => {
    const cache = new IntermediateCache();

    const content1 = new Uint8Array([1]);
    const content2 = new Uint8Array([2]);

    cache.set(100, 8, content1);
    cache.set(200, 8, content2);

    expect(cache.get("100:8")).toEqual(content1);
    expect(cache.get("200:8")).toEqual(content2);
  });

  it("should clear entries for specific base record ID", () => {
    const cache = new IntermediateCache();

    cache.set(100, 8, new Uint8Array([1]));
    cache.set(100, 16, new Uint8Array([2]));
    cache.set(200, 8, new Uint8Array([3]));

    cache.clear(100);

    // Base 100 entries should be cleared
    expect(cache.get("100:8")).toBeUndefined();
    expect(cache.get("100:16")).toBeUndefined();

    // Base 200 should remain
    expect(cache.get("200:8")).toBeDefined();
  });

  it("should clear all entries", () => {
    const cache = new IntermediateCache();

    cache.set(100, 8, new Uint8Array([1]));
    cache.set(100, 16, new Uint8Array([2]));
    cache.set(200, 8, new Uint8Array([3]));

    cache.clearAll();

    expect(cache.get("100:8")).toBeUndefined();
    expect(cache.get("100:16")).toBeUndefined();
    expect(cache.get("200:8")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("should track cache size", () => {
    const cache = new IntermediateCache();

    expect(cache.size()).toBe(0);

    cache.set(100, 8, new Uint8Array([1]));
    expect(cache.size()).toBe(1);

    cache.set(100, 16, new Uint8Array([2]));
    expect(cache.size()).toBe(2);

    cache.clear(100);
    expect(cache.size()).toBe(0);
  });

  it("should handle typical delta reconstruction pattern", () => {
    const cache = new IntermediateCache();
    const baseRecordId = 50;

    // Simulate caching every 8 steps in a 20-depth chain
    cache.set(baseRecordId, 8, new Uint8Array([1, 1, 1]));
    cache.set(baseRecordId, 16, new Uint8Array([2, 2, 2]));

    // Verify cached waypoints exist
    expect(cache.getByComponents(baseRecordId, 8)).toBeDefined();
    expect(cache.getByComponents(baseRecordId, 16)).toBeDefined();

    // Non-cached depths should not exist
    expect(cache.getByComponents(baseRecordId, 4)).toBeUndefined();
    expect(cache.getByComponents(baseRecordId, 12)).toBeUndefined();
  });
});
