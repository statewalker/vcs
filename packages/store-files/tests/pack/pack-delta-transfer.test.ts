/**
 * Tests for pack delta transfer utilities
 *
 * Tests parsePackEntries, importPackAsDeltas, and exportForPack functions.
 */

import { type Delta, setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { sha1 } from "@webrun-vcs/utils/hash/sha1";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PackObjectType,
  type PackWriterObject,
  PackWriterStream,
  parsePackEntries,
  writePack,
} from "../../src/pack/index.js";

// Set up Node.js compression before tests
beforeAll(() => {
  setCompression(createNodeCompression());
});

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

/**
 * Create a simple delta that transforms base into target.
 */
function createSimpleDelta(base: Uint8Array, target: Uint8Array): Uint8Array {
  const chunks: number[] = [];

  // Encode base size
  let size = base.length;
  while (size >= 0x80) {
    chunks.push((size & 0x7f) | 0x80);
    size >>>= 7;
  }
  chunks.push(size);

  // Encode target size
  size = target.length;
  while (size >= 0x80) {
    chunks.push((size & 0x7f) | 0x80);
    size >>>= 7;
  }
  chunks.push(size);

  // Find common prefix
  let commonLen = 0;
  while (
    commonLen < base.length &&
    commonLen < target.length &&
    base[commonLen] === target[commonLen]
  ) {
    commonLen++;
  }

  if (commonLen > 0) {
    let cmd = 0x80;
    const copySize = commonLen;
    if (copySize & 0xff) cmd |= 0x10;
    if (copySize & 0xff00) cmd |= 0x20;
    if (copySize & 0xff0000) cmd |= 0x40;
    chunks.push(cmd);
    if (copySize & 0xff) chunks.push(copySize & 0xff);
    if (copySize & 0xff00) chunks.push((copySize >>> 8) & 0xff);
    if (copySize & 0xff0000) chunks.push((copySize >>> 16) & 0xff);
  }

  // INSERT remainder
  const remainder = target.subarray(commonLen);
  if (remainder.length > 0) {
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

describe("pack-entries-parser", () => {
  describe("parsePackEntries", () => {
    it("parses pack with single base object", async () => {
      const content = new TextEncoder().encode("hello world");
      const id = await computeObjectId("blob", content);

      const objects: PackWriterObject[] = [{ id, type: PackObjectType.BLOB, content }];

      const writeResult = await writePack(objects);
      const result = await parsePackEntries(writeResult.packData);

      expect(result.objectCount).toBe(1);
      expect(result.entries.length).toBe(1);
      expect(result.entries[0].type).toBe("base");
      expect(result.entries[0].id).toBe(id);
      expect(result.entries[0].objectType).toBe("blob");

      if (result.entries[0].type === "base") {
        expect(result.entries[0].content).toEqual(content);
      }
    });

    it("parses pack with multiple base objects", async () => {
      const content1 = new TextEncoder().encode("first content");
      const content2 = new TextEncoder().encode("second content");
      const content3 = new TextEncoder().encode("third content");

      const id1 = await computeObjectId("blob", content1);
      const id2 = await computeObjectId("blob", content2);
      const id3 = await computeObjectId("blob", content3);

      const objects: PackWriterObject[] = [
        { id: id1, type: PackObjectType.BLOB, content: content1 },
        { id: id2, type: PackObjectType.BLOB, content: content2 },
        { id: id3, type: PackObjectType.BLOB, content: content3 },
      ];

      const writeResult = await writePack(objects);
      const result = await parsePackEntries(writeResult.packData);

      expect(result.objectCount).toBe(3);
      expect(result.entries.length).toBe(3);

      // All should be base objects
      for (const entry of result.entries) {
        expect(entry.type).toBe("base");
      }

      const ids = result.entries.map((e) => e.id);
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
      expect(ids).toContain(id3);
    });

    it("parses pack with OFS_DELTA and preserves delta info", async () => {
      const baseContent = new TextEncoder().encode("this is the base content for delta testing");
      const baseId = await computeObjectId("blob", baseContent);

      const targetContent = new TextEncoder().encode(
        "this is the base content for delta testing - modified",
      );
      const targetId = await computeObjectId("blob", targetContent);

      // Create pack with OFS_DELTA
      const writer = new PackWriterStream();
      await writer.addObject(baseId, PackObjectType.BLOB, baseContent);

      const delta = createSimpleDelta(baseContent, targetContent);
      await writer.addOfsDelta(targetId, baseId, delta);

      const writeResult = await writer.finalize();
      const result = await parsePackEntries(writeResult.packData);

      expect(result.entries.length).toBe(2);

      // First entry should be base
      expect(result.entries[0].type).toBe("base");
      expect(result.entries[0].id).toBe(baseId);

      // Second entry should be delta with preserved delta info
      expect(result.entries[1].type).toBe("delta");
      expect(result.entries[1].id).toBe(targetId);

      if (result.entries[1].type === "delta") {
        expect(result.entries[1].baseId).toBe(baseId);
        expect(result.entries[1].delta).toBeDefined();
        expect(Array.isArray(result.entries[1].delta)).toBe(true);
        expect(result.entries[1].delta.length).toBeGreaterThan(0);

        // Delta should have start, copy/insert, and finish instructions
        const deltaTypes = result.entries[1].delta.map((d: Delta) => d.type);
        expect(deltaTypes).toContain("start");

        // Content should match target
        expect(result.entries[1].content).toEqual(targetContent);
      }
    });

    it("parses pack with REF_DELTA and preserves delta info", async () => {
      const baseContent = new TextEncoder().encode("base for ref delta test");
      const baseId = await computeObjectId("blob", baseContent);

      const targetContent = new TextEncoder().encode("base for ref delta test - extended version");
      const targetId = await computeObjectId("blob", targetContent);

      // Create pack with REF_DELTA
      const writer = new PackWriterStream();
      await writer.addObject(baseId, PackObjectType.BLOB, baseContent);

      const delta = createSimpleDelta(baseContent, targetContent);
      await writer.addRefDelta(targetId, baseId, delta);

      const writeResult = await writer.finalize();
      const result = await parsePackEntries(writeResult.packData);

      expect(result.entries.length).toBe(2);

      // Second entry should be delta
      const deltaEntry = result.entries.find((e) => e.type === "delta");
      expect(deltaEntry).toBeDefined();

      if (deltaEntry?.type === "delta") {
        expect(deltaEntry.id).toBe(targetId);
        expect(deltaEntry.baseId).toBe(baseId);
        expect(deltaEntry.delta.length).toBeGreaterThan(0);
      }
    });

    it("includes correct pack metadata", async () => {
      const content = new TextEncoder().encode("metadata test");
      const id = await computeObjectId("blob", content);

      const writeResult = await writePack([{ id, type: PackObjectType.BLOB, content }]);
      const result = await parsePackEntries(writeResult.packData);

      expect(result.version).toBe(2);
      expect(result.objectCount).toBe(1);
      expect(result.packChecksum).toBeDefined();
      expect(result.packChecksum.length).toBe(20);
    });

    it("handles different object types", async () => {
      const blobContent = new TextEncoder().encode("blob data");
      const commitContent = new TextEncoder().encode(
        "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
          "author Test <test@test.com> 1234567890 +0000\n" +
          "committer Test <test@test.com> 1234567890 +0000\n\n" +
          "Test commit\n",
      );

      const blobId = await computeObjectId("blob", blobContent);
      const commitId = await computeObjectId("commit", commitContent);

      const objects: PackWriterObject[] = [
        { id: blobId, type: PackObjectType.BLOB, content: blobContent },
        { id: commitId, type: PackObjectType.COMMIT, content: commitContent },
      ];

      const writeResult = await writePack(objects);
      const result = await parsePackEntries(writeResult.packData);

      expect(result.entries.length).toBe(2);

      const blob = result.entries.find((e) => e.id === blobId);
      const commit = result.entries.find((e) => e.id === commitId);

      expect(blob?.objectType).toBe("blob");
      expect(commit?.objectType).toBe("commit");
    });

    it("entries are in dependency order (base before delta)", async () => {
      const baseContent = new TextEncoder().encode("dependency order base");
      const baseId = await computeObjectId("blob", baseContent);

      const targetContent = new TextEncoder().encode("dependency order base - target");
      const targetId = await computeObjectId("blob", targetContent);

      const writer = new PackWriterStream();
      await writer.addObject(baseId, PackObjectType.BLOB, baseContent);
      await writer.addOfsDelta(targetId, baseId, createSimpleDelta(baseContent, targetContent));

      const writeResult = await writer.finalize();
      const result = await parsePackEntries(writeResult.packData);

      // Base should come before delta
      const baseIndex = result.entries.findIndex((e) => e.id === baseId);
      const deltaIndex = result.entries.findIndex((e) => e.id === targetId);

      expect(baseIndex).toBeLessThan(deltaIndex);
    });
  });
});
