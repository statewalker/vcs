/**
 * Tests for loose object handling
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  getLooseObjectPath,
  hasLooseObject,
  readLooseObject,
} from "../../src/loose/loose-object-reader.js";
import { writeLooseObject } from "../../src/loose/loose-object-writer.js";

describe("loose-objects", () => {
  let files: FilesApi;
  const objectsDir = "objects";

  beforeAll(() => {
    setCompression(createNodeCompression());
  });

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  describe("getLooseObjectPath", () => {
    it("creates correct path", () => {
      const id = "a".repeat(40);
      const path = getLooseObjectPath(objectsDir, id);
      // Path is /objects/XX/YYYYYY... where XX is first 2 chars, rest is remaining 38 chars
      // Note: joinPath normalizes to absolute paths with leading /
      expect(path).toBe(`/objects/aa/${"a".repeat(38)}`);
    });

    it("handles different prefixes", () => {
      const id = "1234567890abcdef1234567890abcdef12345678";
      const path = getLooseObjectPath(objectsDir, id);
      expect(path).toBe("/objects/12/34567890abcdef1234567890abcdef12345678");
    });
  });

  describe("writeLooseObject / readLooseObject", () => {
    it("writes and reads blob object", async () => {
      const content = new TextEncoder().encode("Hello, World!");

      const id = await writeLooseObject(files, objectsDir, "blob", content);

      expect(id).toBeDefined();
      expect(id.length).toBe(40);

      const data = await readLooseObject(files, objectsDir, id);

      expect(data.type).toBe("blob");
      expect(data.size).toBe(content.length);
      expect(new TextDecoder().decode(data.content)).toBe("Hello, World!");
    });

    it("writes and reads tree object", async () => {
      // Simple tree-like binary content (not a real tree, just testing)
      const content = new Uint8Array([1, 2, 3, 4, 5]);

      const id = await writeLooseObject(files, objectsDir, "tree", content);

      const data = await readLooseObject(files, objectsDir, id);

      expect(data.type).toBe("tree");
      expect(data.content).toEqual(content);
    });

    it("deduplicates identical content", async () => {
      const content = new TextEncoder().encode("Duplicate content");

      const id1 = await writeLooseObject(files, objectsDir, "blob", content);
      const id2 = await writeLooseObject(files, objectsDir, "blob", content);

      expect(id1).toBe(id2);

      // Both writes should produce the same object ID (deduplication)
      // The hasLooseObject check inside writeLooseObject prevents duplicate writes
      expect(await hasLooseObject(files, objectsDir, id1)).toBe(true);
    });

    it("handles empty content", async () => {
      const content = new Uint8Array(0);

      const id = await writeLooseObject(files, objectsDir, "blob", content);

      const data = await readLooseObject(files, objectsDir, id);

      expect(data.size).toBe(0);
      expect(data.content.length).toBe(0);
    });

    it("handles binary content", async () => {
      const content = new Uint8Array(256);
      for (let i = 0; i < 256; i++) content[i] = i;

      const id = await writeLooseObject(files, objectsDir, "blob", content);

      const data = await readLooseObject(files, objectsDir, id);

      expect(data.content).toEqual(content);
    });
  });

  describe("hasLooseObject", () => {
    it("returns true for existing object", async () => {
      const content = new TextEncoder().encode("Test");

      const id = await writeLooseObject(files, objectsDir, "blob", content);

      expect(await hasLooseObject(files, objectsDir, id)).toBe(true);
    });

    it("returns false for non-existing object", async () => {
      const fakeId = "0".repeat(40);
      expect(await hasLooseObject(files, objectsDir, fakeId)).toBe(false);
    });
  });

  describe("well-known hashes", () => {
    it("produces correct SHA-1 for empty blob", async () => {
      const content = new Uint8Array(0);

      const id = await writeLooseObject(files, objectsDir, "blob", content);

      // Empty blob hash is well-known
      expect(id).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
    });

    it("produces correct SHA-1 for 'Hello, World!' blob", async () => {
      const content = new TextEncoder().encode("Hello, World!");

      const id = await writeLooseObject(files, objectsDir, "blob", content);

      // Verified with: echo -n "Hello, World!" | git hash-object --stdin
      expect(id).toBe("b45ef6fec89518d314f546fd6c3025367b721684");
    });
  });
});
