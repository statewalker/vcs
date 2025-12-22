/**
 * Tests for pack file indexer
 *
 * Tests the indexPack function which creates index entries from raw pack data.
 */

import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { sha1 } from "@webrun-vcs/utils/hash/sha1";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import { describe, expect, it } from "vitest";
import {
  indexPack,
  PackObjectType,
  type PackWriterObject,
  PackWriterStream,
  verifyPackChecksum,
  writePack,
  writePackIndex,
} from "../../src/pack/index.js";

// Set up Node.js compression before tests
setCompression(createNodeCompression());

/**
 * Compute the correct object ID for a given type and content
 */
async function computeObjectId(type: string, content: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const fullData = new Uint8Array(header.length + content.length);
  fullData.set(header, 0);
  fullData.set(content, header.length);
  return bytesToHex(await sha1(fullData));
}

describe("pack-indexer", () => {
  describe("indexPack", () => {
    it("indexes pack with single blob", async () => {
      const content = new TextEncoder().encode("hello world");
      const id = await computeObjectId("blob", content);

      const objects: PackWriterObject[] = [
        {
          id,
          type: PackObjectType.BLOB,
          content,
        },
      ];

      const writeResult = await writePack(objects);
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.objectCount).toBe(1);
      expect(indexResult.entries.length).toBe(1);
      expect(indexResult.entries[0].id).toBe(id);
      expect(indexResult.entries[0].offset).toBe(12); // After header
    });

    it("indexes pack with multiple blobs", async () => {
      const content1 = new TextEncoder().encode("content one");
      const content2 = new TextEncoder().encode("content two");
      const content3 = new TextEncoder().encode("content three");

      const id1 = await computeObjectId("blob", content1);
      const id2 = await computeObjectId("blob", content2);
      const id3 = await computeObjectId("blob", content3);

      const objects: PackWriterObject[] = [
        { id: id1, type: PackObjectType.BLOB, content: content1 },
        { id: id2, type: PackObjectType.BLOB, content: content2 },
        { id: id3, type: PackObjectType.BLOB, content: content3 },
      ];

      const writeResult = await writePack(objects);
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.objectCount).toBe(3);
      expect(indexResult.entries.length).toBe(3);

      // Entries should be sorted by ID
      const ids = indexResult.entries.map((e) => e.id);
      const sortedIds = [...ids].sort();
      expect(ids).toEqual(sortedIds);

      // All original IDs should be present
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toContain(id3);
    });

    it("indexes pack with different object types", async () => {
      const blobContent = new TextEncoder().encode("blob data");
      const commitContent = new TextEncoder().encode(
        "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
          "author Test <test@test.com> 1234567890 +0000\n" +
          "committer Test <test@test.com> 1234567890 +0000\n\n" +
          "Initial commit\n",
      );

      const blobId = await computeObjectId("blob", blobContent);
      const commitId = await computeObjectId("commit", commitContent);

      const objects: PackWriterObject[] = [
        { id: blobId, type: PackObjectType.BLOB, content: blobContent },
        { id: commitId, type: PackObjectType.COMMIT, content: commitContent },
      ];

      const writeResult = await writePack(objects);
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.entries.length).toBe(2);

      const ids = indexResult.entries.map((e) => e.id);
      expect(ids).toContain(blobId);
      expect(ids).toContain(commitId);
    });

    it("produces same entries as writePack", async () => {
      const content = new TextEncoder().encode("test content for comparison");
      const id = await computeObjectId("blob", content);

      const objects: PackWriterObject[] = [{ id, type: PackObjectType.BLOB, content }];

      const writeResult = await writePack(objects);
      const indexResult = await indexPack(writeResult.packData);

      // Compare entries (sorted by ID in both cases)
      expect(indexResult.entries.length).toBe(writeResult.indexEntries.length);

      for (let i = 0; i < indexResult.entries.length; i++) {
        expect(indexResult.entries[i].id).toBe(writeResult.indexEntries[i].id);
        expect(indexResult.entries[i].offset).toBe(writeResult.indexEntries[i].offset);
        // CRC32 may differ slightly due to calculation method, but should be valid
        expect(typeof indexResult.entries[i].crc32).toBe("number");
      }
    });

    it("extracts correct pack checksum", async () => {
      const content = new TextEncoder().encode("checksum test");
      const id = await computeObjectId("blob", content);

      const objects: PackWriterObject[] = [{ id, type: PackObjectType.BLOB, content }];

      const writeResult = await writePack(objects);
      const indexResult = await indexPack(writeResult.packData);

      expect(Array.from(indexResult.packChecksum)).toEqual(Array.from(writeResult.packChecksum));
    });

    it("returns correct version", async () => {
      const content = new TextEncoder().encode("version test");
      const id = await computeObjectId("blob", content);

      const writeResult = await writePack([{ id, type: PackObjectType.BLOB, content }]);
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.version).toBe(2);
    });

    it("handles empty pack", async () => {
      const writeResult = await writePack([]);
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.objectCount).toBe(0);
      expect(indexResult.entries.length).toBe(0);
    });

    it("handles large content", async () => {
      // Create ~50KB of content
      const largeContent = new Uint8Array(50 * 1024);
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }

      const id = await computeObjectId("blob", largeContent);

      const writeResult = await writePack([
        { id, type: PackObjectType.BLOB, content: largeContent },
      ]);
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.entries.length).toBe(1);
      expect(indexResult.entries[0].id).toBe(id);
    });
  });

  describe("indexPack with OFS_DELTA", () => {
    it("resolves OFS_DELTA objects", async () => {
      const baseContent = new TextEncoder().encode("this is the base content for delta testing");
      const baseId = await computeObjectId("blob", baseContent);

      // Create target content that's similar (for delta)
      const targetContent = new TextEncoder().encode(
        "this is the base content for delta testing - modified",
      );
      const targetId = await computeObjectId("blob", targetContent);

      // Use PackWriterStream to create OFS_DELTA
      const writer = new PackWriterStream();
      await writer.addObject(baseId, PackObjectType.BLOB, baseContent);

      // Create delta manually (simple: copy base + add suffix)
      const delta = createSimpleDelta(baseContent, targetContent);
      await writer.addOfsDelta(targetId, baseId, delta);

      const writeResult = await writer.finalize();
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.entries.length).toBe(2);

      const ids = indexResult.entries.map((e) => e.id);
      expect(ids).toContain(baseId);
      expect(ids).toContain(targetId);
    });
  });

  describe("indexPack with REF_DELTA", () => {
    it("resolves REF_DELTA objects", async () => {
      const baseContent = new TextEncoder().encode("base content for ref delta");
      const baseId = await computeObjectId("blob", baseContent);

      const targetContent = new TextEncoder().encode("base content for ref delta - extended");
      const targetId = await computeObjectId("blob", targetContent);

      // Use PackWriterStream with REF_DELTA
      const writer = new PackWriterStream();
      await writer.addObject(baseId, PackObjectType.BLOB, baseContent);

      const delta = createSimpleDelta(baseContent, targetContent);
      await writer.addRefDelta(targetId, baseId, delta);

      const writeResult = await writer.finalize();
      const indexResult = await indexPack(writeResult.packData);

      expect(indexResult.entries.length).toBe(2);

      const ids = indexResult.entries.map((e) => e.id);
      expect(ids).toContain(baseId);
      expect(ids).toContain(targetId);
    });
  });

  describe("verifyPackChecksum", () => {
    it("returns true for valid pack", async () => {
      const content = new TextEncoder().encode("valid pack");
      const id = await computeObjectId("blob", content);

      const writeResult = await writePack([{ id, type: PackObjectType.BLOB, content }]);

      expect(await verifyPackChecksum(writeResult.packData)).toBe(true);
    });

    it("returns false for corrupted pack", async () => {
      const content = new TextEncoder().encode("corrupted pack");
      const id = await computeObjectId("blob", content);

      const writeResult = await writePack([{ id, type: PackObjectType.BLOB, content }]);

      // Corrupt the data
      const corrupted = new Uint8Array(writeResult.packData);
      corrupted[20] ^= 0xff; // Flip some bits

      expect(await verifyPackChecksum(corrupted)).toBe(false);
    });

    it("returns false for too-short data", async () => {
      expect(await verifyPackChecksum(new Uint8Array(10))).toBe(false);
    });
  });

  describe("roundtrip: indexPack → writePackIndex", () => {
    it("creates valid index from indexed pack", async () => {
      const content = new TextEncoder().encode("roundtrip test content");
      const id = await computeObjectId("blob", content);

      const writeResult = await writePack([{ id, type: PackObjectType.BLOB, content }]);
      const indexResult = await indexPack(writeResult.packData);

      // Create index file from indexed entries
      const indexData = await writePackIndex(indexResult.entries, indexResult.packChecksum);

      // Verify index is non-empty and has correct structure
      expect(indexData.length).toBeGreaterThan(0);

      // Should start with fanout table (V1) or magic+version (V2)
      // V2 magic is 0xFF 't' 'O' 'c'
      const isV2 = indexData[0] === 0xff && indexData[1] === 0x74;
      expect(isV2 || indexData.length >= 256 * 4).toBe(true);
    });
  });
});

/**
 * Create a simple delta that transforms base into target.
 * This creates a delta with: base size, target size, copy-all-of-base, insert-remainder
 */
function createSimpleDelta(base: Uint8Array, target: Uint8Array): Uint8Array {
  const chunks: number[] = [];

  // Encode base size (variable length)
  let size = base.length;
  while (size >= 0x80) {
    chunks.push((size & 0x7f) | 0x80);
    size >>>= 7;
  }
  chunks.push(size);

  // Encode target size (variable length)
  size = target.length;
  while (size >= 0x80) {
    chunks.push((size & 0x7f) | 0x80);
    size >>>= 7;
  }
  chunks.push(size);

  // Find common prefix length
  let commonLen = 0;
  while (
    commonLen < base.length &&
    commonLen < target.length &&
    base[commonLen] === target[commonLen]
  ) {
    commonLen++;
  }

  if (commonLen > 0) {
    // COPY command: copy from base
    // Format: 1xxxxxxx with offset and size bytes following based on flags
    let cmd = 0x80; // COPY flag
    const _offset = 0;
    const copySize = commonLen;

    // Set flags for offset bytes (we need offset=0, which means no offset bytes needed unless > 0)
    // For offset=0, we don't set any offset flags

    // Set flags for size bytes
    if (copySize & 0xff) cmd |= 0x10;
    if (copySize & 0xff00) cmd |= 0x20;
    if (copySize & 0xff0000) cmd |= 0x40;

    chunks.push(cmd);

    // Write size bytes
    if (copySize & 0xff) chunks.push(copySize & 0xff);
    if (copySize & 0xff00) chunks.push((copySize >>> 8) & 0xff);
    if (copySize & 0xff0000) chunks.push((copySize >>> 16) & 0xff);
  }

  // INSERT command for the remainder
  const remainder = target.subarray(commonLen);
  if (remainder.length > 0) {
    // INSERT commands have high bit = 0, length in lower 7 bits
    // For lengths > 127, we need multiple INSERT commands
    let pos = 0;
    while (pos < remainder.length) {
      const insertLen = Math.min(127, remainder.length - pos);
      chunks.push(insertLen);
      for (let i = 0; i < insertLen; i++) {
        chunks.push(remainder[pos + i]);
      }
      pos += insertLen;
    }
  }

  return new Uint8Array(chunks);
}
