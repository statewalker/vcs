/**
 * Tests for pack index writing
 *
 * Based on jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/internal/storage/file/PackIndexTestCase.java
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type PackIndex,
  type PackIndexWriterEntry,
  readPackIndex,
  writePackIndexV1,
  writePackIndexV2,
  writePackIndex,
  oldestPossibleFormat,
} from "../../src/pack/index.js";

const FIXTURES_DIR = path.join(import.meta.dirname, "fixtures");

/**
 * Test entries sorted by object ID
 */
const TEST_ENTRIES: PackIndexWriterEntry[] = [
  { id: "0000000000000000000000000000000000000001", offset: 12, crc32: 0x12345678 },
  { id: "1111111111111111111111111111111111111111", offset: 100, crc32: 0xabcdef01 },
  { id: "2222222222222222222222222222222222222222", offset: 200, crc32: 0xfedcba98 },
  { id: "3333333333333333333333333333333333333333", offset: 350, crc32: 0x11223344 },
  { id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", offset: 500, crc32: 0x55667788 },
  { id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", offset: 600, crc32: 0x99aabbcc },
  { id: "cccccccccccccccccccccccccccccccccccccccc", offset: 700, crc32: 0xddeeff00 },
  { id: "ffffffffffffffffffffffffffffffffffffffff", offset: 800, crc32: 0x12121212 },
];

const TEST_PACK_CHECKSUM = new Uint8Array(20).fill(0x42);

describe("pack-index-writer", () => {
  describe("oldestPossibleFormat", () => {
    it("returns 1 for small offsets", () => {
      const entries: PackIndexWriterEntry[] = [
        { id: "0000000000000000000000000000000000000001", offset: 12, crc32: 0 },
        { id: "1111111111111111111111111111111111111111", offset: 0xffffffff, crc32: 0 },
      ];
      expect(oldestPossibleFormat(entries)).toBe(1);
    });

    it("returns 2 for large offsets", () => {
      const entries: PackIndexWriterEntry[] = [
        { id: "0000000000000000000000000000000000000001", offset: 12, crc32: 0 },
        { id: "1111111111111111111111111111111111111111", offset: 0x100000000, crc32: 0 },
      ];
      expect(oldestPossibleFormat(entries)).toBe(2);
    });

    it("returns 1 for empty entries", () => {
      expect(oldestPossibleFormat([])).toBe(1);
    });
  });

  describe("writePackIndexV1", () => {
    it("writes valid V1 index", async () => {
      const indexData = await writePackIndexV1(TEST_ENTRIES, TEST_PACK_CHECKSUM);

      // Read it back
      const index = readPackIndex(indexData);

      expect(index.version).toBe(1);
      expect(index.objectCount).toBe(TEST_ENTRIES.length);
      expect(index.hasCRC32Support()).toBe(false);
    });

    it("preserves object IDs", async () => {
      const indexData = await writePackIndexV1(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      const entries = Array.from(index.entries());
      expect(entries.map((e) => e.id)).toEqual(TEST_ENTRIES.map((e) => e.id));
    });

    it("preserves offsets", async () => {
      const indexData = await writePackIndexV1(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      for (const entry of TEST_ENTRIES) {
        expect(index.findOffset(entry.id)).toBe(entry.offset);
      }
    });

    it("preserves pack checksum", async () => {
      const indexData = await writePackIndexV1(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      expect(Array.from(index.packChecksum)).toEqual(Array.from(TEST_PACK_CHECKSUM));
    });

    it("throws for offsets exceeding 4GB", async () => {
      const largeOffsetEntries: PackIndexWriterEntry[] = [
        { id: "0000000000000000000000000000000000000001", offset: 0x100000000, crc32: 0 },
      ];

      await expect(writePackIndexV1(largeOffsetEntries, TEST_PACK_CHECKSUM)).rejects.toThrow(
        "Pack too large for index version 1",
      );
    });

    it("handles empty entries", async () => {
      const indexData = await writePackIndexV1([], TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      expect(index.objectCount).toBe(0);
      expect(Array.from(index.entries())).toEqual([]);
    });
  });

  describe("writePackIndexV2", () => {
    it("writes valid V2 index", async () => {
      const indexData = await writePackIndexV2(TEST_ENTRIES, TEST_PACK_CHECKSUM);

      // Read it back
      const index = readPackIndex(indexData);

      expect(index.version).toBe(2);
      expect(index.objectCount).toBe(TEST_ENTRIES.length);
      expect(index.hasCRC32Support()).toBe(true);
    });

    it("preserves object IDs", async () => {
      const indexData = await writePackIndexV2(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      const entries = Array.from(index.entries());
      expect(entries.map((e) => e.id)).toEqual(TEST_ENTRIES.map((e) => e.id));
    });

    it("preserves offsets", async () => {
      const indexData = await writePackIndexV2(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      for (const entry of TEST_ENTRIES) {
        expect(index.findOffset(entry.id)).toBe(entry.offset);
      }
    });

    it("preserves CRC32 checksums", async () => {
      const indexData = await writePackIndexV2(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      for (const entry of TEST_ENTRIES) {
        expect(index.findCRC32(entry.id)).toBe(entry.crc32 >>> 0);
      }
    });

    it("preserves pack checksum", async () => {
      const indexData = await writePackIndexV2(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      expect(Array.from(index.packChecksum)).toEqual(Array.from(TEST_PACK_CHECKSUM));
    });

    it("handles 64-bit offsets", async () => {
      const largeOffsetEntries: PackIndexWriterEntry[] = [
        { id: "0000000000000000000000000000000000000001", offset: 12, crc32: 0x11111111 },
        { id: "1111111111111111111111111111111111111111", offset: 0x80000000, crc32: 0x22222222 },
        { id: "2222222222222222222222222222222222222222", offset: 0x100000000, crc32: 0x33333333 },
      ];

      const indexData = await writePackIndexV2(largeOffsetEntries, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      expect(index.version).toBe(2);
      expect(index.offset64Count).toBe(2); // Two offsets > 0x7FFFFFFF

      for (const entry of largeOffsetEntries) {
        expect(index.findOffset(entry.id)).toBe(entry.offset);
      }
    });

    it("handles empty entries", async () => {
      const indexData = await writePackIndexV2([], TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      expect(index.objectCount).toBe(0);
      expect(Array.from(index.entries())).toEqual([]);
    });
  });

  describe("writePackIndex", () => {
    it("auto-selects V1 for small offsets", async () => {
      const indexData = await writePackIndex(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      expect(index.version).toBe(1);
    });

    it("auto-selects V2 for large offsets", async () => {
      const largeOffsetEntries: PackIndexWriterEntry[] = [
        { id: "0000000000000000000000000000000000000001", offset: 0x100000000, crc32: 0 },
      ];

      const indexData = await writePackIndex(largeOffsetEntries, TEST_PACK_CHECKSUM);
      const index = readPackIndex(indexData);

      expect(index.version).toBe(2);
    });
  });

  describe("V1 vs V2 roundtrip compatibility", () => {
    it("both formats produce same logical content", async () => {
      const v1Data = await writePackIndexV1(TEST_ENTRIES, TEST_PACK_CHECKSUM);
      const v2Data = await writePackIndexV2(TEST_ENTRIES, TEST_PACK_CHECKSUM);

      const v1Index = readPackIndex(v1Data);
      const v2Index = readPackIndex(v2Data);

      expect(v1Index.objectCount).toBe(v2Index.objectCount);

      const v1Entries = Array.from(v1Index.entries());
      const v2Entries = Array.from(v2Index.entries());

      expect(v1Entries.map((e) => e.id)).toEqual(v2Entries.map((e) => e.id));
      expect(v1Entries.map((e) => e.offset)).toEqual(v2Entries.map((e) => e.offset));
    });
  });

  describe("roundtrip with existing fixtures", () => {
    let originalV1: PackIndex;
    let originalV2: PackIndex;

    beforeAll(async () => {
      const v1Data = await fs.readFile(
        path.join(FIXTURES_DIR, "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idx"),
      );
      const v2Data = await fs.readFile(
        path.join(FIXTURES_DIR, "pack-34be9032ac282b11fa9babdc2b2a93ca996c9c2f.idxV2"),
      );
      originalV1 = readPackIndex(new Uint8Array(v1Data));
      originalV2 = readPackIndex(new Uint8Array(v2Data));
    });

    it("can recreate V1 index from V2 entries", async () => {
      // Extract entries from V2 (which has CRC32)
      const entries: PackIndexWriterEntry[] = Array.from(originalV2.entries()).map((e) => ({
        id: e.id,
        offset: e.offset,
        crc32: e.crc32 ?? 0,
      }));

      // Write as V1
      const newV1Data = await writePackIndexV1(entries, originalV1.packChecksum);
      const newV1 = readPackIndex(newV1Data);

      // Compare
      expect(newV1.objectCount).toBe(originalV1.objectCount);
      expect(Array.from(newV1.entries()).map((e) => e.id)).toEqual(
        Array.from(originalV1.entries()).map((e) => e.id),
      );
      expect(Array.from(newV1.entries()).map((e) => e.offset)).toEqual(
        Array.from(originalV1.entries()).map((e) => e.offset),
      );
    });

    it("can recreate V2 index from existing entries", async () => {
      // Extract entries from original V2
      const entries: PackIndexWriterEntry[] = Array.from(originalV2.entries()).map((e) => ({
        id: e.id,
        offset: e.offset,
        crc32: e.crc32 ?? 0,
      }));

      // Write as V2
      const newV2Data = await writePackIndexV2(entries, originalV2.packChecksum);
      const newV2 = readPackIndex(newV2Data);

      // Compare
      expect(newV2.objectCount).toBe(originalV2.objectCount);
      expect(Array.from(newV2.entries()).map((e) => e.id)).toEqual(
        Array.from(originalV2.entries()).map((e) => e.id),
      );
      expect(Array.from(newV2.entries()).map((e) => e.offset)).toEqual(
        Array.from(originalV2.entries()).map((e) => e.offset),
      );
      expect(Array.from(newV2.entries()).map((e) => e.crc32)).toEqual(
        Array.from(originalV2.entries()).map((e) => e.crc32),
      );
    });
  });
});
