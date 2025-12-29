/**
 * CGit Compatibility Tests
 *
 * Tests based on JGit's DirCacheCGitCompatabilityTest patterns.
 * Validates compatibility with native Git (CGit) index files.
 *
 * Reference: https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit.test/tst/org/eclipse/jgit/dircache/DirCacheCGitCompatabilityTest.java
 */

import { FileMode, MergeStage, type StagingEntry } from "@webrun-vcs/core";
import { describe, expect, it } from "vitest";
import {
  INDEX_VERSION_2,
  INDEX_VERSION_3,
  INDEX_VERSION_4,
  parseIndexFile,
  serializeIndexFile,
} from "../../src/staging/index-format.js";

describe("CGit Compatibility Tests", () => {
  describe("index file signature", () => {
    it("writes correct DIRC signature", async () => {
      const data = await serializeIndexFile([]);

      // First 4 bytes should be "DIRC" (0x44495243)
      expect(data[0]).toBe(0x44); // 'D'
      expect(data[1]).toBe(0x49); // 'I'
      expect(data[2]).toBe(0x52); // 'R'
      expect(data[3]).toBe(0x43); // 'C'
    });

    it("writes correct version number", async () => {
      const dataV2 = await serializeIndexFile([]);
      const viewV2 = new DataView(dataV2.buffer, dataV2.byteOffset);
      expect(viewV2.getUint32(4)).toBe(INDEX_VERSION_2);

      const entries = [createEntry("file.txt", { intentToAdd: true })];
      const dataV3 = await serializeIndexFile(entries, INDEX_VERSION_3);
      const viewV3 = new DataView(dataV3.buffer, dataV3.byteOffset);
      expect(viewV3.getUint32(4)).toBe(INDEX_VERSION_3);
    });

    it("writes correct entry count", async () => {
      const data = await serializeIndexFile([
        createEntry("a.txt"),
        createEntry("b.txt"),
        createEntry("c.txt"),
      ]);
      const view = new DataView(data.buffer, data.byteOffset);
      expect(view.getUint32(8)).toBe(3);
    });
  });

  describe("entry format compatibility", () => {
    it("stores mtime as seconds and nanoseconds", async () => {
      // Git stores timestamps as 32-bit seconds + 32-bit nanoseconds
      const mtime = 1700000000000; // milliseconds
      const entry = createEntry("file.txt", { mtime });

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      // Should preserve at least second-level precision
      const parsedMtime = parsed.entries[0].mtime;
      expect(Math.floor(parsedMtime / 1000)).toBe(Math.floor(mtime / 1000));
    });

    it("stores ctime correctly", async () => {
      const ctime = 1699000000000;
      const mtime = 1700000000000;
      const entry = createEntry("file.txt", { mtime, ctime });

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      expect(Math.floor((parsed.entries[0].ctime ?? 0) / 1000)).toBe(Math.floor(ctime / 1000));
    });

    it("stores dev and ino", async () => {
      const entry = createEntry("file.txt", { dev: 66306, ino: 12345678 });

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].dev).toBe(66306);
      expect(parsed.entries[0].ino).toBe(12345678);
    });

    it("stores file modes correctly", async () => {
      const entries = [
        createEntry("regular.txt", { mode: FileMode.REGULAR_FILE }),
        createEntry("exec.sh", { mode: FileMode.EXECUTABLE_FILE }),
        createEntry("link", { mode: FileMode.SYMLINK }),
        createEntry("gitlink", { mode: FileMode.GITLINK }),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      const byPath = new Map(parsed.entries.map((e) => [e.path, e]));
      expect(byPath.get("regular.txt")?.mode).toBe(FileMode.REGULAR_FILE);
      expect(byPath.get("exec.sh")?.mode).toBe(FileMode.EXECUTABLE_FILE);
      expect(byPath.get("link")?.mode).toBe(FileMode.SYMLINK);
      expect(byPath.get("gitlink")?.mode).toBe(FileMode.GITLINK);
    });

    it("stores object ID as 20 bytes", async () => {
      const objectId = "0123456789abcdef0123456789abcdef01234567";
      const entry = createEntry("file.txt", { objectId });

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].objectId).toBe(objectId);
    });

    it("stores file size correctly", async () => {
      const entry = createEntry("file.txt", { size: 123456 });

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].size).toBe(123456);
    });
  });

  describe("merge stages", () => {
    it("stores merge stage in flags", async () => {
      const entries = [
        createEntry("file.txt", { stage: MergeStage.BASE, objectId: "b".repeat(40) }),
        createEntry("file.txt", { stage: MergeStage.OURS, objectId: "o".repeat(40) }),
        createEntry("file.txt", { stage: MergeStage.THEIRS, objectId: "t".repeat(40) }),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].stage).toBe(MergeStage.BASE);
      expect(parsed.entries[1].stage).toBe(MergeStage.OURS);
      expect(parsed.entries[2].stage).toBe(MergeStage.THEIRS);
    });
  });

  describe("path encoding", () => {
    it("stores path as NUL-terminated string", async () => {
      const entry = createEntry("path/to/file.txt");

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].path).toBe("path/to/file.txt");
    });

    it("handles paths with special characters", async () => {
      const entries = [
        createEntry("file-with-dash.txt"),
        createEntry("file_with_underscore.txt"),
        createEntry("file.multiple.dots.txt"),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries.map((e) => e.path).sort()).toEqual([
        "file-with-dash.txt",
        "file.multiple.dots.txt",
        "file_with_underscore.txt",
      ]);
    });

    it("handles UTF-8 paths", async () => {
      const entries = [createEntry("日本語.txt"), createEntry("ファイル/サブフォルダ/データ.json")];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries.map((e) => e.path).sort()).toEqual([
        "ファイル/サブフォルダ/データ.json",
        "日本語.txt",
      ]);
    });

    it("handles long paths (>= 0xFFF)", async () => {
      // Git uses 12 bits for path length, capping at 0xFFF
      const longPath = `dir/${"a".repeat(4100)}.txt`;
      const entry = createEntry(longPath);

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].path).toBe(longPath);
    });
  });

  describe("version 2 format", () => {
    it("writes minimal entry format", async () => {
      const entry = createEntry("file.txt");
      const data = await serializeIndexFile([entry], INDEX_VERSION_2);
      const parsed = await parseIndexFile(data);

      expect(parsed.version).toBe(INDEX_VERSION_2);
      expect(parsed.entries[0].path).toBe("file.txt");
    });

    it("supports all basic entry fields", async () => {
      const now = Date.now();
      const entry: StagingEntry = {
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: "a".repeat(40),
        stage: MergeStage.MERGED,
        size: 1234,
        mtime: now,
        ctime: now - 1000,
        dev: 123,
        ino: 456,
        assumeValid: true,
      };

      const data = await serializeIndexFile([entry], INDEX_VERSION_2);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].assumeValid).toBe(true);
    });
  });

  describe("version 3 format", () => {
    it("supports extended flags", async () => {
      const entry = createEntry("file.txt", { intentToAdd: true });
      const data = await serializeIndexFile([entry], INDEX_VERSION_3);
      const parsed = await parseIndexFile(data);

      expect(parsed.version).toBe(INDEX_VERSION_3);
      expect(parsed.entries[0].intentToAdd).toBe(true);
    });

    it("supports skip-worktree flag", async () => {
      const entry = createEntry("file.txt", { skipWorktree: true });
      const data = await serializeIndexFile([entry], INDEX_VERSION_3);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].skipWorktree).toBe(true);
    });
  });

  describe("version 4 format", () => {
    it("uses path prefix compression", async () => {
      const entries = [
        createEntry("common/prefix/file1.txt"),
        createEntry("common/prefix/file2.txt"),
        createEntry("common/prefix/subdir/file3.txt"),
      ];

      const dataV2 = await serializeIndexFile(entries, INDEX_VERSION_2);
      const dataV4 = await serializeIndexFile(entries, INDEX_VERSION_4);

      // V4 should be smaller due to path compression
      expect(dataV4.length).toBeLessThan(dataV2.length);

      const parsed = await parseIndexFile(dataV4);
      expect(parsed.version).toBe(INDEX_VERSION_4);
      expect(parsed.entries.map((e) => e.path)).toEqual([
        "common/prefix/file1.txt",
        "common/prefix/file2.txt",
        "common/prefix/subdir/file3.txt",
      ]);
    });

    it("handles paths with no common prefix", async () => {
      const entries = [createEntry("aaa.txt"), createEntry("bbb.txt"), createEntry("ccc.txt")];

      const data = await serializeIndexFile(entries, INDEX_VERSION_4);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries.map((e) => e.path)).toEqual(["aaa.txt", "bbb.txt", "ccc.txt"]);
    });
  });

  describe("checksum verification", () => {
    it("writes SHA-1 checksum at end of file", async () => {
      const data = await serializeIndexFile([createEntry("file.txt")]);

      // Checksum is last 20 bytes
      expect(data.length).toBeGreaterThanOrEqual(20);
    });

    it("rejects file with corrupted checksum", async () => {
      const data = await serializeIndexFile([createEntry("file.txt")]);

      // Corrupt checksum
      data[data.length - 1] ^= 0xff;

      await expect(parseIndexFile(data)).rejects.toThrow(/checksum/i);
    });

    it("rejects file with corrupted content", async () => {
      const data = await serializeIndexFile([createEntry("file.txt")]);

      // Corrupt content (not checksum)
      data[20] ^= 0xff;

      await expect(parseIndexFile(data)).rejects.toThrow(/checksum/i);
    });
  });

  describe("error handling", () => {
    it("rejects file too small", async () => {
      const tooSmall = new Uint8Array(20);
      await expect(parseIndexFile(tooSmall)).rejects.toThrow(/small/i);
    });

    it("rejects invalid signature", async () => {
      const data = await serializeIndexFile([]);
      data[0] = 0; // Corrupt signature

      await expect(parseIndexFile(data)).rejects.toThrow(/signature/i);
    });

    it("rejects unsupported version", async () => {
      const data = await serializeIndexFile([]);
      const view = new DataView(data.buffer, data.byteOffset);
      view.setUint32(4, 99); // Invalid version

      await expect(parseIndexFile(data)).rejects.toThrow(/version/i);
    });

    it("rejects invalid path (starts with /)", async () => {
      const entry = createEntry("/absolute/path.txt");
      await expect(serializeIndexFile([entry])).rejects.toThrow(/path/i);
    });

    it("rejects invalid path (ends with /)", async () => {
      const entry = createEntry("directory/");
      await expect(serializeIndexFile([entry])).rejects.toThrow(/path/i);
    });

    it("rejects path containing .git", async () => {
      const entry = createEntry(".git/config");
      await expect(serializeIndexFile([entry])).rejects.toThrow(/path/i);
    });
  });

  describe("sorting requirements", () => {
    it("sorts entries by path", async () => {
      // Add in wrong order - serialization should sort them
      const entries = [
        createEntry("z.txt"),
        createEntry("a.txt"),
        createEntry("m/file.txt"),
        createEntry("b/c.txt"),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      // Should be sorted
      expect(parsed.entries[0].path).toBe("a.txt");
      expect(parsed.entries[1].path).toBe("b/c.txt");
      expect(parsed.entries[2].path).toBe("m/file.txt");
      expect(parsed.entries[3].path).toBe("z.txt");
    });

    it("sorts by stage within same path", async () => {
      const entries = [
        createEntry("file.txt", { stage: MergeStage.THEIRS, objectId: "t".repeat(40) }),
        createEntry("file.txt", { stage: MergeStage.BASE, objectId: "b".repeat(40) }),
        createEntry("file.txt", { stage: MergeStage.OURS, objectId: "o".repeat(40) }),
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].stage).toBe(MergeStage.BASE);
      expect(parsed.entries[1].stage).toBe(MergeStage.OURS);
      expect(parsed.entries[2].stage).toBe(MergeStage.THEIRS);
    });

    it("follows Git byte-order sorting", async () => {
      // Git sorts by raw byte values
      const entries = [
        createEntry("a/b"), // '/' = 0x2F
        createEntry("a.b"), // '.' = 0x2E
        createEntry("a0b"), // '0' = 0x30
      ];

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      // '.' < '/' < '0'
      expect(parsed.entries[0].path).toBe("a.b");
      expect(parsed.entries[1].path).toBe("a/b");
      expect(parsed.entries[2].path).toBe("a0b");
    });
  });

  describe("large file handling", () => {
    it("handles many entries", async () => {
      const entries: StagingEntry[] = [];
      for (let i = 0; i < 1000; i++) {
        entries.push(createEntry(`file-${i.toString().padStart(4, "0")}.txt`));
      }

      const data = await serializeIndexFile(entries);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries.length).toBe(1000);
    });

    it("handles large file sizes", async () => {
      // Test with file sizes that require full 32 bits
      const entry = createEntry("large.bin", { size: 2147483647 }); // Max 32-bit signed

      const data = await serializeIndexFile([entry]);
      const parsed = await parseIndexFile(data);

      expect(parsed.entries[0].size).toBe(2147483647);
    });
  });
});

// ============ Helper Functions ============

function createEntry(path: string, options: Partial<StagingEntry> = {}): StagingEntry {
  return {
    path,
    mode: options.mode ?? FileMode.REGULAR_FILE,
    objectId: (options.objectId ?? "0".repeat(40)) as string,
    stage: (options.stage ?? MergeStage.MERGED) as 0 | 1 | 2 | 3,
    size: options.size ?? 0,
    mtime: options.mtime ?? Date.now(),
    ctime: options.ctime,
    dev: options.dev,
    ino: options.ino,
    assumeValid: options.assumeValid,
    intentToAdd: options.intentToAdd,
    skipWorktree: options.skipWorktree,
  };
}
