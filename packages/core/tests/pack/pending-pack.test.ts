/**
 * Tests for PendingPack
 *
 * Tests object buffering, threshold detection, and pack generation.
 */

import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll, describe, expect, it } from "vitest";
import { PackObjectType, PendingPack, readPackIndex } from "../../src/pack/index.js";

// Set up Node.js compression before tests
beforeAll(() => {
  setCompression(createNodeCompression());
});

describe("PendingPack", () => {
  describe("basic operations", () => {
    it("starts empty", () => {
      const pending = new PendingPack();
      expect(pending.objectCount).toBe(0);
      expect(pending.size).toBe(0);
      expect(pending.isEmpty()).toBe(true);
      expect(pending.shouldFlush()).toBe(false);
    });

    it("tracks added objects", () => {
      const pending = new PendingPack();

      pending.addObject(
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        PackObjectType.BLOB,
        new Uint8Array([1, 2, 3, 4, 5]),
      );

      expect(pending.objectCount).toBe(1);
      expect(pending.size).toBe(5);
      expect(pending.isEmpty()).toBe(false);
    });

    it("tracks added deltas", () => {
      const pending = new PendingPack();

      pending.addDelta(
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        new Uint8Array([10, 20, 30]),
      );

      expect(pending.objectCount).toBe(1);
      expect(pending.size).toBe(3);
    });

    it("accumulates size", () => {
      const pending = new PendingPack();

      pending.addObject("a".repeat(40), PackObjectType.BLOB, new Uint8Array(100));
      pending.addObject("b".repeat(40), PackObjectType.BLOB, new Uint8Array(200));
      pending.addDelta("c".repeat(40), "a".repeat(40), new Uint8Array(50));

      expect(pending.objectCount).toBe(3);
      expect(pending.size).toBe(350);
    });

    it("clears all entries", () => {
      const pending = new PendingPack();

      pending.addObject("a".repeat(40), PackObjectType.BLOB, new Uint8Array(100));
      pending.addObject("b".repeat(40), PackObjectType.BLOB, new Uint8Array(100));
      pending.clear();

      expect(pending.objectCount).toBe(0);
      expect(pending.size).toBe(0);
      expect(pending.isEmpty()).toBe(true);
    });

    it("checks pending IDs", () => {
      const pending = new PendingPack();
      const id1 = "1111111111111111111111111111111111111111";
      const id2 = "2222222222222222222222222222222222222222";

      pending.addObject(id1, PackObjectType.BLOB, new Uint8Array([1]));

      expect(pending.hasPending(id1)).toBe(true);
      expect(pending.hasPending(id2)).toBe(false);

      const ids = pending.getPendingIds();
      expect(ids).toContain(id1);
      expect(ids).not.toContain(id2);
    });
  });

  describe("threshold detection", () => {
    it("triggers on object count threshold", () => {
      const pending = new PendingPack({ maxObjects: 3, maxBytes: 1000000 });

      pending.addObject("a".repeat(40), PackObjectType.BLOB, new Uint8Array([1]));
      expect(pending.shouldFlush()).toBe(false);

      pending.addObject("b".repeat(40), PackObjectType.BLOB, new Uint8Array([2]));
      expect(pending.shouldFlush()).toBe(false);

      pending.addObject("c".repeat(40), PackObjectType.BLOB, new Uint8Array([3]));
      expect(pending.shouldFlush()).toBe(true);
    });

    it("triggers on byte threshold", () => {
      const pending = new PendingPack({ maxObjects: 1000, maxBytes: 100 });

      pending.addObject("a".repeat(40), PackObjectType.BLOB, new Uint8Array(50));
      expect(pending.shouldFlush()).toBe(false);

      pending.addObject("b".repeat(40), PackObjectType.BLOB, new Uint8Array(60));
      expect(pending.shouldFlush()).toBe(true);
    });

    it("uses default thresholds", () => {
      const pending = new PendingPack();

      // Should not trigger with just a few objects
      for (let i = 0; i < 10; i++) {
        pending.addObject(`${i}`.padStart(40, "0"), PackObjectType.BLOB, new Uint8Array([i]));
      }
      expect(pending.shouldFlush()).toBe(false);
    });
  });

  describe("flush", () => {
    it("generates valid pack from single object", async () => {
      const pending = new PendingPack();
      const content = new TextEncoder().encode("hello world");

      pending.addObject("1234567890abcdef1234567890abcdef12345678", PackObjectType.BLOB, content);

      const result = await pending.flush();

      // Verify pack structure
      expect(result.packName).toMatch(/^pack-[a-z0-9]+$/);
      expect(result.packData.length).toBeGreaterThan(32);
      expect(result.indexData.length).toBeGreaterThan(0);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe("1234567890abcdef1234567890abcdef12345678");
    });

    it("generates valid pack from multiple objects", async () => {
      const pending = new PendingPack();

      pending.addObject(
        "1111111111111111111111111111111111111111",
        PackObjectType.BLOB,
        new TextEncoder().encode("content1"),
      );
      pending.addObject(
        "2222222222222222222222222222222222222222",
        PackObjectType.BLOB,
        new TextEncoder().encode("content2"),
      );
      pending.addObject(
        "3333333333333333333333333333333333333333",
        PackObjectType.BLOB,
        new TextEncoder().encode("content3"),
      );

      const result = await pending.flush();

      expect(result.entries).toHaveLength(3);
      // Entries should be sorted by ID
      expect(result.entries[0].id).toBe("1111111111111111111111111111111111111111");
      expect(result.entries[1].id).toBe("2222222222222222222222222222222222222222");
      expect(result.entries[2].id).toBe("3333333333333333333333333333333333333333");
    });

    it("generates valid pack index", async () => {
      const pending = new PendingPack();

      pending.addObject(
        "abcdef1234567890abcdef1234567890abcdef12",
        PackObjectType.BLOB,
        new TextEncoder().encode("test content"),
      );

      const result = await pending.flush();
      const index = readPackIndex(result.indexData);

      expect(index.version).toBe(2);
      expect(index.objectCount).toBe(1);
      expect(index.has("abcdef1234567890abcdef1234567890abcdef12")).toBe(true);
    });

    it("clears entries after flush", async () => {
      const pending = new PendingPack();

      pending.addObject("a".repeat(40), PackObjectType.BLOB, new Uint8Array([1]));
      expect(pending.objectCount).toBe(1);

      await pending.flush();

      expect(pending.objectCount).toBe(0);
      expect(pending.size).toBe(0);
      expect(pending.isEmpty()).toBe(true);
    });

    it("handles empty flush", async () => {
      const pending = new PendingPack();
      const result = await pending.flush();

      // Should produce valid empty pack
      expect(result.packData.length).toBe(32); // header (12) + checksum (20)
      expect(result.entries).toHaveLength(0);
    });

    it("generates unique pack names", async () => {
      const pending1 = new PendingPack();
      pending1.addObject("a".repeat(40), PackObjectType.BLOB, new Uint8Array([1]));
      const result1 = await pending1.flush();

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      const pending2 = new PendingPack();
      pending2.addObject("b".repeat(40), PackObjectType.BLOB, new Uint8Array([2]));
      const result2 = await pending2.flush();

      expect(result1.packName).not.toBe(result2.packName);
    });
  });

  describe("delta objects", () => {
    it("handles REF_DELTA when base not in pack", async () => {
      const pending = new PendingPack();

      // Add delta without base in this pack
      // This should use REF_DELTA format
      const baseId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      // Simple delta: just copy header
      const delta = new Uint8Array([
        10, // base size
        10, // result size
        0x80 | 0x01 | 0x10, // copy cmd with offset byte 1 and size byte 1
        0, // offset = 0
        10, // size = 10
      ]);

      pending.addDelta(targetId, baseId, delta);

      const result = await pending.flush();

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe(targetId);
    });

    it("handles OFS_DELTA when base is in pack", async () => {
      const pending = new PendingPack();

      // Add base object first
      const baseId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
      const baseContent = new TextEncoder().encode("base content");

      pending.addObject(baseId, PackObjectType.BLOB, baseContent);

      // Add delta that references base
      const delta = new Uint8Array([
        12, // base size (matches "base content")
        12, // result size
        0x80 | 0x01 | 0x10, // copy cmd
        0, // offset = 0
        12, // size = 12
      ]);

      pending.addDelta(targetId, baseId, delta);

      const result = await pending.flush();

      expect(result.entries).toHaveLength(2);
      // Both should be in pack
      const ids = result.entries.map((e) => e.id);
      expect(ids).toContain(baseId);
      expect(ids).toContain(targetId);
    });

    it("writes full objects before deltas", async () => {
      const pending = new PendingPack();

      // Add delta first
      const baseId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      pending.addDelta(targetId, baseId, new Uint8Array([5, 5, 0x85, 0, 5]));

      // Then add base
      pending.addObject(baseId, PackObjectType.BLOB, new Uint8Array(5));

      const result = await pending.flush();

      // Both should be present
      expect(result.entries).toHaveLength(2);

      // Base should have lower offset (written first)
      const baseEntry = result.entries.find((e) => e.id === baseId);
      const targetEntry = result.entries.find((e) => e.id === targetId);
      expect(baseEntry).toBeDefined();
      expect(targetEntry).toBeDefined();
      expect(baseEntry?.offset).toBeLessThan(targetEntry?.offset);
    });
  });

  describe("delta inspection", () => {
    it("isDelta returns true for pending delta", () => {
      const pending = new PendingPack();
      const baseId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      pending.addDelta(targetId, baseId, new Uint8Array([5, 5, 0x85, 0, 5]));

      expect(pending.isDelta(targetId)).toBe(true);
    });

    it("isDelta returns false for pending full object", () => {
      const pending = new PendingPack();
      const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      pending.addObject(id, PackObjectType.BLOB, new Uint8Array([1, 2, 3]));

      expect(pending.isDelta(id)).toBe(false);
    });

    it("isDelta returns false for unknown object", () => {
      const pending = new PendingPack();

      expect(pending.isDelta("cccccccccccccccccccccccccccccccccccccccc")).toBe(false);
    });

    it("getDeltaBase returns base ID for delta", () => {
      const pending = new PendingPack();
      const baseId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      pending.addDelta(targetId, baseId, new Uint8Array([5, 5, 0x85, 0, 5]));

      expect(pending.getDeltaBase(targetId)).toBe(baseId);
    });

    it("getDeltaBase returns undefined for full object", () => {
      const pending = new PendingPack();
      const id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

      pending.addObject(id, PackObjectType.BLOB, new Uint8Array([1, 2, 3]));

      expect(pending.getDeltaBase(id)).toBeUndefined();
    });

    it("getDeltaBase returns undefined for unknown object", () => {
      const pending = new PendingPack();

      expect(pending.getDeltaBase("cccccccccccccccccccccccccccccccccccccccc")).toBeUndefined();
    });
  });

  describe("object types", () => {
    it("handles COMMIT objects", async () => {
      const pending = new PendingPack();
      const commitContent =
        "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
        "author Test <test@test.com> 1234567890 +0000\n" +
        "committer Test <test@test.com> 1234567890 +0000\n\n" +
        "Test commit\n";

      pending.addObject(
        "c".repeat(40),
        PackObjectType.COMMIT,
        new TextEncoder().encode(commitContent),
      );

      const result = await pending.flush();
      expect(result.entries).toHaveLength(1);
    });

    it("handles TREE objects", async () => {
      const pending = new PendingPack();
      const treeContent = new Uint8Array([
        ...new TextEncoder().encode("100644 test.txt"),
        0,
        ...new Uint8Array(20).fill(0xab),
      ]);

      pending.addObject("t".repeat(40), PackObjectType.TREE, treeContent);

      const result = await pending.flush();
      expect(result.entries).toHaveLength(1);
    });

    it("handles TAG objects", async () => {
      const pending = new PendingPack();
      const tagContent =
        "object 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
        "type commit\n" +
        "tag v1.0\n" +
        "tagger Test <test@test.com> 1234567890 +0000\n\n" +
        "Version 1.0\n";

      pending.addObject("9".repeat(40), PackObjectType.TAG, new TextEncoder().encode(tagContent));

      const result = await pending.flush();
      expect(result.entries).toHaveLength(1);
    });
  });
});
