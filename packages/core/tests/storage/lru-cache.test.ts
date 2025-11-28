/**
 * Tests for LRUCache
 */

import { describe, expect, it } from "vitest";
import { LRUCache } from "../../src/storage-impl/lru-cache.js";

describe("LRUCache", () => {
  it("should store and retrieve content", () => {
    const cache = new LRUCache<string, Uint8Array>();
    const content = new Uint8Array([1, 2, 3, 4]);

    cache.set("obj1", content);
    expect(cache.has("obj1")).toBe(true);
    expect(cache.get("obj1")).toEqual(content);
  });

  it("should return undefined for missing entries", () => {
    const cache = new LRUCache<string, Uint8Array>();

    expect(cache.has("missing")).toBe(false);
    expect(cache.get("missing")).toBeUndefined();
  });

  it("should delete entries", () => {
    const cache = new LRUCache<string, Uint8Array>();
    const content = new Uint8Array([1, 2, 3]);

    cache.set("obj1", content);
    expect(cache.has("obj1")).toBe(true);

    const deleted = cache.delete("obj1");
    expect(deleted).toBe(true);
    expect(cache.has("obj1")).toBe(false);
  });

  it("should return false when deleting non-existent entry", () => {
    const cache = new LRUCache<string, Uint8Array>();
    const deleted = cache.delete("missing");
    expect(deleted).toBe(false);
  });

  it("should track total size", () => {
    const cache = new LRUCache<string, Uint8Array>();

    cache.set("obj1", new Uint8Array(100));
    expect(cache.getTotalSize()).toBe(100);

    cache.set("obj2", new Uint8Array(50));
    expect(cache.getTotalSize()).toBe(150);

    cache.delete("obj1");
    expect(cache.getTotalSize()).toBe(50);
  });

  it("should track entry count", () => {
    const cache = new LRUCache<string, Uint8Array>();

    cache.set("obj1", new Uint8Array(10));
    expect(cache.size()).toBe(1);

    cache.set("obj2", new Uint8Array(10));
    expect(cache.size()).toBe(2);

    cache.delete("obj1");
    expect(cache.size()).toBe(1);
  });

  it("should evict entries when exceeding max size", () => {
    const cache = new LRUCache<string, Uint8Array>(100, 1000); // 100 bytes max

    cache.set("obj1", new Uint8Array(40));
    cache.set("obj2", new Uint8Array(40));
    cache.set("obj3", new Uint8Array(40)); // Total = 120, exceeds limit

    // obj1 should be evicted (least recently used)
    expect(cache.has("obj1")).toBe(false);
    expect(cache.has("obj2")).toBe(true);
    expect(cache.has("obj3")).toBe(true);
  });

  it("should evict entries when exceeding max entry count", () => {
    const cache = new LRUCache<string, Uint8Array>(1000000, 2); // Max 2 entries

    cache.set("obj1", new Uint8Array(10));
    cache.set("obj2", new Uint8Array(10));
    cache.set("obj3", new Uint8Array(10)); // Exceeds entry limit

    // obj1 should be evicted
    expect(cache.has("obj1")).toBe(false);
    expect(cache.has("obj2")).toBe(true);
    expect(cache.has("obj3")).toBe(true);
  });

  it("should update access order on get", () => {
    const cache = new LRUCache<string, Uint8Array>(100, 1000);

    cache.set("obj1", new Uint8Array(30));
    cache.set("obj2", new Uint8Array(30));

    // Access obj1 to make it more recently used
    cache.get("obj1");

    // Add obj3, which should evict obj2 (not obj1)
    cache.set("obj3", new Uint8Array(30));
    cache.set("obj4", new Uint8Array(30)); // Force eviction

    expect(cache.has("obj1")).toBe(true);
    expect(cache.has("obj2")).toBe(false); // Evicted
    expect(cache.has("obj3")).toBe(true);
    expect(cache.has("obj4")).toBe(true);
  });

  it("should replace existing entries", () => {
    const cache = new LRUCache<string, Uint8Array>();
    const content1 = new Uint8Array([1, 2, 3]);
    const content2 = new Uint8Array([4, 5, 6, 7]);

    cache.set("obj1", content1);
    expect(cache.getTotalSize()).toBe(3);

    cache.set("obj1", content2);
    expect(cache.getTotalSize()).toBe(4);
    expect(cache.get("obj1")).toEqual(content2);
    expect(cache.size()).toBe(1); // Still only one entry
  });

  it("should clear all entries", () => {
    const cache = new LRUCache<string, Uint8Array>();

    cache.set("obj1", new Uint8Array(10));
    cache.set("obj2", new Uint8Array(20));
    cache.set("obj3", new Uint8Array(30));

    cache.clear();

    expect(cache.size()).toBe(0);
    expect(cache.getTotalSize()).toBe(0);
    expect(cache.has("obj1")).toBe(false);
    expect(cache.has("obj2")).toBe(false);
    expect(cache.has("obj3")).toBe(false);
  });

  it("should keep at least one entry even when over limit", () => {
    const cache = new LRUCache<string, Uint8Array>(10, 1); // Very small limits

    cache.set("obj1", new Uint8Array(100)); // Exceeds both limits

    // Entry should still be in cache
    expect(cache.has("obj1")).toBe(true);
    expect(cache.size()).toBe(1);
  });
});
