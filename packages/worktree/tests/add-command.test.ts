/**
 * Tests for AddCommand.
 *
 * Tests staging files from working tree:
 * - Adding new files
 * - Updating modified files
 * - Removing deleted files (--all mode)
 * - Pattern matching
 * - Ignored files handling
 */

import type {
  MergeStageValue,
  ObjectId,
  ObjectStore,
  StagingBuilder,
  StagingEdit,
  StagingEditor,
  StagingEntry,
  StagingEntryOptions,
  StagingStore,
  TreeStore,
} from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";
import { beforeEach, describe, expect, it } from "vitest";
import { AddCommand, createAddCommand } from "../src/add-command.js";
import type {
  WorkingTreeEntry,
  WorkingTreeIterator,
  WorkingTreeIteratorOptions,
} from "../src/interfaces/working-tree-iterator.js";

/**
 * Mock working tree iterator.
 */
function createMockWorktreeIterator() {
  const entries = new Map<string, WorkingTreeEntry>();
  const contents = new Map<string, Uint8Array>();

  const iterator: WorkingTreeIterator = {
    async *walk(options: WorkingTreeIteratorOptions = {}): AsyncIterable<WorkingTreeEntry> {
      const { includeIgnored = false, pathPrefix = "" } = options;

      const sortedEntries = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));

      for (const entry of sortedEntries) {
        if (pathPrefix && !entry.path.startsWith(pathPrefix)) {
          continue;
        }
        if (!includeIgnored && entry.isIgnored) {
          continue;
        }
        yield entry;
      }
    },

    async getEntry(path: string): Promise<WorkingTreeEntry | undefined> {
      return entries.get(path);
    },

    async computeHash(_path: string): Promise<ObjectId> {
      return "hash_placeholder";
    },

    async *readContent(path: string): AsyncIterable<Uint8Array> {
      const content = contents.get(path);
      if (content) {
        yield content;
      }
    },
  };

  return {
    iterator,
    entries,
    contents,
    addFile(path: string, content: string, options: { mode?: number; isIgnored?: boolean } = {}) {
      const parts = path.split("/");
      const data = new TextEncoder().encode(content);
      entries.set(path, {
        path,
        name: parts[parts.length - 1],
        mode: options.mode ?? FileMode.REGULAR_FILE,
        size: data.length,
        mtime: Date.now(),
        isDirectory: false,
        isIgnored: options.isIgnored ?? false,
      });
      contents.set(path, data);
    },
  };
}

/**
 * Mock object store.
 */
function createMockObjectStore() {
  const objects = new Map<ObjectId, Uint8Array>();
  let idCounter = 0;

  return {
    objects,

    async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
      const chunks: Uint8Array[] = [];
      if (Symbol.asyncIterator in data) {
        for await (const chunk of data as AsyncIterable<Uint8Array>) {
          chunks.push(chunk);
        }
      } else {
        for (const chunk of data as Iterable<Uint8Array>) {
          chunks.push(chunk);
        }
      }

      const totalSize = chunks.reduce((sum, c) => sum + c.length, 0);
      const content = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        content.set(chunk, offset);
        offset += chunk.length;
      }

      const id = `blob_${idCounter++}`;
      objects.set(id, content);
      return id;
    },

    async *load(id: ObjectId): AsyncIterable<Uint8Array> {
      const content = objects.get(id);
      if (!content) throw new Error(`Object not found: ${id}`);
      yield content;
    },

    async has(id: ObjectId): Promise<boolean> {
      return objects.has(id);
    },

    async getSize(id: ObjectId): Promise<number> {
      const content = objects.get(id);
      return content?.length ?? -1;
    },

    async delete(id: ObjectId): Promise<boolean> {
      return objects.delete(id);
    },
  } satisfies ObjectStore;
}

/**
 * Mock staging store.
 */
function createMockStagingStore() {
  let entries: StagingEntry[] = [];
  const pendingEdits: StagingEdit[] = [];

  const store: StagingStore = {
    async getEntry(path: string): Promise<StagingEntry | undefined> {
      return entries.find((e) => e.path === path && e.stage === 0);
    },

    async getEntryByStage(path: string, stage: MergeStageValue): Promise<StagingEntry | undefined> {
      return entries.find((e) => e.path === path && e.stage === stage);
    },

    async getEntries(path: string): Promise<StagingEntry[]> {
      return entries.filter((e) => e.path === path);
    },

    async hasEntry(path: string): Promise<boolean> {
      return entries.some((e) => e.path === path);
    },

    async getEntryCount(): Promise<number> {
      return entries.length;
    },

    async *listEntries(): AsyncIterable<StagingEntry> {
      for (const entry of entries) {
        yield entry;
      }
    },

    async *listEntriesUnder(prefix: string): AsyncIterable<StagingEntry> {
      for (const entry of entries) {
        if (entry.path.startsWith(`${prefix}/`) || entry.path === prefix) {
          yield entry;
        }
      }
    },

    async hasConflicts(): Promise<boolean> {
      return entries.some((e) => e.stage > 0);
    },

    async *getConflictPaths(): AsyncIterable<string> {
      const seen = new Set<string>();
      for (const entry of entries) {
        if (entry.stage > 0 && !seen.has(entry.path)) {
          seen.add(entry.path);
          yield entry.path;
        }
      }
    },

    builder(): StagingBuilder {
      const pendingEntries: StagingEntryOptions[] = [];
      return {
        add(options: StagingEntryOptions): void {
          pendingEntries.push(options);
        },
        keep(_startIndex: number, _count: number): void {
          // Not used in these tests
        },
        async addTree(
          _treeStore: TreeStore,
          _treeId: ObjectId,
          _prefix: string,
          _stage?: MergeStageValue,
        ): Promise<void> {
          // Not used in these tests
        },
        async finish(): Promise<void> {
          entries = pendingEntries.map((opts) => ({
            path: opts.path,
            mode: opts.mode,
            objectId: opts.objectId,
            stage: opts.stage ?? 0,
            size: opts.size ?? 0,
            mtime: opts.mtime ?? Date.now(),
          }));
          entries.sort((a, b) => a.path.localeCompare(b.path) || a.stage - b.stage);
        },
      };
    },

    editor(): StagingEditor {
      pendingEdits.length = 0;
      return {
        add(edit: StagingEdit): void {
          pendingEdits.push(edit);
        },
        async finish(): Promise<void> {
          // Apply edits to entries
          const entriesMap = new Map(entries.map((e) => [e.path, e]));

          for (const edit of pendingEdits) {
            const existing = entriesMap.get(edit.path);
            const result = edit.apply(existing);
            if (result) {
              entriesMap.set(edit.path, result);
            } else {
              entriesMap.delete(edit.path);
            }
          }

          entries = Array.from(entriesMap.values());
          entries.sort((a, b) => a.path.localeCompare(b.path));
        },
      };
    },

    async clear(): Promise<void> {
      entries = [];
    },

    async writeTree(_treeStore: TreeStore): Promise<ObjectId> {
      throw new Error("Not implemented");
    },

    async readTree(_treeStore: TreeStore, _treeId: ObjectId): Promise<void> {
      throw new Error("Not implemented");
    },

    async read(): Promise<void> {},

    async write(): Promise<void> {},

    async isOutdated(): Promise<boolean> {
      return false;
    },

    getUpdateTime(): number {
      return Date.now();
    },
  };

  return {
    store,
    getEntries: () => entries,
    setEntries: (e: StagingEntry[]) => {
      entries = e;
    },
  };
}

describe("AddCommand", () => {
  let worktreeMock: ReturnType<typeof createMockWorktreeIterator>;
  let objects: ReturnType<typeof createMockObjectStore>;
  let stagingMock: ReturnType<typeof createMockStagingStore>;
  let addCommand: AddCommand;

  beforeEach(() => {
    worktreeMock = createMockWorktreeIterator();
    objects = createMockObjectStore();
    stagingMock = createMockStagingStore();

    addCommand = new AddCommand({
      worktree: worktreeMock.iterator,
      objects,
      staging: stagingMock.store,
    });
  });

  describe("add", () => {
    it("should add a new file to staging", async () => {
      worktreeMock.addFile("file.txt", "Hello, World!");

      const result = await addCommand.add(["file.txt"]);

      expect(result.added).toContain("file.txt");
      expect(result.totalProcessed).toBe(1);

      // Check staging entry was created
      const entry = await stagingMock.store.getEntry("file.txt");
      expect(entry).toBeDefined();
      expect(entry?.mode).toBe(FileMode.REGULAR_FILE);
    });

    it("should add multiple files", async () => {
      worktreeMock.addFile("file1.txt", "Content 1");
      worktreeMock.addFile("file2.txt", "Content 2");
      worktreeMock.addFile("file3.txt", "Content 3");

      const result = await addCommand.add(["file1.txt", "file2.txt", "file3.txt"]);

      expect(result.added).toHaveLength(3);
      expect(result.added).toContain("file1.txt");
      expect(result.added).toContain("file2.txt");
      expect(result.added).toContain("file3.txt");
    });

    it("should add files matching glob pattern", async () => {
      worktreeMock.addFile("src/main.ts", "export {}");
      worktreeMock.addFile("src/utils.ts", "export {}");
      worktreeMock.addFile("test/main.test.ts", "test");
      worktreeMock.addFile("README.md", "# README");

      const result = await addCommand.add(["*.ts"]);

      // Should match all .ts files
      expect(result.added).toHaveLength(3);
      expect(result.added).toContain("src/main.ts");
      expect(result.added).toContain("src/utils.ts");
      expect(result.added).toContain("test/main.test.ts");
    });

    it("should add files in directory with prefix match", async () => {
      worktreeMock.addFile("src/main.ts", "export {}");
      worktreeMock.addFile("src/utils.ts", "export {}");
      worktreeMock.addFile("test/main.test.ts", "test");

      const result = await addCommand.add(["src"]);

      expect(result.added).toHaveLength(2);
      expect(result.added).toContain("src/main.ts");
      expect(result.added).toContain("src/utils.ts");
      expect(result.added).not.toContain("test/main.test.ts");
    });

    it("should skip ignored files by default", async () => {
      worktreeMock.addFile("file.txt", "Content");
      worktreeMock.addFile("ignored.txt", "Ignored", { isIgnored: true });

      const result = await addCommand.add(["*.txt"]);

      expect(result.added).toContain("file.txt");
      expect(result.added).not.toContain("ignored.txt");
      expect(result.skipped).toContain("ignored.txt");
    });

    it("should add ignored files when force is true", async () => {
      worktreeMock.addFile("file.txt", "Content");
      worktreeMock.addFile("ignored.txt", "Ignored", { isIgnored: true });

      const result = await addCommand.add(["*.txt"], { force: true });

      expect(result.added).toContain("file.txt");
      expect(result.added).toContain("ignored.txt");
      expect(result.skipped).toHaveLength(0);
    });

    it("should update existing staging entry", async () => {
      // Setup: existing file in staging
      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "old_blob",
          stage: 0,
          size: 5,
          mtime: Date.now() - 5000,
        },
      ]);

      // Add updated content
      worktreeMock.addFile("file.txt", "Updated content");

      const result = await addCommand.add(["file.txt"]);

      expect(result.added).toContain("file.txt");

      // Check staging entry was updated
      const entry = await stagingMock.store.getEntry("file.txt");
      expect(entry).toBeDefined();
      expect(entry?.objectId).not.toBe("old_blob");
    });

    it("should store file content as blob", async () => {
      const content = "Hello, World!";
      worktreeMock.addFile("file.txt", content);

      await addCommand.add(["file.txt"]);

      // Check object was stored
      expect(objects.objects.size).toBe(1);

      // Verify blob format
      const [storedContent] = objects.objects.values();
      const text = new TextDecoder().decode(storedContent);
      expect(text).toContain(`blob ${content.length}\0${content}`);
    });

    it("should preserve executable mode", async () => {
      worktreeMock.addFile("script.sh", "#!/bin/bash", { mode: FileMode.EXECUTABLE_FILE });

      await addCommand.add(["script.sh"]);

      const entry = await stagingMock.store.getEntry("script.sh");
      expect(entry?.mode).toBe(FileMode.EXECUTABLE_FILE);
    });

    it("should call progress callback", async () => {
      worktreeMock.addFile("file1.txt", "Content 1");
      worktreeMock.addFile("file2.txt", "Content 2");

      const progressCalls: Array<{ path: string; current: number; total: number }> = [];

      await addCommand.add(["*.txt"], {
        onProgress: (path, current, total) => {
          progressCalls.push({ path, current, total });
        },
      });

      expect(progressCalls).toHaveLength(2);
      expect(progressCalls[0].current).toBe(1);
      expect(progressCalls[0].total).toBe(2);
      expect(progressCalls[1].current).toBe(2);
      expect(progressCalls[1].total).toBe(2);
    });
  });

  describe("add with update mode", () => {
    it("should only update tracked files", async () => {
      // Setup: one file already in staging
      stagingMock.setEntries([
        {
          path: "tracked.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 7,
          mtime: Date.now() - 5000,
        },
      ]);

      // Working tree has both tracked and untracked files
      worktreeMock.addFile("tracked.txt", "Updated content");
      worktreeMock.addFile("untracked.txt", "New file");

      const result = await addCommand.add(["*.txt"], { update: true });

      expect(result.added).toContain("tracked.txt");
      expect(result.added).not.toContain("untracked.txt");
    });

    it("should remove deleted files from staging when all mode", async () => {
      // Setup: file in staging but deleted from worktree
      stagingMock.setEntries([
        {
          path: "deleted.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 7,
          mtime: Date.now() - 5000,
        },
        {
          path: "existing.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob2",
          stage: 0,
          size: 8,
          mtime: Date.now() - 5000,
        },
      ]);

      // Only existing.txt exists in worktree
      worktreeMock.addFile("existing.txt", "Existing");

      const result = await addCommand.add(["*.txt"], { all: true });

      expect(result.removed).toContain("deleted.txt");
      expect(result.added).toContain("existing.txt");

      // Check deleted file is removed from staging
      const deletedEntry = await stagingMock.store.getEntry("deleted.txt");
      expect(deletedEntry).toBeUndefined();
    });
  });

  describe("addAll", () => {
    it("should add all files", async () => {
      worktreeMock.addFile("file1.txt", "Content 1");
      worktreeMock.addFile("src/file2.ts", "Content 2");
      worktreeMock.addFile("test/file3.test.ts", "Content 3");

      const result = await addCommand.addAll();

      expect(result.added).toHaveLength(3);
      expect(result.added).toContain("file1.txt");
      expect(result.added).toContain("src/file2.ts");
      expect(result.added).toContain("test/file3.test.ts");
    });
  });

  describe("createAddCommand factory", () => {
    it("should create an AddCommand instance", () => {
      const cmd = createAddCommand({
        worktree: worktreeMock.iterator,
        objects,
        staging: stagingMock.store,
      });

      expect(cmd).toBeDefined();
      expect(typeof cmd.add).toBe("function");
      expect(typeof cmd.addAll).toBe("function");
    });
  });
});
