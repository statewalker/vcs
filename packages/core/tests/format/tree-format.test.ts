/**
 * Tests for Git tree format serialization/parsing
 */

import { describe, expect, it } from "vitest";
import { collect, toArray } from "@webrun-vcs/utils/streams";
import {
  computeTreeSize,
  decodeTreeEntries,
  EMPTY_TREE_ID,
  encodeTreeEntries,
  parseTree,
  parseTreeToArray,
  serializeTree,
} from "../../src/format/tree-format.js";
import type { TreeEntry } from "../../src/types/index.js";
import { FileMode } from "../../src/types/index.js";

describe("tree-format", () => {
  const sampleId = "a".repeat(40);
  const anotherId = "b".repeat(40);

  describe("serializeTree", () => {
    it("serializes empty tree", () => {
      const result = serializeTree([]);
      expect(result.length).toBe(0);
    });

    it("serializes single file entry", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "hello.txt", id: sampleId },
      ];

      const result = serializeTree(entries);
      const parsed = parseTreeToArray(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].mode).toBe(FileMode.REGULAR_FILE);
      expect(parsed[0].name).toBe("hello.txt");
      expect(parsed[0].id).toBe(sampleId);
    });

    it("serializes directory entry", () => {
      const entries: TreeEntry[] = [{ mode: FileMode.TREE, name: "subdir", id: sampleId }];

      const result = serializeTree(entries);
      const parsed = parseTreeToArray(result);

      expect(parsed[0].mode).toBe(FileMode.TREE);
      expect(parsed[0].name).toBe("subdir");
    });

    it("serializes multiple entries sorted", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "z.txt", id: sampleId },
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: anotherId },
        { mode: FileMode.TREE, name: "m-dir", id: sampleId },
      ];

      const result = serializeTree(entries);
      const parsed = parseTreeToArray(result);

      // Should be sorted: a.txt, m-dir, z.txt
      expect(parsed[0].name).toBe("a.txt");
      expect(parsed[1].name).toBe("m-dir");
      expect(parsed[2].name).toBe("z.txt");
    });

    it("handles UTF-8 names", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "日本語.txt", id: sampleId },
        { mode: FileMode.REGULAR_FILE, name: "émoji.txt", id: anotherId },
      ];

      const result = serializeTree(entries);
      const parsed = parseTreeToArray(result);

      const names = parsed.map((e) => e.name);
      expect(names).toContain("日本語.txt");
      expect(names).toContain("émoji.txt");
    });

    it("throws for empty entry name", () => {
      const entries: TreeEntry[] = [{ mode: FileMode.REGULAR_FILE, name: "", id: sampleId }];

      expect(() => serializeTree(entries)).toThrow("cannot be empty");
    });

    it("throws for entry name with slash", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "path/file.txt", id: sampleId },
      ];

      expect(() => serializeTree(entries)).toThrow("cannot contain");
    });

    it("throws for entry name . or ..", () => {
      expect(() =>
        serializeTree([{ mode: FileMode.REGULAR_FILE, name: ".", id: sampleId }]),
      ).toThrow("cannot be '.'");

      expect(() =>
        serializeTree([{ mode: FileMode.REGULAR_FILE, name: "..", id: sampleId }]),
      ).toThrow("cannot be '..'");
    });
  });

  describe("encodeTreeEntries", () => {
    it("encodes entries as async stream", async () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "test.txt", id: sampleId },
      ];

      const result = await collect(encodeTreeEntries(entries));
      const parsed = parseTreeToArray(result);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("test.txt");
    });

    it("accepts async iterable input", async () => {
      async function* gen(): AsyncIterable<TreeEntry> {
        yield { mode: FileMode.REGULAR_FILE, name: "a.txt", id: sampleId };
        yield { mode: FileMode.REGULAR_FILE, name: "b.txt", id: anotherId };
      }

      const result = await collect(encodeTreeEntries(gen()));
      const parsed = parseTreeToArray(result);

      expect(parsed).toHaveLength(2);
    });

    it("sorts entries", async () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "z.txt", id: sampleId },
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: anotherId },
      ];

      const result = await collect(encodeTreeEntries(entries));
      const parsed = parseTreeToArray(result);

      expect(parsed[0].name).toBe("a.txt");
      expect(parsed[1].name).toBe("z.txt");
    });
  });

  describe("decodeTreeEntries", () => {
    it("decodes tree entries from stream", async () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: sampleId },
        { mode: FileMode.REGULAR_FILE, name: "b.txt", id: anotherId },
      ];

      const encoded = serializeTree(entries);

      async function* stream(): AsyncIterable<Uint8Array> {
        yield encoded;
      }

      const decoded = await toArray(decodeTreeEntries(stream()));

      expect(decoded).toHaveLength(2);
      expect(decoded[0].name).toBe("a.txt");
      expect(decoded[1].name).toBe("b.txt");
    });

    it("handles chunked input", async () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "test.txt", id: sampleId },
      ];

      const encoded = serializeTree(entries);

      // Split into small chunks
      async function* stream(): AsyncIterable<Uint8Array> {
        for (let i = 0; i < encoded.length; i += 5) {
          yield encoded.subarray(i, Math.min(i + 5, encoded.length));
        }
      }

      const decoded = await toArray(decodeTreeEntries(stream()));

      expect(decoded).toHaveLength(1);
      expect(decoded[0].name).toBe("test.txt");
    });
  });

  describe("computeTreeSize", () => {
    it("computes size for empty tree", async () => {
      const size = await computeTreeSize([]);
      expect(size).toBe(0);
    });

    it("computes size for entries", async () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "test.txt", id: sampleId },
      ];

      const size = await computeTreeSize(entries);
      const actual = serializeTree(entries);

      expect(size).toBe(actual.length);
    });

    it("accepts async iterable", async () => {
      async function* gen(): AsyncIterable<TreeEntry> {
        yield { mode: FileMode.REGULAR_FILE, name: "a.txt", id: sampleId };
      }

      const size = await computeTreeSize(gen());
      expect(size).toBeGreaterThan(0);
    });
  });

  describe("parseTree", () => {
    it("parses empty tree", () => {
      const parsed = parseTreeToArray(new Uint8Array(0));
      expect(parsed).toHaveLength(0);
    });

    it("yields entries via generator", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: sampleId },
        { mode: FileMode.REGULAR_FILE, name: "b.txt", id: anotherId },
      ];

      const serialized = serializeTree(entries);
      const collected: TreeEntry[] = [];

      for (const entry of parseTree(serialized)) {
        collected.push(entry);
      }

      expect(collected).toHaveLength(2);
    });

    it("throws on truncated data", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "test.txt", id: sampleId },
      ];
      const serialized = serializeTree(entries);
      const truncated = serialized.subarray(0, serialized.length - 10);

      expect(() => parseTreeToArray(truncated)).toThrow("truncated");
    });
  });

  describe("EMPTY_TREE_ID", () => {
    it("has correct length", () => {
      expect(EMPTY_TREE_ID.length).toBe(40);
    });

    it("matches Git's well-known empty tree", () => {
      expect(EMPTY_TREE_ID).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    });
  });

  describe("roundtrip", () => {
    it("preserves all entry types", () => {
      const original: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "file.txt", id: sampleId },
        { mode: FileMode.EXECUTABLE_FILE, name: "script.sh", id: anotherId },
        { mode: FileMode.SYMLINK, name: "link", id: sampleId },
        { mode: FileMode.TREE, name: "subdir", id: anotherId },
        { mode: FileMode.GITLINK, name: "submodule", id: sampleId },
      ];

      const serialized = serializeTree(original);
      const parsed = parseTreeToArray(serialized);

      expect(parsed.length).toBe(original.length);
    });

    it("handles large trees", () => {
      const entries: TreeEntry[] = [];
      for (let i = 0; i < 1000; i++) {
        entries.push({
          mode: FileMode.REGULAR_FILE,
          name: `file-${i.toString().padStart(4, "0")}.txt`,
          id: i.toString(16).padStart(40, "0"),
        });
      }

      const serialized = serializeTree(entries);
      const parsed = parseTreeToArray(serialized);

      expect(parsed.length).toBe(1000);
    });

    it("roundtrips via streaming APIs", async () => {
      const original: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: sampleId },
        { mode: FileMode.TREE, name: "subdir", id: anotherId },
      ];

      const encoded = await collect(encodeTreeEntries(original));

      async function* stream(): AsyncIterable<Uint8Array> {
        yield encoded;
      }

      const decoded = await toArray(decodeTreeEntries(stream()));

      expect(decoded.map((e) => e.name).sort()).toEqual(original.map((e) => e.name).sort());
    });
  });
});
