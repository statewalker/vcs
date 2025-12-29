/**
 * Tests for pack file writing
 *
 * Tests pack writer functionality and verifies packs can be read by the existing reader.
 */

import { type FilesApi, joinPath } from "@statewalker/webrun-files";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { crc32 } from "@webrun-vcs/utils/hash/crc32";
import { sha1 } from "@webrun-vcs/utils/hash/sha1";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import { beforeEach, describe, expect, it } from "vitest";
import {
  PackObjectType,
  PackReader,
  type PackWriterObject,
  PackWriterStream,
  readPackIndex,
  writePack,
  writePackIndexV2,
} from "../../src/pack/index.js";
import { createMemFilesApi } from "../test-utils.js";

// Set up Node.js compression before tests
setCompression(createNodeCompression());

/**
 * Compute SHA-1 hash of data (for pack name verification)
 */
async function sha1Hex(data: Uint8Array): Promise<string> {
  return bytesToHex(await sha1(data));
}

describe("pack-writer", () => {
  describe("crc32", () => {
    it("computes CRC32 of empty data", () => {
      expect(crc32(new Uint8Array([]))).toBe(0);
    });

    it("computes CRC32 of simple data", () => {
      const data = new TextEncoder().encode("hello");
      const result = crc32(data);
      // Known CRC32 of "hello"
      expect(result).toBe(0x3610a686);
    });

    it("computes CRC32 of binary data", () => {
      const data = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]);
      const result = crc32(data);
      expect(typeof result).toBe("number");
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("writePack", () => {
    it("writes pack with single blob", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0", // SHA-1 of "blob 6\0foobar"
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("foobar"),
        },
      ];

      const result = await writePack(objects);

      // Verify pack structure
      expect(result.packData.length).toBeGreaterThan(12 + 20); // header + checksum
      expect(result.packChecksum.length).toBe(20);
      expect(result.indexEntries.length).toBe(1);
      expect(result.indexEntries[0].id).toBe(objects[0].id);
    });

    it("writes pack with multiple objects", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "1111111111111111111111111111111111111111",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("content1"),
        },
        {
          id: "2222222222222222222222222222222222222222",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("content2"),
        },
        {
          id: "3333333333333333333333333333333333333333",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("content3"),
        },
      ];

      const result = await writePack(objects);

      expect(result.indexEntries.length).toBe(3);
      // Entries should be sorted by ID
      expect(result.indexEntries[0].id).toBe("1111111111111111111111111111111111111111");
      expect(result.indexEntries[1].id).toBe("2222222222222222222222222222222222222222");
      expect(result.indexEntries[2].id).toBe("3333333333333333333333333333333333333333");
    });

    it("produces valid pack header", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "0000000000000000000000000000000000000001",
          type: PackObjectType.BLOB,
          content: new Uint8Array([1, 2, 3]),
        },
      ];

      const result = await writePack(objects);

      // Check PACK signature
      expect(result.packData[0]).toBe(0x50); // P
      expect(result.packData[1]).toBe(0x41); // A
      expect(result.packData[2]).toBe(0x43); // C
      expect(result.packData[3]).toBe(0x4b); // K

      // Check version (2)
      expect(result.packData[4]).toBe(0);
      expect(result.packData[5]).toBe(0);
      expect(result.packData[6]).toBe(0);
      expect(result.packData[7]).toBe(2);

      // Check object count (1)
      expect(result.packData[8]).toBe(0);
      expect(result.packData[9]).toBe(0);
      expect(result.packData[10]).toBe(0);
      expect(result.packData[11]).toBe(1);
    });

    it("appends checksum at the end", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "0000000000000000000000000000000000000001",
          type: PackObjectType.BLOB,
          content: new Uint8Array([1, 2, 3]),
        },
      ];

      const result = await writePack(objects);

      // Last 20 bytes should be the checksum
      const checksumFromPack = result.packData.subarray(result.packData.length - 20);
      expect(Array.from(checksumFromPack)).toEqual(Array.from(result.packChecksum));
    });
  });

  describe("PackWriterStream", () => {
    it("builds pack incrementally", async () => {
      const writer = new PackWriterStream();

      await writer.addObject(
        "1111111111111111111111111111111111111111",
        PackObjectType.BLOB,
        new TextEncoder().encode("content1"),
      );
      await writer.addObject(
        "2222222222222222222222222222222222222222",
        PackObjectType.BLOB,
        new TextEncoder().encode("content2"),
      );

      const result = await writer.finalize();

      expect(result.indexEntries.length).toBe(2);
      expect(result.packChecksum.length).toBe(20);
    });

    it("tracks object offsets", async () => {
      const writer = new PackWriterStream();

      await writer.addObject(
        "1111111111111111111111111111111111111111",
        PackObjectType.BLOB,
        new TextEncoder().encode("content1"),
      );

      // After finalization, offsets are adjusted to include header
      const offset1Before = writer.getObjectOffset("1111111111111111111111111111111111111111");
      expect(offset1Before).toBeDefined();

      await writer.addObject(
        "2222222222222222222222222222222222222222",
        PackObjectType.BLOB,
        new TextEncoder().encode("content2"),
      );

      const offset2Before = writer.getObjectOffset("2222222222222222222222222222222222222222");
      expect(offset2Before).toBeDefined();
      expect(offset1Before).toBeDefined();
      expect(offset2Before).toBeGreaterThan(offset1Before ?? 0);
    });

    it("prevents adding after finalization", async () => {
      const writer = new PackWriterStream();

      await writer.addObject(
        "1111111111111111111111111111111111111111",
        PackObjectType.BLOB,
        new Uint8Array([1]),
      );
      await writer.finalize();

      await expect(
        writer.addObject(
          "2222222222222222222222222222222222222222",
          PackObjectType.BLOB,
          new Uint8Array([2]),
        ),
      ).rejects.toThrow("Pack has been finalized");
    });

    it("prevents double finalization", async () => {
      const writer = new PackWriterStream();

      await writer.addObject(
        "1111111111111111111111111111111111111111",
        PackObjectType.BLOB,
        new Uint8Array([1]),
      );
      await writer.finalize();

      await expect(writer.finalize()).rejects.toThrow("Pack has already been finalized");
    });
  });

  describe("roundtrip: write and read pack", () => {
    const tempDir = "/test-packs";
    let files: FilesApi;

    beforeEach(async () => {
      // Use in-memory filesystem for tests
      files = createMemFilesApi();
      await files.mkdir(tempDir);
    });

    it("can read pack written by writePack", async () => {
      const blobContent = new TextEncoder().encode("Hello, World!");
      const objects: PackWriterObject[] = [
        {
          id: "943a702d06f34599aee1f8da8ef9f7296031d699", // Known SHA-1
          type: PackObjectType.BLOB,
          content: blobContent,
        },
      ];

      // Write pack
      const result = await writePack(objects);

      // Write pack file
      const packPath = joinPath(tempDir, "test1.pack");
      await files.write(packPath, [result.packData]);

      // Write index
      const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
      const indexPath = joinPath(tempDir, "test1.idx");
      await files.write(indexPath, [indexData]);

      // Read pack
      const readIndex = readPackIndex(await files.readFile(indexPath));
      const reader = new PackReader(files, packPath, readIndex);
      await reader.open();

      try {
        // Verify we can read the object
        const obj = await reader.get(objects[0].id);
        expect(obj).toBeDefined();
        expect(obj?.type).toBe(PackObjectType.BLOB);
        expect(new TextDecoder().decode(obj?.content)).toBe("Hello, World!");
      } finally {
        await reader.close();
      }
    });

    it("can read pack with multiple objects", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "0000000000000000000000000000000000000001",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("blob content 1"),
        },
        {
          id: "1111111111111111111111111111111111111111",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("blob content 2"),
        },
        {
          id: "2222222222222222222222222222222222222222",
          type: PackObjectType.COMMIT,
          content: new TextEncoder().encode(
            "tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n" +
              "author Test <test@test.com> 1234567890 +0000\n" +
              "committer Test <test@test.com> 1234567890 +0000\n\n" +
              "Test commit\n",
          ),
        },
      ];

      // Write pack
      const result = await writePack(objects);

      // Write files
      const packPath = joinPath(tempDir, "test2.pack");
      await files.write(packPath, [result.packData]);

      const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
      const indexPath = joinPath(tempDir, "test2.idx");
      await files.write(indexPath, [indexData]);

      // Read and verify all objects
      const readIndex = readPackIndex(await files.readFile(indexPath));
      const reader = new PackReader(files, packPath, readIndex);
      await reader.open();

      try {
        for (const original of objects) {
          const obj = await reader.get(original.id);
          expect(obj).toBeDefined();
          expect(obj?.type).toBe(original.type);
          expect(Array.from(obj?.content)).toEqual(Array.from(original.content));
        }
      } finally {
        await reader.close();
      }
    });

    it("can read pack with different object types", async () => {
      const treeContent = new Uint8Array([
        // Tree entry: "100644 test.txt\0" + 20-byte SHA
        ...new TextEncoder().encode("100644 test.txt"),
        0,
        ...new Uint8Array(20).fill(0xab),
      ]);

      const objects: PackWriterObject[] = [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("blob"),
        },
        {
          id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          type: PackObjectType.TREE,
          content: treeContent,
        },
        {
          id: "cccccccccccccccccccccccccccccccccccccccc",
          type: PackObjectType.COMMIT,
          content: new TextEncoder().encode(
            "tree bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n\ncommit",
          ),
        },
      ];

      const result = await writePack(objects);

      const packPath = joinPath(tempDir, "test3.pack");
      await files.write(packPath, [result.packData]);

      const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
      const indexPath = joinPath(tempDir, "test3.idx");
      await files.write(indexPath, [indexData]);

      const readIndex = readPackIndex(await files.readFile(indexPath));
      const reader = new PackReader(files, packPath, readIndex);
      await reader.open();

      try {
        // Verify types
        const blob = await reader.get("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
        expect(blob?.type).toBe(PackObjectType.BLOB);

        const tree = await reader.get("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
        expect(tree?.type).toBe(PackObjectType.TREE);

        const commit = await reader.get("cccccccccccccccccccccccccccccccccccccccc");
        expect(commit?.type).toBe(PackObjectType.COMMIT);
      } finally {
        await reader.close();
      }
    });

    it("can read pack built with PackWriterStream", async () => {
      const writer = new PackWriterStream();

      await writer.addObject(
        "dddddddddddddddddddddddddddddddddddddddd",
        PackObjectType.BLOB,
        new TextEncoder().encode("stream content 1"),
      );
      await writer.addObject(
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        PackObjectType.BLOB,
        new TextEncoder().encode("stream content 2"),
      );

      const result = await writer.finalize();

      const packPath = joinPath(tempDir, "test4.pack");
      await files.write(packPath, [result.packData]);

      const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
      const indexPath = joinPath(tempDir, "test4.idx");
      await files.write(indexPath, [indexData]);

      const readIndex = readPackIndex(await files.readFile(indexPath));
      const reader = new PackReader(files, packPath, readIndex);
      await reader.open();

      try {
        const obj1 = await reader.get("dddddddddddddddddddddddddddddddddddddddd");
        expect(new TextDecoder().decode(obj1?.content)).toBe("stream content 1");

        const obj2 = await reader.get("eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
        expect(new TextDecoder().decode(obj2?.content)).toBe("stream content 2");
      } finally {
        await reader.close();
      }
    });

    it("produces valid CRC32 checksums", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "ffffffffffffffffffffffffffffffffffffffff",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("crc test content"),
        },
      ];

      const result = await writePack(objects);

      // CRC32 should be non-zero for non-empty content
      expect(result.indexEntries[0].crc32).not.toBe(0);

      // Verify CRC32 can be stored and retrieved via index
      const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
      const readIndex = readPackIndex(indexData);

      expect(readIndex.findCRC32("ffffffffffffffffffffffffffffffffffffffff")).toBe(
        result.indexEntries[0].crc32,
      );
    });

    it("handles large content", async () => {
      // Create ~100KB of content
      const largeContent = new Uint8Array(100 * 1024);
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }

      const objects: PackWriterObject[] = [
        {
          id: "1234567890abcdef1234567890abcdef12345678",
          type: PackObjectType.BLOB,
          content: largeContent,
        },
      ];

      const result = await writePack(objects);

      const packPath = joinPath(tempDir, "test-large.pack");
      await files.write(packPath, [result.packData]);

      const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
      const indexPath = joinPath(tempDir, "test-large.idx");
      await files.write(indexPath, [indexData]);

      const readIndex = readPackIndex(await files.readFile(indexPath));
      const reader = new PackReader(files, packPath, readIndex);
      await reader.open();

      try {
        const obj = await reader.get("1234567890abcdef1234567890abcdef12345678");
        expect(obj).toBeDefined();
        expect(obj?.content.length).toBe(largeContent.length);
        expect(Array.from(obj?.content)).toEqual(Array.from(largeContent));
      } finally {
        await reader.close();
      }
    });
  });

  /**
   * Empty pack tests
   * Based on jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/internal/storage/pack/BasePackWriterTest.java#testWriteEmptyPack1/2
   */
  describe("empty pack", () => {
    it("writes empty pack with writePack", async () => {
      const result = await writePack([]);

      // Pack should have header (12 bytes) + checksum (20 bytes)
      expect(result.packData.length).toBe(12 + 20);

      // Verify header
      expect(result.packData[0]).toBe(0x50); // P
      expect(result.packData[1]).toBe(0x41); // A
      expect(result.packData[2]).toBe(0x43); // C
      expect(result.packData[3]).toBe(0x4b); // K

      // Version 2
      expect(result.packData[7]).toBe(2);

      // Object count 0
      expect(result.packData[11]).toBe(0);

      // No index entries
      expect(result.indexEntries.length).toBe(0);
    });

    it("writes empty pack with PackWriterStream", async () => {
      const writer = new PackWriterStream();
      const result = await writer.finalize();

      // Pack should have header (12 bytes) + checksum (20 bytes)
      expect(result.packData.length).toBe(12 + 20);

      // Verify header
      expect(result.packData[0]).toBe(0x50); // P
      expect(result.packData[1]).toBe(0x41); // A
      expect(result.packData[2]).toBe(0x43); // C
      expect(result.packData[3]).toBe(0x4b); // K

      // No index entries
      expect(result.indexEntries.length).toBe(0);
    });

    it("empty pack has valid checksum", async () => {
      const result = await writePack([]);

      // Checksum is SHA-1 of pack data (excluding the checksum itself)
      const dataWithoutChecksum = result.packData.subarray(0, result.packData.length - 20);
      const expectedChecksum = await sha1Hex(dataWithoutChecksum);

      // Verify checksum matches
      const actualChecksum = Array.from(result.packChecksum)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      expect(actualChecksum).toBe(expectedChecksum);
    });
  });

  /**
   * Pack name computation tests
   * Based on jgit/org.eclipse.jgit.test/tst/org/eclipse/jgit/internal/storage/pack/BasePackWriterTest.java
   *
   * Pack files are named based on the SHA-1 checksum of the pack contents.
   */
  describe("pack name computation", () => {
    it("pack checksum can be used as pack name", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("test content"),
        },
      ];

      const result = await writePack(objects);

      // Pack name is derived from checksum
      const packName = Array.from(result.packChecksum)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      expect(packName.length).toBe(40); // SHA-1 is 40 hex chars
      expect(/^[0-9a-f]{40}$/.test(packName)).toBe(true);
    });

    it("same objects produce same pack checksum", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("consistent content"),
        },
      ];

      const result1 = await writePack(objects);
      const result2 = await writePack(objects);

      // Same input should produce same checksum
      expect(Array.from(result1.packChecksum)).toEqual(Array.from(result2.packChecksum));
    });

    it("different objects produce different pack checksums", async () => {
      const objects1: PackWriterObject[] = [
        {
          id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("content A"),
        },
      ];

      const objects2: PackWriterObject[] = [
        {
          id: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("content B"),
        },
      ];

      const result1 = await writePack(objects1);
      const result2 = await writePack(objects2);

      // Different content should produce different checksums
      expect(Array.from(result1.packChecksum)).not.toEqual(Array.from(result2.packChecksum));
    });

    it("checksum is appended to pack data", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "cccccccccccccccccccccccccccccccccccccccc",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("checksum test"),
        },
      ];

      const result = await writePack(objects);

      // Last 20 bytes of pack data should be the checksum
      const lastBytes = result.packData.subarray(result.packData.length - 20);
      expect(Array.from(lastBytes)).toEqual(Array.from(result.packChecksum));
    });

    it("checksum is computed over all preceding data", async () => {
      const objects: PackWriterObject[] = [
        {
          id: "dddddddddddddddddddddddddddddddddddddddd",
          type: PackObjectType.BLOB,
          content: new TextEncoder().encode("verify checksum"),
        },
      ];

      const result = await writePack(objects);

      // Compute expected checksum
      const dataWithoutChecksum = result.packData.subarray(0, result.packData.length - 20);
      const expectedChecksum = await sha1Hex(dataWithoutChecksum);

      const actualChecksum = Array.from(result.packChecksum)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      expect(actualChecksum).toBe(expectedChecksum);
    });
  });
});
