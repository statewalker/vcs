/**
 * Tests for GitRawObjectStorage
 *
 * Based on JGit's UnpackedObjectTest.java and ObjectDirectoryTest.java
 * Tests storage, loading, compression, and error handling for loose objects.
 */

import { dirname, FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { compressBlock, setCompression } from "@webrun-vcs/compression";
import { createNodeCompression } from "@webrun-vcs/compression/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GitRawObjectStorage } from "../src/git-raw-objects-storage.js";
import { getLooseObjectPath } from "../src/utils/file-utils.js";

describe("GitRawObjectStorage", () => {
  let files: FilesApi;
  let storage: GitRawObjectStorage;
  const gitDir = ".git";

  beforeAll(() => {
    setCompression(createNodeCompression());
  });

  beforeEach(async () => {
    files = new FilesApi(new MemFilesApi());
    // Create the objects directory structure
    await files.mkdir(`${gitDir}/objects`);
    storage = new GitRawObjectStorage(files, gitDir);
  });

  /**
   * Helper to create Git object format: "type size\0content"
   */
  function createGitObject(type: string, content: Uint8Array): Uint8Array {
    const header = new TextEncoder().encode(`${type} ${content.length}\0`);
    const result = new Uint8Array(header.length + content.length);
    result.set(header, 0);
    result.set(content, header.length);
    return result;
  }

  /**
   * Helper to collect async iterable into single Uint8Array
   */
  async function collectChunks(iterable: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of iterable) {
      chunks.push(chunk);
    }
    if (chunks.length === 0) return new Uint8Array(0);
    if (chunks.length === 1) return chunks[0];
    const totalLength = chunks.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  describe("store() and load()", () => {
    it("stores and loads small blob object", async () => {
      const content = new TextEncoder().encode("Hello, World!");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
      expect(info.size).toBe(gitObject.length);
    });

    it("stores and loads large blob object", async () => {
      // Create a 100KB blob
      const size = 100 * 1024;
      const content = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        content[i] = i % 256;
      }
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
      expect(info.size).toBe(gitObject.length);
    });

    it("stores commit object", async () => {
      const commitContent = new TextEncoder().encode(
        `tree ${"a".repeat(40)}\nauthor Test <test@test.com> 1234567890 +0000\ncommitter Test <test@test.com> 1234567890 +0000\n\nTest commit message`,
      );
      const gitObject = createGitObject("commit", commitContent);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
    });

    it("stores tree object", async () => {
      // Minimal tree entry: mode SP name NUL sha1
      const treeContent = new Uint8Array([
        0x31, 0x30, 0x30, 0x36, 0x34, 0x34, // "100644"
        0x20, // space
        0x66, 0x69, 0x6c, 0x65, // "file"
        0x00, // NUL
        ...new Uint8Array(20), // 20-byte SHA-1
      ]);
      const gitObject = createGitObject("tree", treeContent);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
    });

    it("stores tag object", async () => {
      const tagContent = new TextEncoder().encode(
        `object ${"a".repeat(40)}\ntype commit\ntag v1.0.0\ntagger Test <test@test.com> 1234567890 +0000\n\nTag message`,
      );
      const gitObject = createGitObject("tag", tagContent);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
    });

    it("handles async iterable input", async () => {
      const content = new TextEncoder().encode("async test");
      const gitObject = createGitObject("blob", content);

      // Create async generator
      async function* generateChunks() {
        yield gitObject.subarray(0, 10);
        yield gitObject.subarray(10);
      }

      const info = await storage.store(generateChunks());
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
    });

    it("loads with offset and length", async () => {
      const content = new TextEncoder().encode("Hello, World!");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Load just a portion
      const partial = await collectChunks(storage.load(info.id, { offset: 5, length: 10 }));

      expect(partial).toEqual(gitObject.subarray(5, 15));
    });
  });

  describe("compression roundtrip", () => {
    it("compresses data when storing and decompresses when loading", async () => {
      const content = new TextEncoder().encode("Test content for compression");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Verify file is stored with different size (compressed)
      const filePath = `.git/objects/${info.id.substring(0, 2)}/${info.id.substring(2)}`;
      const rawFileContent = await files.readFile(filePath);

      // Compressed data should be different from original
      expect(rawFileContent.length).not.toBe(gitObject.length);

      // But loaded data should match original
      const loaded = await collectChunks(storage.load(info.id));
      expect(loaded).toEqual(gitObject);
    });

    it("produces deterministic hashes for same content", async () => {
      const content = new TextEncoder().encode("Deterministic content");
      const gitObject = createGitObject("blob", content);

      // Store twice in different storage instances
      const storage2 = new GitRawObjectStorage(files, gitDir);

      const info1 = await storage.store([gitObject]);
      const info2 = await storage2.store([gitObject]);

      expect(info1.id).toBe(info2.id);
    });
  });

  describe("deduplication", () => {
    it("does not create duplicate files for same content", async () => {
      const content = new TextEncoder().encode("dedupe test");
      const gitObject = createGitObject("blob", content);

      const info1 = await storage.store([gitObject]);
      const info2 = await storage.store([gitObject]);

      expect(info1.id).toBe(info2.id);
      expect(info1.size).toBe(info2.size);

      // Count files in the fanout directory
      const prefix = info1.id.substring(0, 2);
      let fileCount = 0;
      for await (const entry of files.list(`${gitDir}/objects/${prefix}`)) {
        if (entry.kind === "file") fileCount++;
      }

      expect(fileCount).toBe(1);
    });

    it("creates separate files for different content with same size", async () => {
      const content1 = new TextEncoder().encode("content A");
      const content2 = new TextEncoder().encode("content B");
      const gitObject1 = createGitObject("blob", content1);
      const gitObject2 = createGitObject("blob", content2);

      const info1 = await storage.store([gitObject1]);
      const info2 = await storage.store([gitObject2]);

      expect(info1.id).not.toBe(info2.id);
    });
  });

  describe("getInfo()", () => {
    it("returns info for existing object", async () => {
      const content = new TextEncoder().encode("test");
      const gitObject = createGitObject("blob", content);

      const storeInfo = await storage.store([gitObject]);
      const loadInfo = await storage.getInfo(storeInfo.id);

      expect(loadInfo).not.toBeNull();
      expect(loadInfo?.id).toBe(storeInfo.id);
      expect(loadInfo?.size).toBe(gitObject.length);
    });

    it("returns null for non-existent object", async () => {
      const fakeId = "0".repeat(40);

      const info = await storage.getInfo(fakeId);

      expect(info).toBeNull();
    });
  });

  describe("delete()", () => {
    it("deletes existing object", async () => {
      const content = new TextEncoder().encode("to be deleted");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);
      const deleted = await storage.delete(info.id);

      expect(deleted).toBe(true);

      // Verify object is gone
      const loadInfo = await storage.getInfo(info.id);
      expect(loadInfo).toBeNull();
    });

    it("returns false for non-existent object", async () => {
      const fakeId = "0".repeat(40);

      const deleted = await storage.delete(fakeId);

      expect(deleted).toBe(false);
    });
  });

  describe("listObjects()", () => {
    it("lists all stored objects", async () => {
      const objects = [
        createGitObject("blob", new TextEncoder().encode("blob 1")),
        createGitObject("blob", new TextEncoder().encode("blob 2")),
        createGitObject("blob", new TextEncoder().encode("blob 3")),
      ];

      const storedIds: string[] = [];
      for (const obj of objects) {
        const info = await storage.store([obj]);
        storedIds.push(info.id);
      }

      const listedInfos = [];
      for await (const info of storage.listObjects()) {
        listedInfos.push(info);
      }

      expect(listedInfos).toHaveLength(3);
      const listedIds = listedInfos.map((i) => i.id);
      for (const id of storedIds) {
        expect(listedIds).toContain(id);
      }
    });

    it("returns empty iterator when no objects exist", async () => {
      const infos = [];
      for await (const info of storage.listObjects()) {
        infos.push(info);
      }

      expect(infos).toHaveLength(0);
    });

    it("skips non-hex directories", async () => {
      const content = new TextEncoder().encode("valid");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Create a non-hex directory with a file
      await files.mkdir(`${gitDir}/objects/zz`);
      await files.write(`${gitDir}/objects/zz/${"0".repeat(38)}`, [new Uint8Array([1, 2, 3])]);

      const listedInfos = [];
      for await (const listInfo of storage.listObjects()) {
        listedInfos.push(listInfo);
      }

      expect(listedInfos).toHaveLength(1);
      expect(listedInfos[0].id).toBe(info.id);
    });

    it("skips files in root objects directory", async () => {
      const content = new TextEncoder().encode("valid");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Create a file directly in objects directory (not in a fanout dir)
      await files.write(`${gitDir}/objects/some-file`, [new Uint8Array([1, 2, 3])]);

      const listedInfos = [];
      for await (const listInfo of storage.listObjects()) {
        listedInfos.push(listInfo);
      }

      expect(listedInfos).toHaveLength(1);
      expect(listedInfos[0].id).toBe(info.id);
    });

    it("skips files with wrong suffix length", async () => {
      const content = new TextEncoder().encode("valid");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Create files with wrong suffix length in aa/ directory
      await files.mkdir(`${gitDir}/objects/aa`);
      await files.write(`${gitDir}/objects/aa/short`, [new Uint8Array([1, 2, 3])]);
      await files.write(`${gitDir}/objects/aa/${"a".repeat(50)}`, [new Uint8Array([1, 2, 3])]);

      const listedInfos = [];
      for await (const listInfo of storage.listObjects()) {
        listedInfos.push(listInfo);
      }

      expect(listedInfos).toHaveLength(1);
      expect(listedInfos[0].id).toBe(info.id);
    });

    it("skips non-hex suffixes", async () => {
      const content = new TextEncoder().encode("valid");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Create files with non-hex characters in ab/ directory
      await files.mkdir(`${gitDir}/objects/ab`);
      await files.write(`${gitDir}/objects/ab/${"z".repeat(38)}`, [new Uint8Array([1, 2, 3])]);

      const listedInfos = [];
      for await (const listInfo of storage.listObjects()) {
        listedInfos.push(listInfo);
      }

      expect(listedInfos).toHaveLength(1);
      expect(listedInfos[0].id).toBe(info.id);
    });

    it("handles subdirectories inside fanout directories", async () => {
      const content = new TextEncoder().encode("valid");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Create a subdirectory inside a fanout directory
      await files.mkdir(`${gitDir}/objects/aa`);
      await files.mkdir(`${gitDir}/objects/aa/subdir`);

      const listedInfos = [];
      for await (const listInfo of storage.listObjects()) {
        listedInfos.push(listInfo);
      }

      expect(listedInfos).toHaveLength(1);
      expect(listedInfos[0].id).toBe(info.id);
    });

    it("handles multiple objects in same fanout directory", async () => {
      // Store multiple objects - some may end up in the same fanout dir
      const storedIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const gitObject = createGitObject("blob", new TextEncoder().encode(`content ${i}`));
        const info = await storage.store([gitObject]);
        storedIds.push(info.id);
      }

      // All objects should be listed
      const listedInfos = [];
      for await (const listInfo of storage.listObjects()) {
        listedInfos.push(listInfo);
      }

      expect(listedInfos).toHaveLength(20);
      const listedIds = listedInfos.map((i) => i.id);
      for (const id of storedIds) {
        expect(listedIds).toContain(id);
      }
    });
  });

  describe("error handling", () => {
    it("throws when loading non-existent object", async () => {
      const fakeId = "0".repeat(40);

      await expect(collectChunks(storage.load(fakeId))).rejects.toThrow(`Object not found: ${fakeId}`);
    });

    it("creates fanout directory if not exists", async () => {
      const content = new TextEncoder().encode("new fanout");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);

      // Verify fanout directory was created
      const prefix = info.id.substring(0, 2);
      const exists = await files.exists(`${gitDir}/objects/${prefix}`);
      expect(exists).toBe(true);
    });
  });

  describe("corrupt object handling", () => {
    const fakeId = "0".repeat(40);
    const objectsDir = `${gitDir}/objects`;

    /**
     * Helper to write raw bytes directly to a loose object path
     */
    async function writeRawObject(id: string, data: Uint8Array): Promise<void> {
      const path = getLooseObjectPath(objectsDir, id);
      const dir = dirname(path);
      await files.mkdir(dir);
      await files.write(path, [data]);
    }

    /**
     * Helper to create a valid compressed object
     */
    async function createCompressedObject(
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

    it("throws on corrupt zlib stream", async () => {
      // Create a valid compressed object first, then corrupt it
      const validCompressed = await createCompressedObject("blob 5\0", new TextEncoder().encode("hello"));

      // Corrupt the middle of the compressed data
      const corruptData = new Uint8Array(validCompressed);
      for (let i = 5; i < corruptData.length; i++) {
        corruptData[i] = 0;
      }

      await writeRawObject(fakeId, corruptData);

      await expect(collectChunks(storage.load(fakeId))).rejects.toThrow();
    });

    it("throws on truncated zlib stream", async () => {
      // Create a valid compressed object, then truncate it
      const validCompressed = await createCompressedObject("blob 5\0", new TextEncoder().encode("hello"));

      // Truncate the compressed data
      const truncated = validCompressed.subarray(0, Math.max(2, validCompressed.length - 5));

      await writeRawObject(fakeId, truncated);

      await expect(collectChunks(storage.load(fakeId))).rejects.toThrow();
    });

    it("throws on non-zlib data (raw garbage)", async () => {
      // Write raw uncompressed garbage
      const garbage = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05]);

      await writeRawObject(fakeId, garbage);

      await expect(collectChunks(storage.load(fakeId))).rejects.toThrow();
    });

    it("throws on empty file", async () => {
      // Write empty file
      await writeRawObject(fakeId, new Uint8Array(0));

      await expect(collectChunks(storage.load(fakeId))).rejects.toThrow();
    });

    it("successfully loads valid manually-written compressed object", async () => {
      // Create a properly formatted and compressed Git object
      const content = new TextEncoder().encode("hello");
      const validCompressed = await createCompressedObject(`blob ${content.length}\0`, content);

      await writeRawObject(fakeId, validCompressed);

      // Should load without error
      const loaded = await collectChunks(storage.load(fakeId));
      expect(loaded).toEqual(createGitObject("blob", content));
    });

    it("getInfo throws for corrupt object", async () => {
      // Write corrupt data
      const garbage = new Uint8Array([0x01, 0x02, 0x03]);
      await writeRawObject(fakeId, garbage);

      // getInfo throws when trying to decompress corrupt data
      await expect(storage.getInfo(fakeId)).rejects.toThrow();
    });
  });

  describe("close()", () => {
    it("close is a no-op for loose storage", async () => {
      // Store an object
      const content = new TextEncoder().encode("test");
      const gitObject = createGitObject("blob", content);
      await storage.store([gitObject]);

      // Close should not throw
      await storage.close();

      // Storage should still work after close (no persistent state to clean up)
      // Note: In a real implementation with file handles, this might behave differently
    });
  });

  describe("edge cases from JGit tests", () => {
    it("handles empty blob", async () => {
      const gitObject = createGitObject("blob", new Uint8Array(0));

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
      expect(info.size).toBe(gitObject.length);
    });

    it("handles binary content with null bytes", async () => {
      const content = new Uint8Array([0, 1, 2, 0, 3, 4, 0, 0, 5]);
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
    });

    it("handles unicode content", async () => {
      const content = new TextEncoder().encode("Hello 世界 🌍");
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
    });

    it("handles single byte content", async () => {
      const content = new Uint8Array([42]);
      const gitObject = createGitObject("blob", content);

      const info = await storage.store([gitObject]);
      const loaded = await collectChunks(storage.load(info.id));

      expect(loaded).toEqual(gitObject);
    });
  });
});
