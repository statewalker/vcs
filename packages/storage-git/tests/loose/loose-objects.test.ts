/**
 * Tests for loose object handling
 */

import { describe, expect, it, beforeEach } from "vitest";
import { NodeCompressionProvider } from "@webrun-vcs/common";
import { MemoryFileApi } from "../../src/file-api/memory-file-api.js";
import {
  getLooseObjectPath,
  hasLooseObject,
  readLooseObject,
} from "../../src/loose/loose-object-reader.js";
import { writeLooseObject } from "../../src/loose/loose-object-writer.js";
import {
  createObjectDirectory,
  ObjectDirectory,
} from "../../src/loose/object-directory.js";

describe("loose-objects", () => {
  let files: MemoryFileApi;
  let compression: NodeCompressionProvider;
  const objectsDir = "objects";

  beforeEach(() => {
    files = new MemoryFileApi();
    compression = new NodeCompressionProvider();
  });

  describe("getLooseObjectPath", () => {
    it("creates correct path", () => {
      const id = "a".repeat(40);
      const path = getLooseObjectPath(objectsDir, id, files);
      // Path is objects/XX/YYYYYY... where XX is first 2 chars, rest is remaining 38 chars
      expect(path).toBe("objects/aa/" + "a".repeat(38));
    });

    it("handles different prefixes", () => {
      const id = "1234567890abcdef1234567890abcdef12345678";
      const path = getLooseObjectPath(objectsDir, id, files);
      expect(path).toBe("objects/12/34567890abcdef1234567890abcdef12345678");
    });
  });

  describe("writeLooseObject / readLooseObject", () => {
    it("writes and reads blob object", async () => {
      const content = new TextEncoder().encode("Hello, World!");

      const id = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );

      expect(id).toBeDefined();
      expect(id.length).toBe(40);

      const data = await readLooseObject(files, compression, objectsDir, id);

      expect(data.type).toBe("blob");
      expect(data.size).toBe(content.length);
      expect(new TextDecoder().decode(data.content)).toBe("Hello, World!");
    });

    it("writes and reads tree object", async () => {
      // Simple tree-like binary content (not a real tree, just testing)
      const content = new Uint8Array([1, 2, 3, 4, 5]);

      const id = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "tree",
        content,
      );

      const data = await readLooseObject(files, compression, objectsDir, id);

      expect(data.type).toBe("tree");
      expect(data.content).toEqual(content);
    });

    it("deduplicates identical content", async () => {
      const content = new TextEncoder().encode("Duplicate content");

      const id1 = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );
      const id2 = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );

      expect(id1).toBe(id2);

      // Only one file should exist
      const snapshot = files.snapshot();
      const objectFiles = Array.from(snapshot.keys()).filter((p) =>
        p.startsWith("objects/"),
      );
      expect(objectFiles.length).toBe(1);
    });

    it("handles empty content", async () => {
      const content = new Uint8Array(0);

      const id = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );

      const data = await readLooseObject(files, compression, objectsDir, id);

      expect(data.size).toBe(0);
      expect(data.content.length).toBe(0);
    });

    it("handles binary content", async () => {
      const content = new Uint8Array(256);
      for (let i = 0; i < 256; i++) content[i] = i;

      const id = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );

      const data = await readLooseObject(files, compression, objectsDir, id);

      expect(data.content).toEqual(content);
    });
  });

  describe("hasLooseObject", () => {
    it("returns true for existing object", async () => {
      const content = new TextEncoder().encode("Test");

      const id = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );

      expect(await hasLooseObject(files, objectsDir, id)).toBe(true);
    });

    it("returns false for non-existing object", async () => {
      const fakeId = "0".repeat(40);
      expect(await hasLooseObject(files, objectsDir, fakeId)).toBe(false);
    });
  });

  describe("ObjectDirectory", () => {
    let objDir: ObjectDirectory;

    beforeEach(() => {
      objDir = createObjectDirectory(files, compression, objectsDir);
    });

    it("writes and reads objects", async () => {
      const content = new TextEncoder().encode("Directory test");

      const id = await objDir.writeBlob(content);
      const data = await objDir.read(id);

      expect(data.type).toBe("blob");
      expect(new TextDecoder().decode(data.content)).toBe("Directory test");
    });

    it("checks existence", async () => {
      const content = new TextEncoder().encode("Exists");

      const id = await objDir.writeBlob(content);

      expect(await objDir.has(id)).toBe(true);
      expect(await objDir.has("0".repeat(40))).toBe(false);
    });

    it("deletes objects", async () => {
      const content = new TextEncoder().encode("Delete me");

      const id = await objDir.writeBlob(content);
      expect(await objDir.has(id)).toBe(true);

      const deleted = await objDir.delete(id);
      expect(deleted).toBe(true);
      expect(await objDir.has(id)).toBe(false);
    });

    it("enumerates objects", async () => {
      // Write several objects
      await objDir.writeBlob(new TextEncoder().encode("Object 1"));
      await objDir.writeBlob(new TextEncoder().encode("Object 2"));
      await objDir.writeBlob(new TextEncoder().encode("Object 3"));

      const entries = [];
      for await (const entry of objDir.enumerate()) {
        entries.push(entry);
      }

      expect(entries.length).toBe(3);
      for (const entry of entries) {
        expect(entry.id.length).toBe(40);
        expect(entry.typeCode).toBe(3); // BLOB
      }
    });

    it("reads header without full content", async () => {
      const content = new TextEncoder().encode("Header test");

      const id = await objDir.writeBlob(content);
      const header = await objDir.readHeader(id);

      expect(header.type).toBe(3); // BLOB
      expect(header.size).toBe(content.length);
    });
  });

  describe("well-known hashes", () => {
    it("produces correct SHA-1 for empty blob", async () => {
      const content = new Uint8Array(0);

      const id = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );

      // Empty blob hash is well-known
      expect(id).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    });

    it("produces correct SHA-1 for 'Hello, World!' blob", async () => {
      const content = new TextEncoder().encode("Hello, World!");

      const id = await writeLooseObject(
        files,
        compression,
        objectsDir,
        "blob",
        content,
      );

      // Verified with: echo -n "Hello, World!" | git hash-object --stdin
      expect(id).toBe("b45ef6fec89518d314f546fd6c3025367b721684");
    });
  });
});
