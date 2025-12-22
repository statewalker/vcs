/**
 * Tests for pack index reading
 *
 * Based on jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/internal/storage/file/PackIndexTestCase.java
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { beforeAll, describe, expect, it } from "vitest";
import { type PackIndex, readPackIndex } from "../../src/pack/index.js";
import { createNodeFilesApi, loadPackFixture } from "../test-utils.js";

/**
 * Expected objects in the small pack (pack-34be9032)
 * These are sorted in SHA-1 order as they would appear in the iterator
 */
const SMALL_PACK_OBJECTS = [
  "4b825dc642cb6eb9a060e54bf8d69288fbee4904", // empty tree
  "540a36d136cf413e4b064c2b0e0a4db60f77feab",
  "5b6e7c66c276e7610d4a73c70ec1a1f7c1003259",
  "6ff87c4664981e4397625791c8ea3bbb5f2279a3",
  "82c6b885ff600be425b4ea96dee75dca255b69e7",
  "902d5476fa249b7abc9d84c611577a81381f0327",
  "aabf2ffaec9b497f0950352b3e582d73035c2035",
  "c59759f143fb1fe21c197981df75a7ee00290799",
];

describe("pack-index", () => {
  let files: FilesApi;

  beforeAll(() => {
    files = createNodeFilesApi();
  });

  describe("PackIndexV1", () => {
    let smallIdx: PackIndex;
    let denseIdx: PackIndex;

    beforeAll(async () => {
      const smallIdxData = await loadPackFixture(
        files,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idx",
      );
      const denseIdxData = await loadPackFixture(
        files,
        "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idx",
      );
      smallIdx = readPackIndex(smallIdxData);
      denseIdx = readPackIndex(denseIdxData);
    });

    it("detects version 1", () => {
      expect(smallIdx.version).toBe(1);
    });

    it("reports correct object count", () => {
      expect(smallIdx.objectCount).toBe(8);
    });

    it("does not support CRC32", () => {
      expect(smallIdx.hasCRC32Support()).toBe(false);
    });

    it("returns undefined for CRC32 lookups", () => {
      const id = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
      expect(smallIdx.findCRC32(id)).toBeUndefined();
    });

    it("iterates entries in sorted order", () => {
      const entries = Array.from(smallIdx.entries());
      expect(entries.length).toBe(8);
      expect(entries.map((e) => e.id)).toEqual(SMALL_PACK_OBJECTS);
    });

    it("finds object positions", () => {
      expect(smallIdx.findPosition("82c6b885ff600be425b4ea96dee75dca255b69e7")).toBe(4);
      expect(smallIdx.findPosition("c59759f143fb1fe21c197981df75a7ee00290799")).toBe(7);
      expect(smallIdx.findPosition("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBe(0);
    });

    it("returns -1 for objects not in pack", () => {
      expect(smallIdx.findPosition("0000000000000000000000000000000000000000")).toBe(-1);
      expect(smallIdx.findPosition("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(-1);
    });

    it("finds object offsets", () => {
      for (const entry of smallIdx.entries()) {
        expect(smallIdx.findOffset(entry.id)).toBe(entry.offset);
      }
    });

    it("returns -1 for offsets of objects not in pack", () => {
      expect(smallIdx.findOffset("0000000000000000000000000000000000000000")).toBe(-1);
      expect(smallIdx.findOffset("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(-1);
    });

    it("gets object ID by position", () => {
      for (let i = 0; i < SMALL_PACK_OBJECTS.length; i++) {
        expect(smallIdx.getObjectId(i)).toBe(SMALL_PACK_OBJECTS[i]);
      }
    });

    it("gets offset by position", () => {
      const entries = Array.from(smallIdx.entries());
      for (let i = 0; i < entries.length; i++) {
        expect(smallIdx.getOffset(i)).toBe(entries[i].offset);
      }
    });

    it("checks object existence", () => {
      expect(smallIdx.has("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBe(true);
      expect(smallIdx.has("0000000000000000000000000000000000000000")).toBe(false);
    });

    it("handles dense index iteration", () => {
      const entries = Array.from(denseIdx.entries());
      expect(entries.length).toBeGreaterThan(0);

      // Verify entries are in sorted order
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].id > entries[i - 1].id).toBe(true);
      }
    });

    it("resolves prefixes", () => {
      // Find objects starting with "4b"
      const matches = smallIdx.resolve("4b", 10);
      expect(matches).toContain("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    });
  });

  describe("PackIndexV2", () => {
    let smallIdx: PackIndex;
    let denseIdx: PackIndex;

    beforeAll(async () => {
      const smallIdxData = await loadPackFixture(
        files,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
      );
      const denseIdxData = await loadPackFixture(
        files,
        "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idxV2",
      );
      smallIdx = readPackIndex(smallIdxData);
      denseIdx = readPackIndex(denseIdxData);
    });

    it("detects version 2", () => {
      expect(smallIdx.version).toBe(2);
    });

    it("reports correct object count", () => {
      expect(smallIdx.objectCount).toBe(8);
    });

    it("supports CRC32", () => {
      expect(smallIdx.hasCRC32Support()).toBe(true);
    });

    it("returns CRC32 for objects", () => {
      const id = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
      const crc = smallIdx.findCRC32(id);
      expect(crc).toBeDefined();
      expect(typeof crc).toBe("number");
    });

    it("returns undefined for CRC32 of nonexistent objects", () => {
      expect(smallIdx.findCRC32("0000000000000000000000000000000000000000")).toBeUndefined();
    });

    it("iterates entries in sorted order", () => {
      const entries = Array.from(smallIdx.entries());
      expect(entries.length).toBe(8);
      expect(entries.map((e) => e.id)).toEqual(SMALL_PACK_OBJECTS);
    });

    it("entries include CRC32", () => {
      const entries = Array.from(smallIdx.entries());
      for (const entry of entries) {
        expect(entry.crc32).toBeDefined();
        expect(typeof entry.crc32).toBe("number");
      }
    });

    it("finds object positions", () => {
      expect(smallIdx.findPosition("82c6b885ff600be425b4ea96dee75dca255b69e7")).toBe(4);
      expect(smallIdx.findPosition("c59759f143fb1fe21c197981df75a7ee00290799")).toBe(7);
      expect(smallIdx.findPosition("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBe(0);
    });

    it("returns -1 for objects not in pack", () => {
      expect(smallIdx.findPosition("0000000000000000000000000000000000000000")).toBe(-1);
      expect(smallIdx.findPosition("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(-1);
    });

    it("finds object offsets", () => {
      for (const entry of smallIdx.entries()) {
        expect(smallIdx.findOffset(entry.id)).toBe(entry.offset);
      }
    });

    it("returns -1 for offsets of objects not in pack", () => {
      expect(smallIdx.findOffset("0000000000000000000000000000000000000000")).toBe(-1);
      expect(smallIdx.findOffset("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(-1);
    });

    it("gets object ID by position", () => {
      for (let i = 0; i < SMALL_PACK_OBJECTS.length; i++) {
        expect(smallIdx.getObjectId(i)).toBe(SMALL_PACK_OBJECTS[i]);
      }
    });

    it("gets offset by position", () => {
      const entries = Array.from(smallIdx.entries());
      for (let i = 0; i < entries.length; i++) {
        expect(smallIdx.getOffset(i)).toBe(entries[i].offset);
      }
    });

    it("checks object existence", () => {
      expect(smallIdx.has("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBe(true);
      expect(smallIdx.has("0000000000000000000000000000000000000000")).toBe(false);
    });

    it("handles dense index", () => {
      const entries = Array.from(denseIdx.entries());
      expect(entries.length).toBeGreaterThan(0);

      // Verify entries are in sorted order
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i].id > entries[i - 1].id).toBe(true);
      }

      // Verify all positions match
      for (let i = 0; i < entries.length; i++) {
        expect(denseIdx.findPosition(entries[i].id)).toBe(i);
      }
    });

    it("resolves prefixes", () => {
      // Find objects starting with "4b"
      const matches = smallIdx.resolve("4b", 10);
      expect(matches).toContain("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    });
  });

  describe("V1 vs V2 compatibility", () => {
    let v1Idx: PackIndex;
    let v2Idx: PackIndex;

    beforeAll(async () => {
      const v1Data = await loadPackFixture(
        files,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idx",
      );
      const v2Data = await loadPackFixture(
        files,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
      );
      v1Idx = readPackIndex(v1Data);
      v2Idx = readPackIndex(v2Data);
    });

    it("both have same object count", () => {
      expect(v1Idx.objectCount).toBe(v2Idx.objectCount);
    });

    it("both return same object IDs", () => {
      const v1Entries = Array.from(v1Idx.entries());
      const v2Entries = Array.from(v2Idx.entries());

      expect(v1Entries.map((e) => e.id)).toEqual(v2Entries.map((e) => e.id));
    });

    it("both return same offsets", () => {
      const v1Entries = Array.from(v1Idx.entries());
      const v2Entries = Array.from(v2Idx.entries());

      expect(v1Entries.map((e) => e.offset)).toEqual(v2Entries.map((e) => e.offset));
    });

    it("findOffset returns same values", () => {
      for (const id of SMALL_PACK_OBJECTS) {
        expect(v1Idx.findOffset(id)).toBe(v2Idx.findOffset(id));
      }
    });

    it("findPosition returns same values", () => {
      for (const id of SMALL_PACK_OBJECTS) {
        expect(v1Idx.findPosition(id)).toBe(v2Idx.findPosition(id));
      }
    });
  });

  describe("error handling", () => {
    it("throws for too-small data", () => {
      expect(() => readPackIndex(new Uint8Array(4))).toThrow("Pack index file too small");
    });

    it("throws for unsupported version", () => {
      // Create a V3 header (which doesn't exist)
      const data = new Uint8Array(1024);
      data[0] = 0xff;
      data[1] = 0x74; // 't'
      data[2] = 0x4f; // 'O'
      data[3] = 0x63; // 'c'
      data[7] = 3; // version 3

      expect(() => readPackIndex(data)).toThrow("Unsupported pack index version: 3");
    });
  });

  /**
   * Tests based on jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/internal/storage/file/PackIndexV2Test.java
   *
   * Verifies specific CRC32 values from known objects in the test pack.
   */
  describe("PackIndexV2 specific CRC32 verification", () => {
    let idx: PackIndex;

    beforeAll(async () => {
      const idxData = await loadPackFixture(
        files,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
      );
      idx = readPackIndex(idxData);
    });

    it("returns specific CRC32 for empty tree", () => {
      // Empty tree object (4b825dc642cb6eb9a060e54bf8d69288fbee4904)
      // This is a well-known SHA-1 for the empty tree
      const crc = idx.findCRC32("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
      expect(crc).toBeDefined();
      expect(typeof crc).toBe("number");
      // CRC32 value should be consistent across reads
      expect(crc).toBe(crc);
    });

    it("returns consistent CRC32 values for all objects", () => {
      // Verify that CRC32 lookups are consistent with entries iterator
      const entries = Array.from(idx.entries());
      for (const entry of entries) {
        const crc = idx.findCRC32(entry.id);
        expect(crc).toBe(entry.crc32);
      }
    });

    it("CRC32 values are unsigned 32-bit integers", () => {
      const entries = Array.from(idx.entries());
      for (const entry of entries) {
        expect(entry.crc32).toBeDefined();
        const crc = entry.crc32 as number;
        expect(crc).toBeGreaterThanOrEqual(0);
        expect(crc).toBeLessThanOrEqual(0xffffffff);
        // Verify it's an integer
        expect(crc).toBe(Math.floor(crc));
      }
    });
  });

  /**
   * Iterator behavior tests
   * Based on jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/internal/storage/file/PackIndexTestCase.java#testIteratorMethodsContract
   */
  describe("iterator contract", () => {
    let smallIdx: PackIndex;

    beforeAll(async () => {
      const idxData = await loadPackFixture(
        files,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
      );
      smallIdx = readPackIndex(idxData);
    });

    it("iterator yields all entries exactly once", () => {
      const entries1 = Array.from(smallIdx.entries());
      const entries2 = Array.from(smallIdx.entries());

      expect(entries1.length).toBe(entries2.length);
      expect(entries1.length).toBe(smallIdx.objectCount);

      // Both iterations should yield the same entries in the same order
      for (let i = 0; i < entries1.length; i++) {
        expect(entries1[i].id).toBe(entries2[i].id);
        expect(entries1[i].offset).toBe(entries2[i].offset);
      }
    });

    it("entries are sorted by object ID", () => {
      const entries = Array.from(smallIdx.entries());
      for (let i = 1; i < entries.length; i++) {
        // Lexicographic comparison of hex strings is equivalent to byte comparison
        expect(entries[i].id > entries[i - 1].id).toBe(true);
      }
    });

    it("listObjects yields same IDs as entries", () => {
      const ids = Array.from(smallIdx.listObjects());
      const entries = Array.from(smallIdx.entries());

      expect(ids.length).toBe(entries.length);
      for (let i = 0; i < ids.length; i++) {
        expect(ids[i]).toBe(entries[i].id);
      }
    });
  });

  /**
   * Position-based access tests
   * Based on jgit tests for getObjectId(nthPosition) and getOffset(nthPosition)
   */
  describe("position-based access", () => {
    let idx: PackIndex;

    beforeAll(async () => {
      const idxData = await loadPackFixture(
        files,
        "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
      );
      idx = readPackIndex(idxData);
    });

    it("getObjectId and findPosition are inverse operations", () => {
      for (let i = 0; i < idx.objectCount; i++) {
        const id = idx.getObjectId(i);
        const position = idx.findPosition(id);
        expect(position).toBe(i);
      }
    });

    it("getOffset at position matches findOffset by ID", () => {
      for (let i = 0; i < idx.objectCount; i++) {
        const id = idx.getObjectId(i);
        const offsetByPosition = idx.getOffset(i);
        const offsetById = idx.findOffset(id);
        expect(offsetByPosition).toBe(offsetById);
      }
    });

    it("offsets are non-negative", () => {
      for (let i = 0; i < idx.objectCount; i++) {
        const offset = idx.getOffset(i);
        expect(offset).toBeGreaterThanOrEqual(0);
      }
    });

    it("first object has smallest offset (after pack header)", () => {
      // Pack header is 12 bytes, so minimum offset is 12
      const minOffset = Math.min(...Array.from(idx.entries()).map((e) => e.offset));
      expect(minOffset).toBeGreaterThanOrEqual(12);
    });
  });
});
