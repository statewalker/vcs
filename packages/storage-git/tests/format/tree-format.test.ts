/**
 * Tests for Git tree format serialization/parsing
 */

import { describe, expect, it } from "vitest";
import { FileMode } from "@webrun-vcs/storage";
import type { TreeEntry } from "@webrun-vcs/storage";
import {
  compareTreeEntries,
  EMPTY_TREE_ID,
  findTreeEntry,
  parseTree,
  parseTreeToArray,
  serializeTree,
} from "../../src/format/tree-format.js";

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

      // Parse it back
      const parsed = parseTreeToArray(result);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].mode).toBe(FileMode.REGULAR_FILE);
      expect(parsed[0].name).toBe("hello.txt");
      expect(parsed[0].id).toBe(sampleId);
    });

    it("serializes directory entry", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.TREE, name: "subdir", id: sampleId },
      ];

      const result = serializeTree(entries);
      const parsed = parseTreeToArray(result);

      expect(parsed[0].mode).toBe(FileMode.TREE);
      expect(parsed[0].name).toBe("subdir");
    });

    it("serializes executable file", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.EXECUTABLE_FILE, name: "script.sh", id: sampleId },
      ];

      const result = serializeTree(entries);
      const parsed = parseTreeToArray(result);

      expect(parsed[0].mode).toBe(FileMode.EXECUTABLE_FILE);
    });

    it("serializes symlink", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.SYMLINK, name: "link", id: sampleId },
      ];

      const result = serializeTree(entries);
      const parsed = parseTreeToArray(result);

      expect(parsed[0].mode).toBe(FileMode.SYMLINK);
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
      expect(collected[0].name).toBe("a.txt");
      expect(collected[1].name).toBe("b.txt");
    });

    it("throws on truncated data", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "test.txt", id: sampleId },
      ];
      const serialized = serializeTree(entries);

      // Truncate the data
      const truncated = serialized.subarray(0, serialized.length - 10);

      expect(() => parseTreeToArray(truncated)).toThrow("truncated");
    });
  });

  describe("compareTreeEntries", () => {
    it("sorts alphabetically", () => {
      const a: TreeEntry = { mode: FileMode.REGULAR_FILE, name: "a", id: sampleId };
      const b: TreeEntry = { mode: FileMode.REGULAR_FILE, name: "b", id: sampleId };

      expect(compareTreeEntries(a, b)).toBeLessThan(0);
      expect(compareTreeEntries(b, a)).toBeGreaterThan(0);
      expect(compareTreeEntries(a, a)).toBe(0);
    });

    it("handles directories vs files", () => {
      // Directories sort as if they have trailing /
      const file: TreeEntry = { mode: FileMode.REGULAR_FILE, name: "abc", id: sampleId };
      const dir: TreeEntry = { mode: FileMode.TREE, name: "abc", id: sampleId };

      // "abc" vs "abc/" - file should come before dir
      expect(compareTreeEntries(file, dir)).toBeLessThan(0);
      expect(compareTreeEntries(dir, file)).toBeGreaterThan(0);
    });

    it("handles prefix cases", () => {
      const short: TreeEntry = { mode: FileMode.REGULAR_FILE, name: "ab", id: sampleId };
      const long: TreeEntry = { mode: FileMode.REGULAR_FILE, name: "abc", id: sampleId };

      expect(compareTreeEntries(short, long)).toBeLessThan(0);
      expect(compareTreeEntries(long, short)).toBeGreaterThan(0);
    });
  });

  describe("findTreeEntry", () => {
    it("finds existing entry", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: sampleId },
        { mode: FileMode.REGULAR_FILE, name: "b.txt", id: anotherId },
        { mode: FileMode.TREE, name: "c-dir", id: sampleId },
      ];

      const serialized = serializeTree(entries);

      const found = findTreeEntry(serialized, "b.txt");
      expect(found).toBeDefined();
      expect(found?.name).toBe("b.txt");
      expect(found?.id).toBe(anotherId);
    });

    it("returns undefined for missing entry", () => {
      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: sampleId },
      ];

      const serialized = serializeTree(entries);

      const found = findTreeEntry(serialized, "nonexistent.txt");
      expect(found).toBeUndefined();
    });

    it("finds entry in empty tree", () => {
      const found = findTreeEntry(new Uint8Array(0), "any.txt");
      expect(found).toBeUndefined();
    });
  });

  describe("EMPTY_TREE_ID", () => {
    it("has correct length", () => {
      expect(EMPTY_TREE_ID.length).toBe(40);
    });

    it("matches Git's well-known empty tree", () => {
      // This is the SHA-1 of an empty tree
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

      // Entries are sorted, so reorder original for comparison
      const sorted = [...original].sort(compareTreeEntries);

      expect(parsed.length).toBe(sorted.length);
      for (let i = 0; i < parsed.length; i++) {
        expect(parsed[i].mode).toBe(sorted[i].mode);
        expect(parsed[i].name).toBe(sorted[i].name);
        expect(parsed[i].id).toBe(sorted[i].id);
      }
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
  });
});
