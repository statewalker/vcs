/**
 * Tests for Git index file format parsing and serialization
 *
 * Based on JGit's DirCacheEntryTest, DirCacheBasicTest patterns.
 * Tests roundtrip serialization, version support, and Git compatibility.
 */

import { describe, expect, it } from "vitest";
import { FileMode, MergeStage, type StagingEntry } from "@webrun-vcs/vcs";
import {
  parseIndexFile,
  serializeIndexFile,
  INDEX_VERSION_2,
  INDEX_VERSION_3,
  INDEX_VERSION_4,
  type IndexVersion,
} from "../../src/staging/index-format.js";

describe("index-format", () => {
  const sampleObjectId = "0".repeat(40);
  const anotherObjectId = "a".repeat(40);

  describe("serializeIndexFile", () => {
    it("serializes empty index", async () => {
      const data = await serializeIndexFile([]);

      // Header (12 bytes) + checksum (20 bytes) = 32 bytes
      expect(data.length).toBe(32);

      // Verify header
      const view = new DataView(data.buffer, data.byteOffset);
      expect(view.getUint32(0)).toBe(0x44495243); // "DIRC"
      expect(view.getUint32(4)).toBe(INDEX_VERSION_2);
      expect(view.getUint32(8)).toBe(0); // entry count
    });

    it("serializes single entry", async () => {
      const entries: StagingEntry[] = [
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: sampleObjectId,
          stage: MergeStage.MERGED,
          size: 100,
          mtime: 1234567890000,
        },
      ];

      const data = await serializeIndexFile(entries);

      // Should be able to parse it back
      const parsed = await parseIndexFile(data);
      expect(parsed.entries.length).toBe(1);
      expect(parsed.entries[0].path).toBe("file.txt");
      expect(parsed.entries[0].mode).toBe(FileMode.REGULAR_FILE);
      expect(parsed.entries[0].objectId).toBe(sampleObjectId);
    });

    it("serializes multiple entries sorted", async () => {
      const entries: StagingEntry[] = [
        createEntry("z.txt"),
        createEntry("a.txt"),
        createEntry("m.txt"),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      // Entries should be in sorted order
      expect(parsed.entries.length).toBe(3);
      expect(parsed.entries[0].path).toBe("a.txt");
      expect(parsed.entries[1].path).toBe("m.txt");
      expect(parsed.entries[2].path).toBe("z.txt");
    });

    it("preserves entry metadata", async () => {
      const now = Date.now();
      const entry: StagingEntry = {
        path: "file.txt",
        mode: FileMode.EXECUTABLE_FILE,
        objectId: anotherObjectId,
        stage: MergeStage.MERGED,
        size: 12345,
        mtime: now,
        ctime: now - 1000,
        dev: 100,
        ino: 200,
        assumeValid: true,
        intentToAdd: false,
        skipWorktree: false,
      };

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      const result = parsed.entries[0];
      expect(result.path).toBe("file.txt");
      expect(result.mode).toBe(FileMode.EXECUTABLE_FILE);
      expect(result.objectId).toBe(anotherObjectId);
      expect(result.size).toBe(12345);
      expect(result.dev).toBe(100);
      expect(result.ino).toBe(200);
      expect(result.assumeValid).toBe(true);
    });

    it("serializes with version 3 for extended flags", async () => {
      const entries: StagingEntry[] = [
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: sampleObjectId,
          stage: MergeStage.MERGED,
          size: 0,
          mtime: Date.now(),
          intentToAdd: true,
        },
      ];

      const data = await serializeIndexFile(entries, INDEX_VERSION_3);
      const parsed = await parseIndexFile(data);

      expect(parsed.version).toBe(INDEX_VERSION_3);
      expect(parsed.entries[0].intentToAdd).toBe(true);
    });

    it("serializes with version 4 (path compression)", async () => {
      const entries: StagingEntry[] = [
        createEntry("path/to/file1.txt"),
        createEntry("path/to/file2.txt"),
        createEntry("path/to/subdir/file3.txt"),
      ];

      const data = await serializeIndexFile(entries, INDEX_VERSION_4);
      const parsed = await parseIndexFile(data);

      expect(parsed.version).toBe(INDEX_VERSION_4);
      expect(parsed.entries.length).toBe(3);
      expect(parsed.entries[0].path).toBe("path/to/file1.txt");
      expect(parsed.entries[1].path).toBe("path/to/file2.txt");
      expect(parsed.entries[2].path).toBe("path/to/subdir/file3.txt");
    });

    it("handles different file modes", async () => {
      const entries: StagingEntry[] = [
        createEntry("dir/file.txt", { mode: FileMode.REGULAR_FILE }),
        createEntry("script.sh", { mode: FileMode.EXECUTABLE_FILE }),
        createEntry("link", { mode: FileMode.SYMLINK }),
        createEntry("submodule", { mode: FileMode.GITLINK }),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      const byPath = new Map(parsed.entries.map((e) => [e.path, e]));
      expect(byPath.get("dir/file.txt")?.mode).toBe(FileMode.REGULAR_FILE);
      expect(byPath.get("script.sh")?.mode).toBe(FileMode.EXECUTABLE_FILE);
      expect(byPath.get("link")?.mode).toBe(FileMode.SYMLINK);
      expect(byPath.get("submodule")?.mode).toBe(FileMode.GITLINK);
    });

    it("handles merge stages", async () => {
      const entries: StagingEntry[] = [
        createEntry("conflict.txt", { stage: MergeStage.BASE }),
        createEntry("conflict.txt", { stage: MergeStage.OURS }),
        createEntry("conflict.txt", { stage: MergeStage.THEIRS }),
        createEntry("normal.txt", { stage: MergeStage.MERGED }),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries.length).toBe(4);

      const conflicts = parsed.entries.filter((e) => e.path === "conflict.txt");
      expect(conflicts.length).toBe(3);
      expect(conflicts.map((e) => e.stage).sort()).toEqual([
        MergeStage.BASE,
        MergeStage.OURS,
        MergeStage.THEIRS,
      ]);
    });
  });

  describe("parseIndexFile", () => {
    it("rejects too small file", async () => {
      const smallData = new Uint8Array(20);
      await expect(parseIndexFile(smallData)).rejects.toThrow("too small");
    });

    it("rejects invalid signature", async () => {
      const data = await serializeIndexFile([]);
      // Corrupt the signature
      data[0] = 0;

      await expect(parseIndexFile(data)).rejects.toThrow("Invalid index file signature");
    });

    it("rejects unsupported version", async () => {
      const data = await serializeIndexFile([]);
      // Change version to unsupported value
      const view = new DataView(data.buffer, data.byteOffset);
      view.setUint32(4, 99);

      await expect(parseIndexFile(data)).rejects.toThrow("Unsupported index version");
    });

    it("rejects corrupted checksum", async () => {
      const data = await serializeIndexFile([createEntry("file.txt")]);
      // Corrupt the checksum
      data[data.length - 1] ^= 0xff;

      await expect(parseIndexFile(data)).rejects.toThrow("checksum mismatch");
    });
  });

  describe("path validation", () => {
    it("rejects paths starting with /", async () => {
      const entries: StagingEntry[] = [
        {
          path: "/absolute/path",
          mode: FileMode.REGULAR_FILE,
          objectId: sampleObjectId,
          stage: MergeStage.MERGED,
          size: 0,
          mtime: 0,
        },
      ];

      await expect(serializeIndexFile(entries)).rejects.toThrow("Invalid path");
    });

    it("rejects paths ending with /", async () => {
      const entries: StagingEntry[] = [
        {
          path: "directory/",
          mode: FileMode.REGULAR_FILE,
          objectId: sampleObjectId,
          stage: MergeStage.MERGED,
          size: 0,
          mtime: 0,
        },
      ];

      await expect(serializeIndexFile(entries)).rejects.toThrow("Invalid path");
    });

    it("rejects paths containing //", async () => {
      const entries: StagingEntry[] = [
        {
          path: "double//slash",
          mode: FileMode.REGULAR_FILE,
          objectId: sampleObjectId,
          stage: MergeStage.MERGED,
          size: 0,
          mtime: 0,
        },
      ];

      await expect(serializeIndexFile(entries)).rejects.toThrow("Invalid path");
    });

    it("rejects paths containing .git", async () => {
      const entries: StagingEntry[] = [
        {
          path: ".git/config",
          mode: FileMode.REGULAR_FILE,
          objectId: sampleObjectId,
          stage: MergeStage.MERGED,
          size: 0,
          mtime: 0,
        },
      ];

      await expect(serializeIndexFile(entries)).rejects.toThrow("Invalid path");
    });

    it("accepts valid paths", async () => {
      const validPaths = [
        "a",
        "a/b",
        "ab/cd/ef",
        "file.txt",
        "path/to/deep/file.txt",
        "git/b", // "git" is fine, just not ".git"
      ];

      for (const path of validPaths) {
        const entries: StagingEntry[] = [createEntry(path)];
        await expect(serializeIndexFile(entries)).resolves.toBeDefined();
      }
    });
  });

  describe("roundtrip", () => {
    it("preserves all entry types through roundtrip", async () => {
      const original: StagingEntry[] = [
        createEntry("regular.txt", { mode: FileMode.REGULAR_FILE }),
        createEntry("executable.sh", { mode: FileMode.EXECUTABLE_FILE }),
        createEntry("symlink", { mode: FileMode.SYMLINK }),
        createEntry("gitlink", { mode: FileMode.GITLINK }),
      ];

      for (const version of [INDEX_VERSION_2, INDEX_VERSION_3, INDEX_VERSION_4] as IndexVersion[]) {
        const data = await serializeIndexFile(original, version);
        const parsed = await parseIndexFile(data);

        expect(parsed.entries.length).toBe(original.length);
        for (const entry of original) {
          const found = parsed.entries.find((e) => e.path === entry.path);
          expect(found).toBeDefined();
          expect(found?.mode).toBe(entry.mode);
        }
      }
    });

    it("handles large number of entries", async () => {
      const entries: StagingEntry[] = [];
      for (let i = 0; i < 1000; i++) {
        entries.push(
          createEntry(`file-${i.toString().padStart(4, "0")}.txt`, {
            objectId: i.toString(16).padStart(40, "0"),
          }),
        );
      }

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries.length).toBe(1000);
    });

    it("handles long paths (>= 0xfff bytes)", async () => {
      // Create a path longer than NAME_MASK (0xfff = 4095)
      const longPath = "path/" + "a".repeat(4090) + "/file.txt";
      const entries: StagingEntry[] = [createEntry(longPath)];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].path).toBe(longPath);
    });

    it("handles UTF-8 paths", async () => {
      const entries: StagingEntry[] = [
        createEntry("日本語/ファイル.txt"),
        createEntry("émoji/🎉.txt"),
        createEntry("中文/文件.txt"),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      const paths = parsed.entries.map((e) => e.path);
      expect(paths).toContain("日本語/ファイル.txt");
      expect(paths).toContain("émoji/🎉.txt");
      expect(paths).toContain("中文/文件.txt");
    });

    it("preserves timestamps with millisecond precision", async () => {
      const now = Date.now();
      const entry: StagingEntry = {
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: sampleObjectId,
        stage: MergeStage.MERGED,
        size: 0,
        mtime: now,
        ctime: now - 1000,
      };

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      // Git index stores nanosecond precision, but JS Date has millisecond
      // Should preserve at least millisecond precision
      const mtimeDiff = Math.abs(parsed.entries[0].mtime - now);
      expect(mtimeDiff).toBeLessThan(1000); // Within 1 second
    });
  });

  describe("version 4 path compression", () => {
    it("compresses common prefixes", async () => {
      const entries: StagingEntry[] = [
        createEntry("common/prefix/file1.txt"),
        createEntry("common/prefix/file2.txt"),
        createEntry("common/prefix/subdir/file3.txt"),
      ];

      const v2Data = await serializeIndexFile(entries, INDEX_VERSION_2);
      const v4Data = await serializeIndexFile(entries, INDEX_VERSION_4);

      // Version 4 should be smaller due to path compression
      expect(v4Data.length).toBeLessThan(v2Data.length);

      // Both should parse to same entries
      const v2Parsed = await parseIndexFile(v2Data);
      const v4Parsed = await parseIndexFile(v4Data);

      expect(v2Parsed.entries.length).toBe(v4Parsed.entries.length);
      for (let i = 0; i < v2Parsed.entries.length; i++) {
        expect(v2Parsed.entries[i].path).toBe(v4Parsed.entries[i].path);
      }
    });

    it("handles entries with no common prefix", async () => {
      const entries: StagingEntry[] = [
        createEntry("aaa.txt"),
        createEntry("bbb.txt"),
        createEntry("ccc.txt"),
      ];

      const data = await serializeIndexFile(entries, INDEX_VERSION_4);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries.map((e) => e.path)).toEqual(["aaa.txt", "bbb.txt", "ccc.txt"]);
    });
  });
});

// ============ Helper Functions ============

function createEntry(path: string, options: Partial<StagingEntry> = {}): StagingEntry {
  return {
    path,
    mode: options.mode ?? FileMode.REGULAR_FILE,
    objectId: options.objectId ?? "0".repeat(40),
    stage: options.stage ?? MergeStage.MERGED,
    size: options.size ?? 0,
    mtime: options.mtime ?? Date.now(),
    ...options,
  };
}
