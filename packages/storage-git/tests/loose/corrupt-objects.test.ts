/**
 * Tests for corrupt loose object handling
 *
 * Based on JGit's UnpackedObjectTest.java
 * These tests verify that the implementation properly detects and rejects
 * malformed loose objects.
 */

import { dirname, FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { compressBlock, setCompression } from "@webrun-vcs/compression";
import { createNodeCompression } from "@webrun-vcs/compression/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseObjectHeader } from "../../src/format/object-header.js";
import { getLooseObjectPath, readLooseObject } from "../../src/loose/loose-object-reader.js";

describe("corrupt loose objects", () => {
  let files: FilesApi;
  const objectsDir = "objects";
  const fakeId = "0".repeat(40);

  beforeAll(() => {
    setCompression(createNodeCompression());
  });

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  /**
   * Helper to create a compressed object with custom header
   */
  async function createCorruptObject(
    headerContent: string,
    body: Uint8Array = new Uint8Array(0),
  ): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const header = encoder.encode(headerContent);
    const raw = new Uint8Array(header.length + body.length);
    raw.set(header, 0);
    raw.set(body, header.length);
    return compressBlock(raw, { raw: false });
  }

  /**
   * Helper to write a corrupt object to the store
   */
  async function writeCorruptObject(
    id: string,
    headerContent: string,
    body: Uint8Array = new Uint8Array(0),
  ): Promise<void> {
    const compressed = await createCorruptObject(headerContent, body);
    const path = getLooseObjectPath(objectsDir, id, files);
    const dir = dirname(path);
    await files.mkdir(dir, { recursive: true });
    await files.write(path, [compressed]);
  }

  describe("header corruption", () => {
    it("rejects negative size", async () => {
      // Header: "blob -1\0"
      await writeCorruptObject(fakeId, "blob -1\0");

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(
        /Invalid object size/,
      );
    });

    it("rejects invalid type string", async () => {
      // Header: "not.a.type 10\0"
      await writeCorruptObject(fakeId, "not.a.type 10\0");

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(
        /Invalid object type/,
      );
    });

    it("rejects missing header (empty object)", async () => {
      // Empty compressed data
      const compressed = await compressBlock(new Uint8Array(0), { raw: false });
      const path = getLooseObjectPath(objectsDir, fakeId, files);
      const dir = dirname(path);
      await files.mkdir(dir, { recursive: true });
      await files.write(path, [compressed]);

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(
        /no null byte found|Invalid object header/,
      );
    });

    it("rejects header without null byte", async () => {
      // Header without null terminator: "blob 10"
      const compressed = await compressBlock(new TextEncoder().encode("blob 10"), { raw: false });
      const path = getLooseObjectPath(objectsDir, fakeId, files);
      const dir = dirname(path);
      await files.mkdir(dir, { recursive: true });
      await files.write(path, [compressed]);

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(
        /no null byte found/,
      );
    });

    it("rejects header without space between type and size", async () => {
      // Header: "blob10\0"
      await writeCorruptObject(fakeId, "blob10\0");

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(
        /no space found|Invalid/,
      );
    });

    it("rejects garbage after size", async () => {
      // Header: "blob 1foo\0" - extra characters after size
      // Note: parseInt("1foo", 10) returns 1, so this becomes a size mismatch
      await writeCorruptObject(fakeId, "blob 1foo\0");

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(/size mismatch/);
    });

    it("rejects non-numeric size", async () => {
      // Header: "blob abc\0"
      await writeCorruptObject(fakeId, "blob abc\0");

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(
        /Invalid object size/,
      );
    });
  });

  describe("size mismatch", () => {
    it("rejects when content is shorter than declared size", async () => {
      // Header says 100 bytes, but content is only 5 bytes
      const body = new TextEncoder().encode("hello");
      await writeCorruptObject(fakeId, "blob 100\0", body);

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(/size mismatch/);
    });

    it("rejects when content is longer than declared size", async () => {
      // Header says 3 bytes, but content is 10 bytes
      const body = new TextEncoder().encode("hello world");
      await writeCorruptObject(fakeId, "blob 3\0", body);

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(/size mismatch/);
    });

    it("accepts when content matches declared size", async () => {
      const body = new TextEncoder().encode("hello");
      await writeCorruptObject(fakeId, "blob 5\0", body);

      const result = await readLooseObject(files, objectsDir, fakeId);
      expect(result.size).toBe(5);
      expect(result.type).toBe("blob");
    });
  });

  describe("zlib corruption", () => {
    it("rejects corrupt zlib stream", async () => {
      // Create a valid compressed object first, then corrupt it
      const validCompressed = await createCorruptObject(
        "blob 5\0",
        new TextEncoder().encode("hello"),
      );

      // Corrupt the middle of the compressed data
      const corruptData = new Uint8Array(validCompressed);
      for (let i = 5; i < corruptData.length; i++) {
        corruptData[i] = 0;
      }

      const path = getLooseObjectPath(objectsDir, fakeId, files);
      const dir = dirname(path);
      await files.mkdir(dir, { recursive: true });
      await files.write(path, [corruptData]);

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow();
    });

    it("rejects truncated zlib stream", async () => {
      // Create a valid compressed object, then truncate it
      const validCompressed = await createCorruptObject(
        "blob 5\0",
        new TextEncoder().encode("hello"),
      );

      // Truncate the compressed data
      const truncated = validCompressed.subarray(0, Math.max(2, validCompressed.length - 5));

      const path = getLooseObjectPath(objectsDir, fakeId, files);
      const dir = dirname(path);
      await files.mkdir(dir, { recursive: true });
      await files.write(path, [truncated]);

      await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow();
    });
  });

  describe("parseObjectHeader direct tests", () => {
    it("parses valid blob header", () => {
      const data = new TextEncoder().encode("blob 123\0content here");
      const header = parseObjectHeader(data);

      expect(header.type).toBe("blob");
      expect(header.size).toBe(123);
      expect(header.contentOffset).toBe(9); // "blob 123\0".length
    });

    it("parses valid commit header", () => {
      const data = new TextEncoder().encode("commit 456\0content");
      const header = parseObjectHeader(data);

      expect(header.type).toBe("commit");
      expect(header.size).toBe(456);
    });

    it("parses valid tree header", () => {
      const data = new TextEncoder().encode("tree 0\0");
      const header = parseObjectHeader(data);

      expect(header.type).toBe("tree");
      expect(header.size).toBe(0);
    });

    it("parses valid tag header", () => {
      const data = new TextEncoder().encode("tag 789\0content");
      const header = parseObjectHeader(data);

      expect(header.type).toBe("tag");
      expect(header.size).toBe(789);
    });

    it("rejects unknown type", () => {
      const data = new TextEncoder().encode("unknown 10\0content");
      expect(() => parseObjectHeader(data)).toThrow(/Invalid object type/);
    });

    it("rejects missing null byte", () => {
      const data = new TextEncoder().encode("blob 10");
      expect(() => parseObjectHeader(data)).toThrow(/no null byte found/);
    });

    it("rejects missing space", () => {
      const data = new TextEncoder().encode("blob10\0content");
      expect(() => parseObjectHeader(data)).toThrow(/no space found/);
    });

    it("rejects negative size", () => {
      const data = new TextEncoder().encode("blob -5\0");
      expect(() => parseObjectHeader(data)).toThrow(/Invalid object size/);
    });

    it("rejects NaN size", () => {
      const data = new TextEncoder().encode("blob xyz\0");
      expect(() => parseObjectHeader(data)).toThrow(/Invalid object size/);
    });
  });

  describe("all object types", () => {
    const testCases = [
      { type: "blob", typeCode: 3 },
      { type: "tree", typeCode: 2 },
      { type: "commit", typeCode: 1 },
      { type: "tag", typeCode: 4 },
    ];

    for (const { type, typeCode } of testCases) {
      it(`accepts valid ${type} object`, async () => {
        const content = new TextEncoder().encode("test content");
        await writeCorruptObject(fakeId, `${type} ${content.length}\0`, content);

        const result = await readLooseObject(files, objectsDir, fakeId);
        expect(result.type).toBe(type);
        expect(result.typeCode).toBe(typeCode);
        expect(result.size).toBe(content.length);
      });

      it(`rejects ${type} with wrong size`, async () => {
        const content = new TextEncoder().encode("test content");
        await writeCorruptObject(fakeId, `${type} 999\0`, content);

        await expect(readLooseObject(files, objectsDir, fakeId)).rejects.toThrow(/size mismatch/);
      });
    }
  });

  describe("edge cases", () => {
    it("handles empty content blob", async () => {
      await writeCorruptObject(fakeId, "blob 0\0", new Uint8Array(0));

      const result = await readLooseObject(files, objectsDir, fakeId);
      expect(result.size).toBe(0);
      expect(result.content.length).toBe(0);
    });

    it("handles large size values", async () => {
      const largeSize = 1000000;
      const header = new TextEncoder().encode(`blob ${largeSize}\0`);

      // We can't actually write a million bytes, but we can verify size parsing
      expect(() => parseObjectHeader(header)).not.toThrow();
      const parsed = parseObjectHeader(header);
      expect(parsed.size).toBe(largeSize);
    });

    it("handles binary content", async () => {
      // Binary content with null bytes
      const binaryContent = new Uint8Array([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00, 0x00]);
      await writeCorruptObject(fakeId, `blob ${binaryContent.length}\0`, binaryContent);

      const result = await readLooseObject(files, objectsDir, fakeId);
      expect(result.content).toEqual(binaryContent);
    });
  });
});
