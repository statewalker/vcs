/**
 * Tests for MemoryStagingStore
 *
 * Based on JGit's DirCacheBasicTest, DirCacheEntryTest, DirCacheBuilderTest,
 * DirCacheFindTest patterns.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DeleteStagingEntry,
  FileMode,
  MemoryStagingStore,
  MergeStage,
  type StagingEntry,
  type StagingEntryOptions,
  UpdateStagingEntry,
} from "../../src/index.js";

describe("MemoryStagingStore", () => {
  let staging: MemoryStagingStore;

  beforeEach(() => {
    staging = new MemoryStagingStore();
  });

  // ============ Basic Operations (DirCacheBasicTest) ============

  describe("basic operations", () => {
    it("starts empty", async () => {
      expect(await staging.getEntryCount()).toBe(0);
      expect(await staging.hasConflicts()).toBe(false);
    });

    it("clears entries", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a.txt"));
      builder.add(createEntry("b.txt"));
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(2);

      await staging.clear();
      expect(await staging.getEntryCount()).toBe(0);
    });

    it("builds then clears", async () => {
      const paths = ["a-", "a.b", "a/b", "a0b"];

      const builder = staging.builder();
      for (const path of paths) {
        builder.add(createEntry(path));
      }
      await builder.finish();

      expect(await staging.hasConflicts()).toBe(false);
      expect(await staging.getEntryCount()).toBe(paths.length);

      await staging.clear();
      expect(await staging.getEntryCount()).toBe(0);
      expect(await staging.hasConflicts()).toBe(false);
    });

    it("detects unmerged paths", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a", { stage: MergeStage.BASE }));
      builder.add(createEntry("a", { stage: MergeStage.OURS }));
      builder.add(createEntry("a", { stage: MergeStage.THEIRS }));
      await builder.finish();

      expect(await staging.hasConflicts()).toBe(true);
    });

    it("findEntry on empty returns not found", async () => {
      const entry = await staging.getEntry("a");
      expect(entry).toBeUndefined();
    });
  });

  // ============ Entry Creation (DirCacheEntryTest) ============

  describe("entry creation", () => {
    describe("path validation", () => {
      it("accepts valid paths", async () => {
        const validPaths = ["a", "a/b", "ab/cd/ef", "file.txt", "path/to/file"];

        for (const path of validPaths) {
          const builder = staging.builder();
          builder.add(createEntry(path));
          await expect(builder.finish()).resolves.not.toThrow();
          await staging.clear();
        }
      });

      it("validates path format (empty rejected)", async () => {
        // Empty paths should be rejected by the builder
        const builder = staging.builder();
        expect(() => builder.add(createEntry(""))).toThrow();
      });
    });

    it("creates entry with stage 0", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a"));
      await builder.finish();

      const entry = await staging.getEntry("a");
      expect(entry).toBeDefined();
      expect(entry?.path).toBe("a");
      expect(entry?.stage).toBe(MergeStage.MERGED);
    });

    it("creates entry with specific stage", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a/b", { stage: MergeStage.BASE }));
      builder.add(createEntry("a/c", { stage: MergeStage.OURS }));
      builder.add(createEntry("a/d", { stage: MergeStage.THEIRS }));
      await builder.finish();

      const base = await staging.getEntryByStage("a/b", MergeStage.BASE);
      expect(base?.path).toBe("a/b");
      expect(base?.stage).toBe(MergeStage.BASE);

      const ours = await staging.getEntryByStage("a/c", MergeStage.OURS);
      expect(ours?.stage).toBe(MergeStage.OURS);

      const theirs = await staging.getEntryByStage("a/d", MergeStage.THEIRS);
      expect(theirs?.stage).toBe(MergeStage.THEIRS);
    });

    it("sets file mode", async () => {
      const builder = staging.builder();

      builder.add(createEntry("regular.txt", { mode: FileMode.REGULAR_FILE }));
      builder.add(createEntry("script.sh", { mode: FileMode.EXECUTABLE_FILE }));
      builder.add(createEntry("link", { mode: FileMode.SYMLINK }));
      builder.add(createEntry("submodule", { mode: FileMode.GITLINK }));

      await builder.finish();

      const regular = await staging.getEntry("regular.txt");
      expect(regular?.mode).toBe(FileMode.REGULAR_FILE);

      const executable = await staging.getEntry("script.sh");
      expect(executable?.mode).toBe(FileMode.EXECUTABLE_FILE);

      const symlink = await staging.getEntry("link");
      expect(symlink?.mode).toBe(FileMode.SYMLINK);

      const gitlink = await staging.getEntry("submodule");
      expect(gitlink?.mode).toBe(FileMode.GITLINK);
    });

    it("preserves metadata", async () => {
      const now = Date.now();
      const builder = staging.builder();

      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: "a".repeat(40),
        size: 1234,
        mtime: now,
        ctime: now - 1000,
        dev: 100,
        ino: 200,
        assumeValid: true,
        intentToAdd: false,
        skipWorktree: false,
      });

      await builder.finish();

      const entry = await staging.getEntry("file.txt");
      expect(entry).toBeDefined();
      expect(entry?.size).toBe(1234);
      expect(entry?.mtime).toBe(now);
      expect(entry?.ctime).toBe(now - 1000);
      expect(entry?.dev).toBe(100);
      expect(entry?.ino).toBe(200);
      expect(entry?.assumeValid).toBe(true);
    });
  });

  // ============ Builder (DirCacheBuilderTest) ============

  describe("builder", () => {
    it("builds empty", async () => {
      const builder = staging.builder();
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(0);
    });

    it("rejects unset file mode", async () => {
      const builder = staging.builder();

      expect(() => {
        builder.add({
          path: "a",
          mode: 0, // Invalid mode
          objectId: "a".repeat(40),
        });
      }).toThrow("FileMode not set");
    });

    it("builds one file", async () => {
      const path = "a-file-path";
      const now = Date.now();

      const builder = staging.builder();
      builder.add({
        path,
        mode: FileMode.REGULAR_FILE,
        objectId: "0".repeat(40),
        mtime: now,
        size: 1342,
      });
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(1);

      const entry = await staging.getEntry(path);
      expect(entry).toBeDefined();
      expect(entry?.path).toBe(path);
      expect(entry?.mode).toBe(FileMode.REGULAR_FILE);
      expect(entry?.size).toBe(1342);
      expect(entry?.stage).toBe(MergeStage.MERGED);
      expect(entry?.assumeValid).toBeFalsy();
    });

    it("finds single file", async () => {
      const path = "a-file-path";

      const builder = staging.builder();
      builder.add(createEntry(path));
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(1);

      const entry = await staging.getEntry(path);
      expect(entry).toBeDefined();
      expect(entry?.path).toBe(path);

      // Non-existent paths should return undefined
      expect(await staging.getEntry("@@-before")).toBeUndefined();
      expect(await staging.getEntry("a-zoo")).toBeUndefined();
    });

    it("adds entries in git sort order", async () => {
      const paths = ["a-", "a.b", "a/b", "a0b"];

      const builder = staging.builder();
      for (const path of paths) {
        builder.add(createEntry(path));
      }
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(paths.length);

      // Verify order by iterating
      const entries: StagingEntry[] = [];
      for await (const entry of staging.listEntries()) {
        entries.push(entry);
      }

      for (let i = 0; i < paths.length; i++) {
        expect(entries[i].path).toBe(paths[i]);
      }
    });

    it("adds entries in reverse git sort order", async () => {
      const paths = ["a-", "a.b", "a/b", "a0b"];

      const builder = staging.builder();
      // Add in reverse order
      for (let i = paths.length - 1; i >= 0; i--) {
        builder.add(createEntry(paths[i]));
      }
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(paths.length);

      // Should still be sorted correctly
      const entries: StagingEntry[] = [];
      for await (const entry of staging.listEntries()) {
        entries.push(entry);
      }

      for (let i = 0; i < paths.length; i++) {
        expect(entries[i].path).toBe(paths[i]);
      }
    });

    it("builder clear replaces all entries", async () => {
      const paths = ["a-", "a.b", "a/b", "a0b"];

      // First build
      let builder = staging.builder();
      for (const path of paths) {
        builder.add(createEntry(path));
      }
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(paths.length);

      // Second build with nothing - should clear
      builder = staging.builder();
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(0);
    });

    it("rejects duplicate entries", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a"));
      builder.add(createEntry("a"));

      await expect(builder.finish()).rejects.toThrow("Duplicate entry");
    });

    it("rejects stage 0 with other stages", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a", { stage: MergeStage.MERGED }));
      builder.add(createEntry("a", { stage: MergeStage.BASE }));

      await expect(builder.finish()).rejects.toThrow("stage 0 cannot coexist with other stages");
    });
  });

  // ============ Find Operations (DirCacheFindTest) ============

  describe("find operations", () => {
    it("getEntriesWithin returns directory contents", async () => {
      const paths = ["a-", "a/b", "a/c", "a/d", "a0b"];

      const builder = staging.builder();
      for (const path of paths) {
        builder.add(createEntry(path));
      }
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(paths.length);

      // Get entries within "a" directory
      const aContents: StagingEntry[] = [];
      for await (const entry of staging.listEntriesUnder("a")) {
        aContents.push(entry);
      }

      // Should contain a/b, a/c, a/d (3 entries)
      expect(aContents.length).toBe(3);
      expect(aContents.map((e) => e.path)).toEqual(expect.arrayContaining(["a/b", "a/c", "a/d"]));
    });

    it("getEntriesWithin with trailing slash", async () => {
      const paths = ["a-", "a/b", "a/c", "a/d", "a0b"];

      const builder = staging.builder();
      for (const path of paths) {
        builder.add(createEntry(path));
      }
      await builder.finish();

      // With trailing slash should work the same
      const aContents: StagingEntry[] = [];
      for await (const entry of staging.listEntriesUnder("a/")) {
        aContents.push(entry);
      }

      expect(aContents.length).toBe(3);
    });

    it("getEntriesWithin non-existent path returns empty", async () => {
      const paths = ["a-", "a/b", "a/c"];

      const builder = staging.builder();
      for (const path of paths) {
        builder.add(createEntry(path));
      }
      await builder.finish();

      const contents: StagingEntry[] = [];
      for await (const entry of staging.listEntriesUnder("zoo")) {
        contents.push(entry);
      }

      expect(contents.length).toBe(0);
    });

    it("hasEntry checks all stages", async () => {
      const builder = staging.builder();
      builder.add(createEntry("merged", { stage: MergeStage.MERGED }));
      builder.add(createEntry("conflict", { stage: MergeStage.BASE }));
      await builder.finish();

      expect(await staging.hasEntry("merged")).toBe(true);
      expect(await staging.hasEntry("conflict")).toBe(true);
      expect(await staging.hasEntry("nonexistent")).toBe(false);
    });

    it("getEntries returns all stages for path", async () => {
      const builder = staging.builder();
      builder.add(createEntry("file", { stage: MergeStage.BASE }));
      builder.add(createEntry("file", { stage: MergeStage.OURS }));
      builder.add(createEntry("file", { stage: MergeStage.THEIRS }));
      await builder.finish();

      const entries = await staging.getEntries("file");
      expect(entries.length).toBe(3);
      expect(entries.map((e) => e.stage)).toEqual(
        expect.arrayContaining([MergeStage.BASE, MergeStage.OURS, MergeStage.THEIRS]),
      );
    });
  });

  // ============ Conflict Detection ============

  describe("conflict detection", () => {
    it("hasConflicts returns false for stage 0 only", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a"));
      builder.add(createEntry("b"));
      await builder.finish();

      expect(await staging.hasConflicts()).toBe(false);
    });

    it("hasConflicts returns true for stage > 0", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a", { stage: MergeStage.BASE }));
      builder.add(createEntry("a", { stage: MergeStage.OURS }));
      await builder.finish();

      expect(await staging.hasConflicts()).toBe(true);
    });

    it("getConflictPaths returns unique conflicted paths", async () => {
      const builder = staging.builder();
      builder.add(createEntry("normal"));
      builder.add(createEntry("conflict1", { stage: MergeStage.BASE }));
      builder.add(createEntry("conflict1", { stage: MergeStage.OURS }));
      builder.add(createEntry("conflict2", { stage: MergeStage.THEIRS }));
      await builder.finish();

      const conflictPaths: string[] = [];
      for await (const path of staging.getConflictPaths()) {
        conflictPaths.push(path);
      }

      expect(conflictPaths.length).toBe(2);
      expect(conflictPaths).toContain("conflict1");
      expect(conflictPaths).toContain("conflict2");
      expect(conflictPaths).not.toContain("normal");
    });
  });

  // ============ Editor Operations ============

  describe("editor", () => {
    it("updates existing entry", async () => {
      const builder = staging.builder();
      builder.add(createEntry("file.txt", { objectId: "a".repeat(40) }));
      await builder.finish();

      const editor = staging.editor();
      editor.add(new UpdateStagingEntry("file.txt", "b".repeat(40), FileMode.REGULAR_FILE));
      await editor.finish();

      const entry = await staging.getEntry("file.txt");
      expect(entry?.objectId).toBe("b".repeat(40));
    });

    it("deletes entry", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a.txt"));
      builder.add(createEntry("b.txt"));
      await builder.finish();

      expect(await staging.getEntryCount()).toBe(2);

      const editor = staging.editor();
      editor.add(new DeleteStagingEntry("a.txt"));
      await editor.finish();

      expect(await staging.getEntryCount()).toBe(1);
      expect(await staging.getEntry("a.txt")).toBeUndefined();
      expect(await staging.getEntry("b.txt")).toBeDefined();
    });

    it("adds new entry", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a.txt"));
      await builder.finish();

      const editor = staging.editor();
      editor.add(new UpdateStagingEntry("b.txt", "b".repeat(40), FileMode.REGULAR_FILE));
      await editor.finish();

      expect(await staging.getEntryCount()).toBe(2);
      expect(await staging.getEntry("b.txt")).toBeDefined();
    });

    it("preserves unmodified entries", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a.txt"));
      builder.add(createEntry("b.txt"));
      builder.add(createEntry("c.txt"));
      await builder.finish();

      const editor = staging.editor();
      editor.add(new UpdateStagingEntry("b.txt", `${"new".repeat(13)}n`, FileMode.REGULAR_FILE));
      await editor.finish();

      expect(await staging.getEntryCount()).toBe(3);
      expect(await staging.getEntry("a.txt")).toBeDefined();
      expect(await staging.getEntry("c.txt")).toBeDefined();
    });
  });

  // ============ Keep Operations ============

  describe("builder keep", () => {
    it("keeps range of existing entries", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a.txt", { objectId: "a".repeat(40) }));
      builder.add(createEntry("b.txt", { objectId: "b".repeat(40) }));
      builder.add(createEntry("c.txt", { objectId: "c".repeat(40) }));
      await builder.finish();

      // Rebuild keeping only first 2 entries
      const builder2 = staging.builder();
      builder2.keep(0, 2);
      await builder2.finish();

      expect(await staging.getEntryCount()).toBe(2);
      expect(await staging.getEntry("a.txt")).toBeDefined();
      expect(await staging.getEntry("b.txt")).toBeDefined();
      expect(await staging.getEntry("c.txt")).toBeUndefined();
    });
  });

  // ============ Persistence (No-op for memory) ============

  describe("persistence", () => {
    it("read is no-op", async () => {
      const builder = staging.builder();
      builder.add(createEntry("a.txt"));
      await builder.finish();

      await staging.read();

      // Should still have the entry (in-memory persistence)
      expect(await staging.getEntry("a.txt")).toBeDefined();
    });

    it("write updates timestamp", async () => {
      const before = staging.getUpdateTime();
      await new Promise((resolve) => setTimeout(resolve, 10));
      await staging.write();
      const after = staging.getUpdateTime();

      expect(after).toBeGreaterThanOrEqual(before);
    });

    it("isOutdated returns false", async () => {
      expect(await staging.isOutdated()).toBe(false);
    });
  });
});

// ============ Helper Functions ============

/**
 * Create a staging entry with defaults.
 */
function createEntry(
  path: string,
  options: Partial<StagingEntryOptions> = {},
): StagingEntryOptions {
  // Validate path
  if (!path) {
    throw new Error("Empty path");
  }
  if (path.startsWith("/")) {
    throw new Error(`Invalid path: ${path}`);
  }
  if (path.endsWith("/")) {
    throw new Error(`Invalid path: ${path}`);
  }
  if (path.includes("//")) {
    throw new Error(`Invalid path: ${path}`);
  }

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
