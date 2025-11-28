/**
 * Tests for LRU cache doubly-linked list integrity
 */

import { describe, expect, it } from "vitest";
import { LRUCache } from "../../src/storage-impl/lru-cache.js";

describe("LRUCache - Link Integrity", () => {
  /**
   * Helper to verify the doubly-linked list integrity
   */
  function verifyListIntegrity<K, V>(cache: LRUCache<K, V>) {
    // @ts-expect-error - Accessing private properties for testing
    const head = cache.head;
    // @ts-expect-error - Accessing private properties for testing
    const tail = cache.tail;
    // @ts-expect-error - Accessing private properties for testing
    const cacheMap = cache.cache;

    const size = cacheMap.size;

    // If empty, both head and tail should be null
    if (size === 0) {
      expect(head).toBeNull();
      expect(tail).toBeNull();
      return;
    }

    // If single entry, head and tail should be the same
    if (size === 1) {
      expect(head).toBe(tail);
      expect(head?.prev).toBeNull();
      expect(head?.next).toBeNull();
      return;
    }

    // Verify forward traversal
    const forwardKeys: unknown[] = [];
    let current = head;
    let steps = 0;
    const maxSteps = size + 1; // Prevent infinite loop

    while (current && steps < maxSteps) {
      // Head should have no prev
      if (current === head) {
        expect(current.prev).toBeNull();
      }

      // Tail should have no next
      if (current === tail) {
        expect(current.next).toBeNull();
      }

      forwardKeys.push(current.value);

      // Verify bidirectional link
      if (current.next) {
        expect(current.next.prev).toBe(current);
      }

      current = current.next;
      steps++;
    }

    // Should have traversed exactly 'size' entries
    expect(forwardKeys).toHaveLength(size);

    // Verify backward traversal
    const backwardKeys: unknown[] = [];
    current = tail;
    steps = 0;

    while (current && steps < maxSteps) {
      backwardKeys.push(current.value);

      // Verify bidirectional link
      if (current.prev) {
        expect(current.prev.next).toBe(current);
      }

      current = current.prev;
      steps++;
    }

    // Should have traversed exactly 'size' entries
    expect(backwardKeys).toHaveLength(size);

    // Forward and backward should be reverse of each other
    expect(backwardKeys.reverse()).toEqual(forwardKeys);
  }

  it("should maintain link integrity when adding items", () => {
    const cache = new LRUCache<string, string>();

    cache.set("a", "A");
    verifyListIntegrity(cache);

    cache.set("b", "B");
    verifyListIntegrity(cache);

    cache.set("c", "C");
    verifyListIntegrity(cache);
  });

  it("should maintain link integrity when updating existing items", () => {
    const cache = new LRUCache<string, string>();

    cache.set("a", "A1");
    cache.set("b", "B1");
    cache.set("c", "C1");
    verifyListIntegrity(cache);

    // Update middle item
    cache.set("b", "B2");
    verifyListIntegrity(cache);

    // Update head
    cache.set("b", "B3");
    verifyListIntegrity(cache);

    // Update tail
    cache.set("a", "A2");
    verifyListIntegrity(cache);
  });

  it("should maintain link integrity when accessing items", () => {
    const cache = new LRUCache<string, string>();

    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    verifyListIntegrity(cache);

    // Access tail (should move to head)
    cache.get("a");
    verifyListIntegrity(cache);

    // Access middle
    cache.get("b");
    verifyListIntegrity(cache);

    // Access head (no change)
    cache.get("b");
    verifyListIntegrity(cache);
  });

  it("should maintain link integrity when deleting items", () => {
    const cache = new LRUCache<string, string>();

    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    cache.set("d", "D");
    verifyListIntegrity(cache);

    // Delete from middle
    cache.delete("c");
    verifyListIntegrity(cache);

    // Delete head
    cache.delete("d");
    verifyListIntegrity(cache);

    // Delete tail
    cache.delete("a");
    verifyListIntegrity(cache);

    // Delete last item
    cache.delete("b");
    verifyListIntegrity(cache);
  });

  it("should maintain link integrity during eviction", () => {
    const cache = new LRUCache<string, string>(1000, 3);

    cache.set("a", "A".repeat(100));
    verifyListIntegrity(cache);

    cache.set("b", "B".repeat(100));
    verifyListIntegrity(cache);

    cache.set("c", "C".repeat(100));
    verifyListIntegrity(cache);

    // This should evict "a" (tail)
    cache.set("d", "D".repeat(100));
    verifyListIntegrity(cache);

    expect(cache.has("a")).toBe(false);
    expect(cache.has("b")).toBe(true);
    expect(cache.has("c")).toBe(true);
    expect(cache.has("d")).toBe(true);
  });

  it("should maintain link integrity with complex access pattern", () => {
    const cache = new LRUCache<string, number>(10000, 5);

    // Add items
    for (let i = 0; i < 5; i++) {
      cache.set(`key${i}`, i);
      verifyListIntegrity(cache);
    }

    // Access in random order
    cache.get("key2");
    verifyListIntegrity(cache);

    cache.get("key0");
    verifyListIntegrity(cache);

    cache.get("key4");
    verifyListIntegrity(cache);

    // Update some items
    cache.set("key1", 100);
    verifyListIntegrity(cache);

    cache.set("key3", 300);
    verifyListIntegrity(cache);

    // Add more items (should evict)
    cache.set("key5", 5);
    verifyListIntegrity(cache);

    cache.set("key6", 6);
    verifyListIntegrity(cache);
  });

  it("should handle clearing cache", () => {
    const cache = new LRUCache<string, string>();

    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    verifyListIntegrity(cache);

    cache.clear();
    verifyListIntegrity(cache);

    // Add items after clear
    cache.set("d", "D");
    verifyListIntegrity(cache);
  });
});
