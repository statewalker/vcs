/**
 * Tests for pack index reading
 *
 * Based on jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/internal/storage/file/PackIndexTestCase.java
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { readPackIndex, type PackIndex } from "../../src/pack/index.js";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

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
  describe("PackIndexV1", () => {
    let smallIdx: PackIndex;
    let denseIdx: PackIndex;

    beforeAll(async () => {
      const smallIdxData = await fs.readFile(
        path.join(
          FIXTURES_DIR,
          "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idx",
        ),
      );
      const denseIdxData = await fs.readFile(
        path.join(
          FIXTURES_DIR,
          "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idx",
        ),
      );
      smallIdx = readPackIndex(new Uint8Array(smallIdxData));
      denseIdx = readPackIndex(new Uint8Array(denseIdxData));
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
      expect(
        smallIdx.findPosition("82c6b885ff600be425b4ea96dee75dca255b69e7"),
      ).toBe(4);
      expect(
        smallIdx.findPosition("c59759f143fb1fe21c197981df75a7ee00290799"),
      ).toBe(7);
      expect(
        smallIdx.findPosition("4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
      ).toBe(0);
    });

    it("returns -1 for objects not in pack", () => {
      expect(
        smallIdx.findPosition("0000000000000000000000000000000000000000"),
      ).toBe(-1);
      expect(
        smallIdx.findPosition("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ).toBe(-1);
    });

    it("finds object offsets", () => {
      for (const entry of smallIdx.entries()) {
        expect(smallIdx.findOffset(entry.id)).toBe(entry.offset);
      }
    });

    it("returns -1 for offsets of objects not in pack", () => {
      expect(
        smallIdx.findOffset("0000000000000000000000000000000000000000"),
      ).toBe(-1);
      expect(
        smallIdx.findOffset("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ).toBe(-1);
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
      expect(smallIdx.has("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBe(
        true,
      );
      expect(smallIdx.has("0000000000000000000000000000000000000000")).toBe(
        false,
      );
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
      expect(matches).toContain(
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      );
    });
  });

  describe("PackIndexV2", () => {
    let smallIdx: PackIndex;
    let denseIdx: PackIndex;

    beforeAll(async () => {
      const smallIdxData = await fs.readFile(
        path.join(
          FIXTURES_DIR,
          "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
        ),
      );
      const denseIdxData = await fs.readFile(
        path.join(
          FIXTURES_DIR,
          "pack-df2982f284bbabb6bdb59ee3fcc6eb0983e20371.idxV2",
        ),
      );
      smallIdx = readPackIndex(new Uint8Array(smallIdxData));
      denseIdx = readPackIndex(new Uint8Array(denseIdxData));
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
      expect(
        smallIdx.findCRC32("0000000000000000000000000000000000000000"),
      ).toBeUndefined();
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
      expect(
        smallIdx.findPosition("82c6b885ff600be425b4ea96dee75dca255b69e7"),
      ).toBe(4);
      expect(
        smallIdx.findPosition("c59759f143fb1fe21c197981df75a7ee00290799"),
      ).toBe(7);
      expect(
        smallIdx.findPosition("4b825dc642cb6eb9a060e54bf8d69288fbee4904"),
      ).toBe(0);
    });

    it("returns -1 for objects not in pack", () => {
      expect(
        smallIdx.findPosition("0000000000000000000000000000000000000000"),
      ).toBe(-1);
      expect(
        smallIdx.findPosition("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ).toBe(-1);
    });

    it("finds object offsets", () => {
      for (const entry of smallIdx.entries()) {
        expect(smallIdx.findOffset(entry.id)).toBe(entry.offset);
      }
    });

    it("returns -1 for offsets of objects not in pack", () => {
      expect(
        smallIdx.findOffset("0000000000000000000000000000000000000000"),
      ).toBe(-1);
      expect(
        smallIdx.findOffset("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
      ).toBe(-1);
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
      expect(smallIdx.has("4b825dc642cb6eb9a060e54bf8d69288fbee4904")).toBe(
        true,
      );
      expect(smallIdx.has("0000000000000000000000000000000000000000")).toBe(
        false,
      );
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
      expect(matches).toContain(
        "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      );
    });
  });

  describe("V1 vs V2 compatibility", () => {
    let v1Idx: PackIndex;
    let v2Idx: PackIndex;

    beforeAll(async () => {
      const v1Data = await fs.readFile(
        path.join(
          FIXTURES_DIR,
          "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idx",
        ),
      );
      const v2Data = await fs.readFile(
        path.join(
          FIXTURES_DIR,
          "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2",
        ),
      );
      v1Idx = readPackIndex(new Uint8Array(v1Data));
      v2Idx = readPackIndex(new Uint8Array(v2Data));
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

      expect(v1Entries.map((e) => e.offset)).toEqual(
        v2Entries.map((e) => e.offset),
      );
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
      expect(() => readPackIndex(new Uint8Array(4))).toThrow(
        "Pack index file too small",
      );
    });

    it("throws for unsupported version", () => {
      // Create a V3 header (which doesn't exist)
      const data = new Uint8Array(1024);
      data[0] = 0xff;
      data[1] = 0x74; // 't'
      data[2] = 0x4f; // 'O'
      data[3] = 0x63; // 'c'
      data[7] = 3; // version 3

      expect(() => readPackIndex(data)).toThrow(
        "Unsupported pack index version: 3",
      );
    });
  });
});
