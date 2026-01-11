/**
 * Comprehensive tests for RawStoreWithDelta
 *
 * Tests loose object operations, deltify, undeltify, delta chain resolution,
 * keys enumeration, and edge cases.
 */

import type { Delta } from "@statewalker/vcs-utils";
import { FossilChecksum } from "@statewalker/vcs-utils";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryRawStore } from "../../src/storage/binary/raw-store.memory.js";
import type { DeltaInfo } from "../../src/storage/delta/delta-store.js";
import { defaultComputeDelta, RawStoreWithDelta } from "../../src/storage/delta/raw-store-with-delta.js";
import { collectBytes } from "../helpers/assertion-helpers.js";
import { MockDeltaStore } from "../mocks/mock-delta-store.js";

// Helper to store delta using update pattern
async function storeDelta(store: MockDeltaStore, info: DeltaInfo, delta: Delta[]): Promise<void> {
  const update = store.startUpdate();
  await update.storeDelta(info, delta);
  await update.close();
}

/**
 * Compute checksum for delta output
 * Simulates what applyDelta computes for checksum validation
 */
function computeDeltaChecksum(source: Uint8Array, deltas: Delta[]): number {
  const checksum = new FossilChecksum();
  for (const d of deltas) {
    if (d.type === "insert") {
      checksum.update(d.data, 0, d.data.length);
    } else if (d.type === "copy") {
      const chunk = source.subarray(d.start, d.start + d.len);
      checksum.update(chunk, 0, chunk.length);
    }
  }
  return checksum.finalize();
}

/**
 * Create a valid delta with correct checksum
 */
function createValidDelta(
  source: Uint8Array,
  instructions: Array<
    { type: "copy"; start: number; len: number } | { type: "insert"; data: Uint8Array }
  >,
): Delta[] {
  let targetLen = 0;
  const deltas: Delta[] = [];

  for (const inst of instructions) {
    if (inst.type === "copy") {
      targetLen += inst.len;
      deltas.push(inst);
    } else {
      targetLen += inst.data.length;
      deltas.push(inst);
    }
  }

  const result: Delta[] = [{ type: "start", targetLen }, ...deltas];
  const checksum = computeDeltaChecksum(source, result);
  result.push({ type: "finish", checksum });

  return result;
}

describe("RawStoreWithDelta - Loose Object Operations", () => {
  let rawStore: MemoryRawStore;
  let deltaStore: MockDeltaStore;
  let store: RawStoreWithDelta;

  beforeEach(() => {
    rawStore = new MemoryRawStore();
    deltaStore = new MockDeltaStore();
    store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });
  });

  describe("store()", () => {
    it("stores content and returns byte count", async () => {
      const content = new TextEncoder().encode("test content");
      const size = await store.store("key1", [content]);
      expect(size).toBe(content.length);
    });

    it("stores multi-chunk content", async () => {
      const chunks = [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6]),
        new Uint8Array([7, 8, 9]),
      ];
      const size = await store.store(
        "key1",
        (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      );
      expect(size).toBe(9);

      const loaded = await collectBytes(store.load("key1"));
      expect(loaded).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]));
    });

    it("stores empty content", async () => {
      const size = await store.store("key1", [new Uint8Array(0)]);
      expect(size).toBe(0);
    });

    it("overwrites existing content", async () => {
      await store.store("key1", [new TextEncoder().encode("original")]);
      await store.store("key1", [new TextEncoder().encode("updated")]);

      const loaded = await collectBytes(store.load("key1"));
      expect(new TextDecoder().decode(loaded)).toBe("updated");
    });
  });

  describe("load()", () => {
    it("loads stored content", async () => {
      const content = new TextEncoder().encode("test content");
      await store.store("key1", [content]);

      const loaded = await collectBytes(store.load("key1"));
      expect(new TextDecoder().decode(loaded)).toBe("test content");
    });

    it("loads with offset", async () => {
      const content = new TextEncoder().encode("hello world");
      await store.store("key1", [content]);

      const loaded = await collectBytes(store.load("key1", { offset: 6 }));
      expect(new TextDecoder().decode(loaded)).toBe("world");
    });

    it("loads with length limit", async () => {
      const content = new TextEncoder().encode("hello world");
      await store.store("key1", [content]);

      const loaded = await collectBytes(store.load("key1", { length: 5 }));
      expect(new TextDecoder().decode(loaded)).toBe("hello");
    });

    it("loads with offset and length", async () => {
      const content = new TextEncoder().encode("hello world");
      await store.store("key1", [content]);

      const loaded = await collectBytes(store.load("key1", { offset: 3, length: 5 }));
      expect(new TextDecoder().decode(loaded)).toBe("lo wo");
    });

    it("throws for non-existent key", async () => {
      await expect(collectBytes(store.load("nonexistent"))).rejects.toThrow();
    });
  });

  describe("has()", () => {
    it("returns true for stored object", async () => {
      await store.store("key1", [new TextEncoder().encode("content")]);
      expect(await store.has("key1")).toBe(true);
    });

    it("returns false for non-existent object", async () => {
      expect(await store.has("nonexistent")).toBe(false);
    });

    it("returns true for delta object", async () => {
      await store.store("base", [new TextEncoder().encode("base")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta1" }, [
        { type: "start", targetLen: 10 },
        { type: "finish", checksum: 0 },
      ]);

      expect(await store.has("delta1")).toBe(true);
    });
  });

  describe("size()", () => {
    it("returns size for loose object", async () => {
      const content = new TextEncoder().encode("test content");
      await store.store("key1", [content]);

      const size = await store.size("key1");
      expect(size).toBe(content.length);
    });

    it("returns original size for delta object", async () => {
      await store.store("base", [new TextEncoder().encode("base content")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta1" }, [
        { type: "start", targetLen: 50 },
        { type: "copy", start: 0, len: 12 },
        { type: "finish", checksum: 0 },
      ]);

      const size = await store.size("delta1");
      // MockDeltaStore returns 100 as default originalSize
      expect(size).toBe(100);
    });

    it("returns size from raw store for non-delta", async () => {
      const content = new TextEncoder().encode("specific content");
      await store.store("key1", [content]);

      const size = await store.size("key1");
      expect(size).toBe(content.length);
    });
  });

  describe("delete()", () => {
    it("deletes loose object", async () => {
      await store.store("key1", [new TextEncoder().encode("content")]);
      expect(await store.has("key1")).toBe(true);

      const deleted = await store.delete("key1");
      expect(deleted).toBe(true);
      expect(await store.has("key1")).toBe(false);
    });

    it("deletes delta object", async () => {
      await store.store("base", [new TextEncoder().encode("base")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta1" }, [
        { type: "start", targetLen: 10 },
        { type: "finish", checksum: 0 },
      ]);

      const deleted = await store.delete("delta1");
      expect(deleted).toBe(true);
      expect(await store.has("delta1")).toBe(false);
    });

    it("deletes object existing in both stores", async () => {
      // Store in raw store
      await store.store("key1", [new TextEncoder().encode("loose content")]);
      // Also store as delta
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "key1" }, [
        { type: "start", targetLen: 10 },
        { type: "finish", checksum: 0 },
      ]);

      const deleted = await store.delete("key1");
      expect(deleted).toBe(true);
      expect(await store.has("key1")).toBe(false);
    });

    it("returns false for non-existent object", async () => {
      const deleted = await store.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });
});

describe("RawStoreWithDelta - Deltify Operations", () => {
  let rawStore: MemoryRawStore;
  let deltaStore: MockDeltaStore;
  let store: RawStoreWithDelta;

  beforeEach(() => {
    rawStore = new MemoryRawStore();
    deltaStore = new MockDeltaStore();
    store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
      maxRatio: 0.95, // Allow more deltas for testing
      minSize: 10,
    });
  });

  describe("deltify() with single candidate", () => {
    it("creates delta from similar content", async () => {
      // Store base content - needs to be large enough for delta to be beneficial
      const baseContent =
        "This is a fairly long base content that we will use for testing delta compression. " +
        "The content needs to be long enough so that the rolling hash algorithm can find " +
        "common sequences between the base and target. This paragraph is repeated content " +
        "that should appear in both versions.";
      await store.store("base", [new TextEncoder().encode(baseContent)]);

      // Store target content (mostly same as base with small modification at end)
      const targetContent =
        "This is a fairly long base content that we will use for testing delta compression. " +
        "The content needs to be long enough so that the rolling hash algorithm can find " +
        "common sequences between the base and target. This paragraph is repeated content " +
        "with a small modification at the end.";
      await store.store("target", [new TextEncoder().encode(targetContent)]);

      // Deltify target against base
      const result = await store.deltify("target", ["base"]);
      expect(result).toBe(true);

      // Verify delta was stored
      expect(await deltaStore.isDelta("target")).toBe(true);
    });

    it("returns false for empty candidates", async () => {
      await store.store("target", [new TextEncoder().encode("content")]);
      const result = await store.deltify("target", []);
      expect(result).toBe(false);
    });

    it("returns false when delta is not beneficial", async () => {
      // Store very different content that's long enough but completely different
      const contentA = "A".repeat(200);
      const contentZ = "Z".repeat(200);
      await store.store("base", [new TextEncoder().encode(contentA)]);
      await store.store("target", [new TextEncoder().encode(contentZ)]);

      // With strict maxRatio, delta shouldn't be beneficial
      const strictStore = new RawStoreWithDelta({
        objects: rawStore,
        deltas: deltaStore,
        maxRatio: 0.1, // Very strict
      });

      const result = await strictStore.deltify("target", ["base"]);
      expect(result).toBe(false);
    });
  });

  describe("deltify() with multiple candidates", () => {
    it("selects best candidate based on compression ratio", async () => {
      // Create content that's long enough for meaningful delta compression
      const commonPrefix =
        "This is a common prefix that appears in multiple documents. " +
        "Having shared content allows the delta algorithm to find copy regions. ";
      const targetContent = `${commonPrefix}This is the unique ending for the target document.`;
      await store.store("target", [new TextEncoder().encode(targetContent)]);

      // Poor match - completely different content
      await store.store("base1", [new TextEncoder().encode("X".repeat(150))]);
      // Good match - shares the common prefix
      await store.store("base2", [
        new TextEncoder().encode(`${commonPrefix}Different ending here.`),
      ]);
      // Medium match - partial overlap
      await store.store("base3", [new TextEncoder().encode("This is a common prefix")]);

      const result = await store.deltify("target", ["base1", "base2", "base3"]);
      expect(result).toBe(true);

      // Verify delta was created
      const deltaInfo = await deltaStore.loadDelta("target");
      expect(deltaInfo).toBeDefined();
      // Should have chosen base2 as it's the best match
      expect(deltaInfo?.baseKey).toBe("base2");
    });
  });

  describe("deltify() respecting maxChainDepth", () => {
    it("skips candidates that would exceed max chain depth", async () => {
      // Create content that's large enough for delta compression
      const prefix = "This is common content used for testing delta chain depth limits. ";
      const baseContent = prefix.repeat(3);

      await store.store("base", [new TextEncoder().encode(baseContent)]);
      await store.store("d1", [new TextEncoder().encode(`${baseContent} d1 suffix`)]);
      await store.store("d2", [new TextEncoder().encode(`${baseContent} d1 d2 suffix`)]);
      await store.store("d3", [new TextEncoder().encode(`${baseContent} d1 d2 d3 suffix`)]);

      // Create delta chain using valid deltas
      const d1Delta = createValidDelta(new TextEncoder().encode(baseContent), [
        { type: "copy", start: 0, len: baseContent.length },
        { type: "insert", data: new TextEncoder().encode(" d1 suffix") },
      ]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "d1" }, d1Delta);

      const d2Delta = createValidDelta(new TextEncoder().encode(`${baseContent} d1 suffix`), [
        { type: "copy", start: 0, len: baseContent.length + 10 },
        { type: "insert", data: new TextEncoder().encode(" d2 suffix") },
      ]);
      await storeDelta(deltaStore, { baseKey: "d1", targetKey: "d2" }, d2Delta);

      const d3Delta = createValidDelta(new TextEncoder().encode(`${baseContent} d1 d2 suffix`), [
        { type: "copy", start: 0, len: baseContent.length + 14 },
        { type: "insert", data: new TextEncoder().encode(" d3 suffix") },
      ]);
      await storeDelta(deltaStore, { baseKey: "d2", targetKey: "d3" }, d3Delta);

      // Create store with low maxChainDepth
      const lowDepthStore = new RawStoreWithDelta({
        objects: rawStore,
        deltas: deltaStore,
        maxChainDepth: 2,
        maxRatio: 0.95,
      });

      // Store target
      const targetContent = `${baseContent} target specific suffix that is unique`;
      await rawStore.store("target", [new TextEncoder().encode(targetContent)]);

      // d3 has depth 3, so it would exceed maxChainDepth of 2
      // Should use base directly instead
      const result = await lowDepthStore.deltify("target", ["d3", "base"]);
      expect(result).toBe(true);

      const deltaInfo = await deltaStore.loadDelta("target");
      // Should have chosen base since d3 would exceed depth
      expect(deltaInfo?.baseKey).toBe("base");
    });
  });

  describe("deltify() with custom options", () => {
    it("respects maxRatio option", async () => {
      const content = "This is test content that we want to deltify.".repeat(3);
      await store.store("base", [new TextEncoder().encode(content)]);
      await store.store("target", [new TextEncoder().encode(`${content} with extra`)]);

      // With very strict ratio, may not deltify
      const result = await store.deltify("target", ["base"], { maxRatio: 0.01 });
      // Very strict ratio means most deltas won't pass
      expect(result).toBe(false);
    });
  });
});

describe("RawStoreWithDelta - Undeltify and Delta Chain Resolution", () => {
  let rawStore: MemoryRawStore;
  let deltaStore: MockDeltaStore;
  let store: RawStoreWithDelta;

  beforeEach(() => {
    rawStore = new MemoryRawStore();
    deltaStore = new MockDeltaStore();
    store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });
  });

  describe("undeltify()", () => {
    it("converts delta back to loose object", async () => {
      // Store base
      const baseContent = new TextEncoder().encode("base content here");
      await rawStore.store("base", [baseContent]);

      // Store delta that copies from base with correct checksum
      const delta = createValidDelta(baseContent, [{ type: "copy", start: 0, len: 17 }]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "target" }, delta);

      // Verify it's a delta
      expect(await store.isDelta("target")).toBe(true);

      // Undeltify
      await store.undeltify("target");

      // Should no longer be a delta
      expect(await store.isDelta("target")).toBe(false);

      // Should be loadable from raw store
      expect(await rawStore.has("target")).toBe(true);

      // Content should be correct
      const loaded = await collectBytes(store.load("target"));
      expect(new TextDecoder().decode(loaded)).toBe("base content here");
    });

    it("does nothing for non-delta object", async () => {
      await rawStore.store("loose", [new TextEncoder().encode("loose content")]);

      // Calling undeltify on non-delta should be a no-op
      await store.undeltify("loose");

      // Should still be loadable
      const loaded = await collectBytes(store.load("loose"));
      expect(new TextDecoder().decode(loaded)).toBe("loose content");
    });

    it("resolves delta chain during undeltify", async () => {
      // Create chain: target -> middle -> base
      const baseContent = new TextEncoder().encode("base");
      await rawStore.store("base", [baseContent]);

      // middle = "base" + "M" = "baseM"
      const middleDelta = createValidDelta(baseContent, [
        { type: "copy", start: 0, len: 4 },
        { type: "insert", data: new TextEncoder().encode("M") },
      ]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "middle" }, middleDelta);

      // target = "baseM" + "T" = "baseMT"
      const middleContent = new TextEncoder().encode("baseM");
      const targetDelta = createValidDelta(middleContent, [
        { type: "copy", start: 0, len: 5 },
        { type: "insert", data: new TextEncoder().encode("T") },
      ]);
      await storeDelta(deltaStore, { baseKey: "middle", targetKey: "target" }, targetDelta);

      // Undeltify target
      await store.undeltify("target");

      // Should be loose now
      expect(await store.isDelta("target")).toBe(false);

      // Content should be fully resolved
      const loaded = await collectBytes(store.load("target"));
      expect(new TextDecoder().decode(loaded)).toBe("baseMT");
    });
  });

  describe("isDelta()", () => {
    it("returns false for loose objects", async () => {
      await rawStore.store("loose", [new TextEncoder().encode("content")]);
      expect(await store.isDelta("loose")).toBe(false);
    });

    it("returns true for delta objects", async () => {
      await rawStore.store("base", [new TextEncoder().encode("base")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta" }, [
        { type: "start", targetLen: 4 },
        { type: "copy", start: 0, len: 4 },
        { type: "finish", checksum: 0 },
      ]);

      expect(await store.isDelta("delta")).toBe(true);
    });

    it("returns false for non-existent objects", async () => {
      expect(await store.isDelta("nonexistent")).toBe(false);
    });
  });

  describe("getDeltaChainInfo()", () => {
    it("returns undefined for non-delta", async () => {
      await rawStore.store("loose", [new TextEncoder().encode("content")]);
      const info = await store.getDeltaChainInfo("loose");
      expect(info).toBeUndefined();
    });

    it("returns chain info for single delta", async () => {
      await rawStore.store("base", [new TextEncoder().encode("base")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta" }, [
        { type: "start", targetLen: 4 },
        { type: "copy", start: 0, len: 4 },
        { type: "finish", checksum: 0 },
      ]);

      const info = await store.getDeltaChainInfo("delta");
      expect(info).toBeDefined();
      expect(info?.depth).toBe(1);
      expect(info?.chain).toContain("delta");
      expect(info?.chain).toContain("base");
    });

    it("returns chain info for deep chain", async () => {
      await rawStore.store("base", [new TextEncoder().encode("base")]);

      // Create chain: d3 -> d2 -> d1 -> base
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "d1" }, [
        { type: "start", targetLen: 4 },
        { type: "copy", start: 0, len: 4 },
        { type: "finish", checksum: 0 },
      ]);
      await storeDelta(deltaStore, { baseKey: "d1", targetKey: "d2" }, [
        { type: "start", targetLen: 4 },
        { type: "copy", start: 0, len: 4 },
        { type: "finish", checksum: 0 },
      ]);
      await storeDelta(deltaStore, { baseKey: "d2", targetKey: "d3" }, [
        { type: "start", targetLen: 4 },
        { type: "copy", start: 0, len: 4 },
        { type: "finish", checksum: 0 },
      ]);

      const info = await store.getDeltaChainInfo("d3");
      expect(info).toBeDefined();
      expect(info?.depth).toBe(3);
      expect(info?.chain).toEqual(["d3", "d2", "d1", "base"]);
    });
  });

  describe("load() - delta chain resolution", () => {
    it("resolves single delta", async () => {
      const baseContent = new TextEncoder().encode("base content");
      await rawStore.store("base", [baseContent]);

      const delta = createValidDelta(baseContent, [{ type: "copy", start: 0, len: 12 }]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "target" }, delta);

      const loaded = await collectBytes(store.load("target"));
      expect(new TextDecoder().decode(loaded)).toBe("base content");
    });

    it("resolves deep delta chain", async () => {
      // base = "A"
      const baseContent = new TextEncoder().encode("A");
      await rawStore.store("base", [baseContent]);

      // d1 = "A" + "B" = "AB"
      const d1Delta = createValidDelta(baseContent, [
        { type: "copy", start: 0, len: 1 },
        { type: "insert", data: new TextEncoder().encode("B") },
      ]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "d1" }, d1Delta);

      // d2 = "AB" + "C" = "ABC"
      const d1Content = new TextEncoder().encode("AB");
      const d2Delta = createValidDelta(d1Content, [
        { type: "copy", start: 0, len: 2 },
        { type: "insert", data: new TextEncoder().encode("C") },
      ]);
      await storeDelta(deltaStore, { baseKey: "d1", targetKey: "d2" }, d2Delta);

      // d3 = "ABC" + "D" = "ABCD"
      const d2Content = new TextEncoder().encode("ABC");
      const d3Delta = createValidDelta(d2Content, [
        { type: "copy", start: 0, len: 3 },
        { type: "insert", data: new TextEncoder().encode("D") },
      ]);
      await storeDelta(deltaStore, { baseKey: "d2", targetKey: "d3" }, d3Delta);

      const loaded = await collectBytes(store.load("d3"));
      expect(new TextDecoder().decode(loaded)).toBe("ABCD");
    });

    it("loads with offset from delta", async () => {
      const baseContent = new TextEncoder().encode("hello world");
      await rawStore.store("base", [baseContent]);

      const delta = createValidDelta(baseContent, [{ type: "copy", start: 0, len: 11 }]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta" }, delta);

      const loaded = await collectBytes(store.load("delta", { offset: 6 }));
      expect(new TextDecoder().decode(loaded)).toBe("world");
    });
  });
});

describe("RawStoreWithDelta - Keys Enumeration", () => {
  let rawStore: MemoryRawStore;
  let deltaStore: MockDeltaStore;
  let store: RawStoreWithDelta;

  beforeEach(() => {
    rawStore = new MemoryRawStore();
    deltaStore = new MockDeltaStore();
    store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });
  });

  describe("keys()", () => {
    it("returns empty for empty stores", async () => {
      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }
      expect(keys).toHaveLength(0);
    });

    it("returns loose object keys", async () => {
      await store.store("key1", [new TextEncoder().encode("content1")]);
      await store.store("key2", [new TextEncoder().encode("content2")]);

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys).toHaveLength(2);
    });

    it("returns delta object keys", async () => {
      await rawStore.store("base", [new TextEncoder().encode("base")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta1" }, [
        { type: "start", targetLen: 4 },
        { type: "finish", checksum: 0 },
      ]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta2" }, [
        { type: "start", targetLen: 4 },
        { type: "finish", checksum: 0 },
      ]);

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toContain("base");
      expect(keys).toContain("delta1");
      expect(keys).toContain("delta2");
      expect(keys).toHaveLength(3);
    });

    it("returns combined keys from both stores", async () => {
      await store.store("loose1", [new TextEncoder().encode("content1")]);
      await store.store("loose2", [new TextEncoder().encode("content2")]);
      await storeDelta(deltaStore, { baseKey: "loose1", targetKey: "delta1" }, [
        { type: "start", targetLen: 8 },
        { type: "finish", checksum: 0 },
      ]);

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      expect(keys).toContain("loose1");
      expect(keys).toContain("loose2");
      expect(keys).toContain("delta1");
      expect(keys).toHaveLength(3);
    });

    it("deduplicates keys present in both stores", async () => {
      // Store in raw store
      await store.store("shared", [new TextEncoder().encode("loose content")]);
      // Also store as delta (unusual but possible)
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "shared" }, [
        { type: "start", targetLen: 4 },
        { type: "finish", checksum: 0 },
      ]);

      const keys: string[] = [];
      for await (const key of store.keys()) {
        keys.push(key);
      }

      // "shared" should appear only once
      const sharedCount = keys.filter((k) => k === "shared").length;
      expect(sharedCount).toBe(1);
    });

    it("yields keys in consistent order", async () => {
      // Store multiple objects
      for (let i = 0; i < 5; i++) {
        await store.store(`key${i}`, [new TextEncoder().encode(`content${i}`)]);
      }

      // Collect keys twice
      const keys1: string[] = [];
      const keys2: string[] = [];

      for await (const key of store.keys()) {
        keys1.push(key);
      }
      for await (const key of store.keys()) {
        keys2.push(key);
      }

      // Order should be consistent
      expect(keys1).toEqual(keys2);
    });
  });
});

describe("RawStoreWithDelta - Edge Cases", () => {
  let rawStore: MemoryRawStore;
  let deltaStore: MockDeltaStore;
  let store: RawStoreWithDelta;

  beforeEach(() => {
    rawStore = new MemoryRawStore();
    deltaStore = new MockDeltaStore();
    store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });
  });

  describe("empty objects", () => {
    it("stores and loads empty content", async () => {
      await store.store("empty", [new Uint8Array(0)]);

      const loaded = await collectBytes(store.load("empty"));
      expect(loaded.length).toBe(0);
    });

    it("reports correct size for empty object", async () => {
      await store.store("empty", [new Uint8Array(0)]);
      const size = await store.size("empty");
      expect(size).toBe(0);
    });
  });

  describe("large objects", () => {
    it("handles large content", async () => {
      const largeContent = new Uint8Array(100000);
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }

      await store.store("large", [largeContent]);

      const loaded = await collectBytes(store.load("large"));
      expect(loaded.length).toBe(100000);
      expect(loaded).toEqual(largeContent);
    });

    it("handles large content in chunks", async () => {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < 100; i++) {
        const chunk = new Uint8Array(1000);
        chunk.fill(i % 256);
        chunks.push(chunk);
      }

      await store.store(
        "large-chunked",
        (async function* () {
          for (const chunk of chunks) yield chunk;
        })(),
      );

      const loaded = await collectBytes(store.load("large-chunked"));
      expect(loaded.length).toBe(100000);
    });
  });

  describe("error handling", () => {
    it("throws when loading non-existent object", async () => {
      await expect(collectBytes(store.load("nonexistent"))).rejects.toThrow(/not found/i);
    });

    it("throws when delta base is missing", async () => {
      // Store delta without base
      await storeDelta(deltaStore, { baseKey: "missing-base", targetKey: "orphan" }, [
        { type: "start", targetLen: 4 },
        { type: "copy", start: 0, len: 4 },
        { type: "finish", checksum: 0 },
      ]);

      await expect(collectBytes(store.load("orphan"))).rejects.toThrow();
    });
  });

  describe("object in both stores", () => {
    it("prefers delta store for has()", async () => {
      await rawStore.store("both", [new TextEncoder().encode("loose")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "both" }, [
        { type: "start", targetLen: 4 },
        { type: "finish", checksum: 0 },
      ]);

      // Should return true (delta exists)
      expect(await store.has("both")).toBe(true);
    });

    it("loads from delta when object exists in both", async () => {
      // Store base
      const baseContent = new TextEncoder().encode("base");
      await rawStore.store("base", [baseContent]);
      // Store loose version
      await rawStore.store("both", [new TextEncoder().encode("loose version")]);
      // Store delta version with valid checksum
      const delta = createValidDelta(baseContent, [{ type: "copy", start: 0, len: 4 }]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "both" }, delta);

      // Load should prefer delta
      const loaded = await collectBytes(store.load("both"));
      expect(new TextDecoder().decode(loaded)).toBe("base");
    });

    it("delete removes from both stores", async () => {
      await rawStore.store("both", [new TextEncoder().encode("loose")]);
      await storeDelta(deltaStore, { baseKey: "base", targetKey: "both" }, [
        { type: "start", targetLen: 4 },
        { type: "finish", checksum: 0 },
      ]);

      await store.delete("both");

      expect(await store.has("both")).toBe(false);
      expect(await rawStore.has("both")).toBe(false);
      expect(await deltaStore.isDelta("both")).toBe(false);
    });
  });

  describe("binary content", () => {
    it("handles binary data correctly", async () => {
      const binary = new Uint8Array([0, 1, 127, 128, 255, 0, 0, 255]);
      await store.store("binary", [binary]);

      const loaded = await collectBytes(store.load("binary"));
      expect(loaded).toEqual(binary);
    });

    it("handles null bytes in content", async () => {
      const withNulls = new Uint8Array([0, 0, 0, 65, 0, 66, 0, 0]);
      await store.store("nulls", [withNulls]);

      const loaded = await collectBytes(store.load("nulls"));
      expect(loaded).toEqual(withNulls);
    });
  });

  describe("constructor validation", () => {
    it("uses default maxRatio when not provided", () => {
      const s = new RawStoreWithDelta({
        objects: rawStore,
        deltas: deltaStore,
      });
      expect(s.maxRatio).toBe(0.75);
    });

    it("uses provided maxRatio", () => {
      const s = new RawStoreWithDelta({
        objects: rawStore,
        deltas: deltaStore,
        maxRatio: 0.5,
      });
      expect(s.maxRatio).toBe(0.5);
    });

    it("uses provided minSize", () => {
      const s = new RawStoreWithDelta({
        objects: rawStore,
        deltas: deltaStore,
        minSize: 100,
      });
      expect(s.minSize).toBe(100);
    });
  });

  describe("batch operations", () => {
    it("batches multiple deltify operations", async () => {
      // Store base content
      const baseContent =
        "This is base content that will be used for delta compression testing. " +
        "The content needs to be long enough so the rolling hash algorithm works properly.";
      await store.store("base", [new TextEncoder().encode(baseContent)]);

      // Store target objects
      const target1Content = baseContent.replace("base", "first");
      const target2Content = baseContent.replace("base", "second");
      await store.store("target1", [new TextEncoder().encode(target1Content)]);
      await store.store("target2", [new TextEncoder().encode(target2Content)]);

      // Start batch
      store.startBatch();
      expect(store.isBatchInProgress()).toBe(true);

      try {
        // Multiple deltify operations within batch
        await store.deltify("target1", ["base"]);
        await store.deltify("target2", ["base"]);

        // End batch
        await store.endBatch();
      } catch (e) {
        store.cancelBatch();
        throw e;
      }

      expect(store.isBatchInProgress()).toBe(false);

      // Verify both targets are now deltas
      expect(await store.isDelta("target1")).toBe(true);
      expect(await store.isDelta("target2")).toBe(true);
    });

    it("throws when starting batch while one is in progress", async () => {
      store.startBatch();
      expect(() => store.startBatch()).toThrow("Batch already in progress");
      store.cancelBatch();
    });

    it("throws when ending batch without starting one", async () => {
      await expect(store.endBatch()).rejects.toThrow("No batch in progress");
    });

    it("cancelBatch clears the batch state", async () => {
      store.startBatch();
      expect(store.isBatchInProgress()).toBe(true);

      store.cancelBatch();
      expect(store.isBatchInProgress()).toBe(false);

      // Should be able to start a new batch after canceling
      store.startBatch();
      expect(store.isBatchInProgress()).toBe(true);
      store.cancelBatch();
    });

    it("deltify works normally without batch", async () => {
      // Store base content
      const baseContent =
        "This is base content that will be used for delta compression testing. " +
        "The content needs to be long enough so the rolling hash algorithm works properly.";
      await store.store("base2", [new TextEncoder().encode(baseContent)]);

      // Store target
      const targetContent = baseContent.replace("base", "modified");
      await store.store("target3", [new TextEncoder().encode(targetContent)]);

      // Deltify without batch
      expect(store.isBatchInProgress()).toBe(false);
      const success = await store.deltify("target3", ["base2"]);

      expect(success).toBe(true);
      expect(await store.isDelta("target3")).toBe(true);
    });
  });
});

describe("defaultComputeDelta", () => {
  function createSource(data: Uint8Array) {
    return async function* (_options?: { offset?: number; length?: number }) {
      yield data;
    };
  }

  it("computes delta between similar content", async () => {
    // Content must be >= 50 bytes (default minSize)
    const base = new TextEncoder().encode(
      "The quick brown fox jumps over the lazy dog. This is a longer sentence.",
    );
    const target = new TextEncoder().encode(
      "The quick brown fox jumps over the lazy cat. This is a longer sentence.",
    );

    const result = await defaultComputeDelta(createSource(base), createSource(target));

    expect(result).toBeDefined();
    expect(result?.delta).toBeDefined();
    expect(result?.ratio).toBeLessThan(1);
  });

  it("returns undefined for small content", async () => {
    const base = new TextEncoder().encode("ab");
    const target = new TextEncoder().encode("cd");

    const result = await defaultComputeDelta(createSource(base), createSource(target), {
      minSize: 10,
    });

    expect(result).toBeUndefined();
  });

  it("returns undefined when ratio exceeds maxRatio", async () => {
    const base = new TextEncoder().encode("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    const target = new TextEncoder().encode("ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ");

    const result = await defaultComputeDelta(createSource(base), createSource(target), {
      maxRatio: 0.1,
    });

    expect(result).toBeUndefined();
  });

  it("produces valid delta for identical content", async () => {
    // Content must be >= 50 bytes (default minSize)
    const content = new TextEncoder().encode(
      "Identical content for both base and target. This text needs to be long enough.",
    );

    const result = await defaultComputeDelta(createSource(content), createSource(content));

    expect(result).toBeDefined();
    expect(result?.ratio).toBeLessThan(0.5); // Should be very compressed
  });
});
