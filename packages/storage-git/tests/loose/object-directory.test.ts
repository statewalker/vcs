/**
 * Tests for ObjectDirectory robustness
 *
 * Based on JGit's ObjectDirectoryTest.java
 * Tests error handling, pack file scanning, and concurrent operations.
 */

import { NodeCompressionProvider } from "@webrun-vcs/common";
import type { ObjectId } from "@webrun-vcs/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryFileApi } from "../../src/file-api/memory-file-api.js";
import { createObjectDirectory, type ObjectDirectory } from "../../src/loose/object-directory.js";

describe("ObjectDirectory", () => {
  let files: MemoryFileApi;
  let compression: NodeCompressionProvider;
  let objDir: ObjectDirectory;
  const objectsDir = "objects";

  beforeEach(() => {
    files = new MemoryFileApi();
    compression = new NodeCompressionProvider();
    objDir = createObjectDirectory(files, compression, objectsDir);
  });

  describe("error handling", () => {
    it("throws when reading non-existent object", async () => {
      const fakeId = "0".repeat(40);

      await expect(objDir.read(fakeId)).rejects.toThrow();
    });

    it("throws when reading header of non-existent object", async () => {
      const fakeId = "0".repeat(40);

      await expect(objDir.readHeader(fakeId)).rejects.toThrow();
    });

    it("returns false when deleting non-existent object", async () => {
      const fakeId = "0".repeat(40);

      const result = await objDir.delete(fakeId);

      expect(result).toBe(false);
    });

    it("handles missing objects directory in has()", async () => {
      // Don't create objects directory - it shouldn't exist
      const result = await objDir.has("a".repeat(40));

      expect(result).toBe(false);
    });

    it("handles missing objects directory in list()", async () => {
      // Don't create objects directory
      const ids: ObjectId[] = [];

      for await (const id of objDir.list()) {
        ids.push(id);
      }

      expect(ids).toHaveLength(0);
    });

    it("handles missing objects directory in enumerate()", async () => {
      // Don't create objects directory
      const entries = [];

      for await (const entry of objDir.enumerate()) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(0);
    });
  });

  describe("directory structure handling", () => {
    it("skips non-hex directories", async () => {
      // Write a valid object
      const id = await objDir.writeBlob(new TextEncoder().encode("test"));

      // Create a non-hex directory
      await files.mkdir(`${objectsDir}/zz`);
      await files.writeFile(`${objectsDir}/zz/${"0".repeat(38)}`, new Uint8Array([1, 2, 3]));

      // Should only find the valid object
      const ids: ObjectId[] = [];
      for await (const listId of objDir.list()) {
        ids.push(listId);
      }

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe(id);
    });

    it("skips files in root objects directory", async () => {
      // Write a valid object
      const id = await objDir.writeBlob(new TextEncoder().encode("test"));

      // Create a file directly in objects directory
      await files.writeFile(`${objectsDir}/some-file`, new Uint8Array([1, 2, 3]));

      // Should only find the valid object
      const ids: ObjectId[] = [];
      for await (const listId of objDir.list()) {
        ids.push(listId);
      }

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe(id);
    });

    it("skips files with wrong suffix length", async () => {
      // Write a valid object
      const id = await objDir.writeBlob(new TextEncoder().encode("test"));

      // Create a file with wrong suffix length in aa/ directory
      await files.mkdir(`${objectsDir}/aa`);
      await files.writeFile(`${objectsDir}/aa/short`, new Uint8Array([1, 2, 3]));
      await files.writeFile(`${objectsDir}/aa/${"a".repeat(50)}`, new Uint8Array([1, 2, 3]));

      // Should only find the valid object
      const ids: ObjectId[] = [];
      for await (const listId of objDir.list()) {
        ids.push(listId);
      }

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe(id);
    });

    it("skips non-hex suffixes", async () => {
      // Write a valid object
      const id = await objDir.writeBlob(new TextEncoder().encode("test"));

      // Create files with non-hex characters
      await files.mkdir(`${objectsDir}/ab`);
      await files.writeFile(
        `${objectsDir}/ab/zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz`,
        new Uint8Array([1, 2, 3]),
      );

      const ids: ObjectId[] = [];
      for await (const listId of objDir.list()) {
        ids.push(listId);
      }

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe(id);
    });

    it("handles subdirectories inside fanout directories", async () => {
      // Write a valid object
      const id = await objDir.writeBlob(new TextEncoder().encode("test"));

      // Create a subdirectory inside a fanout directory
      await files.mkdir(`${objectsDir}/aa`);
      await files.mkdir(`${objectsDir}/aa/subdir`);

      const ids: ObjectId[] = [];
      for await (const listId of objDir.list()) {
        ids.push(listId);
      }

      expect(ids).toHaveLength(1);
      expect(ids[0]).toBe(id);
    });
  });

  describe("enumeration with corrupt objects", () => {
    it("skips corrupt objects during enumeration", async () => {
      // Write valid objects
      const id1 = await objDir.writeBlob(new TextEncoder().encode("valid1"));
      const id2 = await objDir.writeBlob(new TextEncoder().encode("valid2"));

      // Write a corrupt object file directly
      await files.mkdir(`${objectsDir}/cc`);
      await files.writeFile(
        `${objectsDir}/cc/${"c".repeat(38)}`,
        new Uint8Array([1, 2, 3]), // Not valid zlib
      );

      const entries = [];
      for await (const entry of objDir.enumerate()) {
        entries.push(entry);
      }

      // Should only have the 2 valid objects
      expect(entries).toHaveLength(2);
      const foundIds = entries.map((e) => e.id);
      expect(foundIds).toContain(id1);
      expect(foundIds).toContain(id2);
    });
  });

  describe("fanout directory creation", () => {
    it("creates fanout directory on first write to prefix", async () => {
      const content = new TextEncoder().encode("test content");

      const id = await objDir.writeBlob(content);
      const prefix = id.substring(0, 2);

      // Verify fanout directory was created
      const entries = await files.readdir(objectsDir);
      const fanoutDir = entries.find((e) => e.name === prefix);

      expect(fanoutDir).toBeDefined();
      expect(fanoutDir?.isDirectory).toBe(true);
    });

    it("handles multiple objects in same fanout directory", async () => {
      // These different contents may end up in same or different fanout dirs
      // but the point is to test writing multiple objects works correctly
      const ids = [];
      for (let i = 0; i < 10; i++) {
        const id = await objDir.writeBlob(new TextEncoder().encode(`content ${i}`));
        ids.push(id);
      }

      // All objects should be readable
      for (const id of ids) {
        const data = await objDir.read(id);
        expect(data.content).toBeDefined();
      }
    });
  });

  describe("object types", () => {
    it("writes and reads commit objects", async () => {
      const commitContent = new TextEncoder().encode(
        `tree ${"a".repeat(40)}\nauthor A <a@b.com> 0 +0000\ncommitter C <c@d.com> 0 +0000\n\nmessage`,
      );

      const id = await objDir.writeCommit(commitContent);
      const header = await objDir.readHeader(id);

      expect(header.type).toBe(1); // COMMIT
    });

    it("writes and reads tree objects", async () => {
      // Minimal tree entry: mode SP name NUL sha1
      const treeContent = new Uint8Array([
        0x31,
        0x30,
        0x30,
        0x36,
        0x34,
        0x34, // "100644"
        0x20, // space
        0x66,
        0x69,
        0x6c,
        0x65, // "file"
        0x00, // NUL
        ...new Uint8Array(20), // 20-byte SHA-1
      ]);

      const id = await objDir.writeTree(treeContent);
      const header = await objDir.readHeader(id);

      expect(header.type).toBe(2); // TREE
    });

    it("writes and reads tag objects", async () => {
      const tagContent = new TextEncoder().encode(
        `object ${"a".repeat(40)}\ntype commit\ntag v1.0\ntagger T <t@t.com> 0 +0000\n\ntag message`,
      );

      const id = await objDir.writeTag(tagContent);
      const header = await objDir.readHeader(id);

      expect(header.type).toBe(4); // TAG
    });
  });

  describe("deduplication", () => {
    it("does not create duplicate files for same content", async () => {
      const content = new TextEncoder().encode("dedupe test");

      const id1 = await objDir.writeBlob(content);
      const id2 = await objDir.writeBlob(content);

      expect(id1).toBe(id2);

      // Count objects
      let count = 0;
      for await (const _ of objDir.list()) {
        count++;
      }

      expect(count).toBe(1);
    });

    it("creates separate files for different content with same size", async () => {
      const content1 = new TextEncoder().encode("content A");
      const content2 = new TextEncoder().encode("content B");

      const id1 = await objDir.writeBlob(content1);
      const id2 = await objDir.writeBlob(content2);

      expect(id1).not.toBe(id2);
    });
  });

  describe("create() method", () => {
    it("creates objects directory", async () => {
      const newDir = "new-objects";
      const newObjDir = createObjectDirectory(files, compression, newDir);

      await newObjDir.create();

      const exists = await files.exists(newDir);
      expect(exists).toBe(true);
    });

    it("is idempotent", async () => {
      const newDir = "new-objects";
      const newObjDir = createObjectDirectory(files, compression, newDir);

      await newObjDir.create();
      await newObjDir.create(); // Should not throw

      const exists = await files.exists(newDir);
      expect(exists).toBe(true);
    });
  });

  describe("getDirectory()", () => {
    it("returns the objects directory path", () => {
      expect(objDir.getDirectory()).toBe(objectsDir);
    });
  });

  describe("large objects", () => {
    it("handles large blob", async () => {
      // Create a 100KB blob
      const size = 100 * 1024;
      const content = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        content[i] = i % 256;
      }

      const id = await objDir.writeBlob(content);
      const data = await objDir.read(id);

      expect(data.size).toBe(size);
      expect(data.content).toEqual(content);
    });
  });
});
