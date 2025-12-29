/**
 * DirCache Basic Tests - JGit Compatibility
 *
 * Tests based on JGit's DirCacheBasicTest patterns.
 * Validates core directory cache functionality and invariants.
 *
 * Reference: https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit.test/tst/org/eclipse/jgit/dircache/DirCacheBasicTest.java
 */

import type { FilesApi, StatsEntry } from "@statewalker/webrun-files";
import type { ObjectId, TreeEntry, TreeStore } from "@webrun-vcs/core";
import { FileMode, MergeStage, type StagingEntry } from "@webrun-vcs/core";
import { beforeEach, describe, expect, it } from "vitest";
import { FileStagingStore } from "../../src/staging/file-staging-store.js";

/**
 * Mock FilesApi for testing
 */
class MockFilesApi implements FilesApi {
  private data: Uint8Array | null = null;
  private lastModified = 0;

  setData(data: Uint8Array | null): void {
    this.data = data;
    this.lastModified = Date.now();
  }

  getData(): Uint8Array | null {
    return this.data;
  }

  async write(
    _path: string,
    content: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
  ): Promise<void> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    this.data = result;
    this.lastModified = Date.now();
  }

  async readFile(_path: string): Promise<Uint8Array> {
    if (!this.data) {
      throw new Error("File not found");
    }
    return this.data;
  }

  async stats(_path: string): Promise<StatsEntry | undefined> {
    if (!this.data) return undefined;
    return {
      path: _path,
      type: "file",
      size: this.data.length,
      lastModified: this.lastModified,
    };
  }

  async *list(_path: string): AsyncIterable<string> {}
  async *read(_path: string): AsyncIterable<Uint8Array> {
    if (this.data) yield this.data;
  }
  async delete(_path: string): Promise<void> {
    this.data = null;
  }
  async rename(_from: string, _to: string): Promise<void> {}
  async mkdir(_path: string): Promise<void> {}
}

/**
 * Mock TreeStore for testing tree operations
 */
class MockTreeStore implements TreeStore {
  private trees = new Map<ObjectId, TreeEntry[]>();
  private nextId = 0;

  async *loadTree(treeId: ObjectId): AsyncIterable<TreeEntry> {
    const entries = this.trees.get(treeId);
    if (!entries) {
      throw new Error(`Tree not found: ${treeId}`);
    }
    for (const entry of entries) {
      yield entry;
    }
  }

  async storeTree(entries: TreeEntry[]): Promise<ObjectId> {
    const id = `tree${this.nextId++}`.padEnd(40, "0") as ObjectId;
    this.trees.set(id, [...entries]);
    return id;
  }
}

describe("DirCacheBasicTest - JGit compatibility", () => {
  let files: MockFilesApi;
  let store: FileStagingStore;

  beforeEach(() => {
    files = new MockFilesApi();
    store = new FileStagingStore(files, "index");
  });

  describe("empty cache operations", () => {
    it("testReadMissing_RealIndex", async () => {
      // Reading a nonexistent index should give an empty store
      await store.read();
      expect(await store.getEntryCount()).toBe(0);
      expect(await store.hasConflicts()).toBe(false);
    });

    it("testReadMissing_TempIndex", async () => {
      // Ensure reading an empty/missing index is safe
      const tempStore = new FileStagingStore(files, "temp-index");
      await tempStore.read();
      expect(await tempStore.getEntryCount()).toBe(0);
    });

    it("testEmpty_RealIndex", async () => {
      // Write an empty index
      await store.write();

      // Read it back
      const store2 = new FileStagingStore(files, "index");
      await store2.read();
      expect(await store2.getEntryCount()).toBe(0);
    });

    it("testEmpty_TempIndex", async () => {
      // Write and read empty temp index
      const tempStore = new FileStagingStore(files, "temp-index");
      await tempStore.write();
      await tempStore.read();
      expect(await tempStore.getEntryCount()).toBe(0);
    });
  });

  describe("entry count", () => {
    it("testNoEntries", async () => {
      await store.read();
      expect(await store.getEntryCount()).toBe(0);
    });

    it("testSingleEntry", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt"));
      await builder.finish();

      expect(await store.getEntryCount()).toBe(1);
    });

    it("testMultipleEntries", async () => {
      const builder = store.builder();
      builder.add(createEntry("a/b/c.txt"));
      builder.add(createEntry("d.txt"));
      builder.add(createEntry("e/f.txt"));
      await builder.finish();

      expect(await store.getEntryCount()).toBe(3);
    });

    it("testEntriesWithConflicts", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.BASE }));
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS }));
      builder.add(createEntry("file.txt", { stage: MergeStage.THEIRS }));
      await builder.finish();

      expect(await store.getEntryCount()).toBe(3);
    });
  });

  describe("entry ordering", () => {
    it("testEntriesAreSorted", async () => {
      const builder = store.builder();
      builder.add(createEntry("z.txt"));
      builder.add(createEntry("a.txt"));
      builder.add(createEntry("m/file.txt"));
      builder.add(createEntry("b/c.txt"));
      await builder.finish();

      const entries = await collectEntries(store.listEntries());
      expect(entries[0].path).toBe("a.txt");
      expect(entries[1].path).toBe("b/c.txt");
      expect(entries[2].path).toBe("m/file.txt");
      expect(entries[3].path).toBe("z.txt");
    });

    it("testStageOrderingWithinPath", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.THEIRS }));
      builder.add(createEntry("file.txt", { stage: MergeStage.BASE }));
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS }));
      await builder.finish();

      const entries = await collectEntries(store.listEntries());
      expect(entries[0].stage).toBe(MergeStage.BASE);
      expect(entries[1].stage).toBe(MergeStage.OURS);
      expect(entries[2].stage).toBe(MergeStage.THEIRS);
    });

    it("testPathOrderingByByte", async () => {
      // Git sorts by bytes, not by path components
      const builder = store.builder();
      builder.add(createEntry("a/b"));
      builder.add(createEntry("a.b"));
      builder.add(createEntry("a0b"));
      await builder.finish();

      const entries = await collectEntries(store.listEntries());
      // '.' (0x2E) < '/' (0x2F) < '0' (0x30)
      expect(entries[0].path).toBe("a.b");
      expect(entries[1].path).toBe("a/b");
      expect(entries[2].path).toBe("a0b");
    });
  });

  describe("find entry", () => {
    it("testFindOnEmpty", async () => {
      expect(await store.getEntry("file.txt")).toBeUndefined();
    });

    it("testFindMissing", async () => {
      const builder = store.builder();
      builder.add(createEntry("other.txt"));
      await builder.finish();

      expect(await store.getEntry("file.txt")).toBeUndefined();
    });

    it("testFindExists", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { objectId: "a".repeat(40) }));
      await builder.finish();

      const entry = await store.getEntry("file.txt");
      expect(entry).toBeDefined();
      expect(entry?.path).toBe("file.txt");
      expect(entry?.objectId).toBe("a".repeat(40));
    });

    it("testFindByStage", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.BASE, objectId: "b".repeat(40) }));
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS, objectId: "o".repeat(40) }));
      builder.add(createEntry("file.txt", { stage: MergeStage.THEIRS, objectId: "t".repeat(40) }));
      await builder.finish();

      const base = await store.getEntryByStage("file.txt", MergeStage.BASE);
      expect(base?.objectId).toBe("b".repeat(40));

      const ours = await store.getEntryByStage("file.txt", MergeStage.OURS);
      expect(ours?.objectId).toBe("o".repeat(40));

      const theirs = await store.getEntryByStage("file.txt", MergeStage.THEIRS);
      expect(theirs?.objectId).toBe("t".repeat(40));

      // Stage 0 doesn't exist
      const merged = await store.getEntryByStage("file.txt", MergeStage.MERGED);
      expect(merged).toBeUndefined();
    });

    it("testGetEntries", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.BASE }));
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS }));
      builder.add(createEntry("file.txt", { stage: MergeStage.THEIRS }));
      await builder.finish();

      const entries = await store.getEntries("file.txt");
      expect(entries.length).toBe(3);
    });
  });

  describe("hasEntry", () => {
    it("testHasEntryOnEmpty", async () => {
      expect(await store.hasEntry("file.txt")).toBe(false);
    });

    it("testHasEntryExists", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt"));
      await builder.finish();

      expect(await store.hasEntry("file.txt")).toBe(true);
    });

    it("testHasEntryWithStages", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS }));
      await builder.finish();

      // hasEntry should find entries at any stage
      expect(await store.hasEntry("file.txt")).toBe(true);
    });
  });

  describe("listEntries", () => {
    it("testListOnEmpty", async () => {
      const entries = await collectEntries(store.listEntries());
      expect(entries.length).toBe(0);
    });

    it("testListAll", async () => {
      const builder = store.builder();
      builder.add(createEntry("a.txt"));
      builder.add(createEntry("b.txt"));
      builder.add(createEntry("c/d.txt"));
      await builder.finish();

      const entries = await collectEntries(store.listEntries());
      expect(entries.length).toBe(3);
    });

    it("testListUnderPrefix", async () => {
      const builder = store.builder();
      builder.add(createEntry("src/a.txt"));
      builder.add(createEntry("src/b.txt"));
      builder.add(createEntry("src/sub/c.txt"));
      builder.add(createEntry("test/d.txt"));
      await builder.finish();

      const srcEntries = await collectEntries(store.listEntriesUnder("src"));
      expect(srcEntries.length).toBe(3);
      expect(srcEntries.every((e) => e.path.startsWith("src/"))).toBe(true);
    });

    it("testListUnderNonexistentPrefix", async () => {
      const builder = store.builder();
      builder.add(createEntry("src/a.txt"));
      await builder.finish();

      const entries = await collectEntries(store.listEntriesUnder("other"));
      expect(entries.length).toBe(0);
    });
  });

  describe("conflict detection", () => {
    it("testNoConflictsOnEmpty", async () => {
      expect(await store.hasConflicts()).toBe(false);
    });

    it("testNoConflictsWithStage0", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.MERGED }));
      await builder.finish();

      expect(await store.hasConflicts()).toBe(false);
    });

    it("testConflictsWithNonZeroStage", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS }));
      builder.add(createEntry("file.txt", { stage: MergeStage.THEIRS }));
      await builder.finish();

      expect(await store.hasConflicts()).toBe(true);
    });

    it("testGetConflictPaths", async () => {
      const builder = store.builder();
      builder.add(createEntry("normal.txt", { stage: MergeStage.MERGED }));
      builder.add(createEntry("conflict1.txt", { stage: MergeStage.OURS }));
      builder.add(createEntry("conflict1.txt", { stage: MergeStage.THEIRS }));
      builder.add(createEntry("conflict2.txt", { stage: MergeStage.BASE }));
      builder.add(createEntry("conflict2.txt", { stage: MergeStage.OURS }));
      await builder.finish();

      const conflicts: string[] = [];
      for await (const path of store.getConflictPaths()) {
        conflicts.push(path);
      }

      expect(conflicts.length).toBe(2);
      expect(conflicts).toContain("conflict1.txt");
      expect(conflicts).toContain("conflict2.txt");
    });
  });

  describe("builder operations", () => {
    it("testBuilderReplacesAll", async () => {
      // First build
      const builder1 = store.builder();
      builder1.add(createEntry("old.txt"));
      await builder1.finish();

      // Second build replaces everything
      const builder2 = store.builder();
      builder2.add(createEntry("new.txt"));
      await builder2.finish();

      expect(await store.hasEntry("old.txt")).toBe(false);
      expect(await store.hasEntry("new.txt")).toBe(true);
    });

    it("testBuilderKeep", async () => {
      // Initial build
      const builder1 = store.builder();
      builder1.add(createEntry("a.txt"));
      builder1.add(createEntry("b.txt"));
      builder1.add(createEntry("c.txt"));
      await builder1.finish();

      // Keep first entry, add new one
      const builder2 = store.builder();
      builder2.keep(0, 1);
      builder2.add(createEntry("new.txt"));
      await builder2.finish();

      expect(await store.hasEntry("a.txt")).toBe(true);
      expect(await store.hasEntry("b.txt")).toBe(false);
      expect(await store.hasEntry("c.txt")).toBe(false);
      expect(await store.hasEntry("new.txt")).toBe(true);
    });

    it("testBuilderRejectsDuplicates", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt"));
      builder.add(createEntry("file.txt"));

      await expect(builder.finish()).rejects.toThrow(/[Dd]uplicate/);
    });

    it("testBuilderRejectsStageConflict", async () => {
      const builder = store.builder();
      // Stage 0 cannot coexist with other stages
      builder.add(createEntry("file.txt", { stage: MergeStage.MERGED }));
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS }));

      await expect(builder.finish()).rejects.toThrow();
    });

    it("testAddTree", async () => {
      const treeStore = new MockTreeStore();

      // First create the subtree
      const subtreeId = await treeStore.storeTree([
        { name: "nested.txt", mode: FileMode.REGULAR_FILE, id: "b".repeat(40) as ObjectId },
      ]);

      // Then create the parent tree referencing the subtree
      const treeId = await treeStore.storeTree([
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: "a".repeat(40) as ObjectId },
        { name: "subdir", mode: FileMode.TREE, id: subtreeId },
      ]);

      const builder = store.builder();
      await builder.addTree(treeStore, treeId, "");
      await builder.finish();

      expect(await store.hasEntry("file.txt")).toBe(true);
      expect(await store.hasEntry("subdir/nested.txt")).toBe(true);
    });
  });

  describe("tree operations", () => {
    it("testWriteTree", async () => {
      const treeStore = new MockTreeStore();

      const builder = store.builder();
      builder.add(createEntry("file.txt", { objectId: "a".repeat(40) }));
      builder.add(createEntry("dir/nested.txt", { objectId: "b".repeat(40) }));
      await builder.finish();

      const treeId = await store.writeTree(treeStore);
      expect(treeId).toBeDefined();
    });

    it("testWriteTreeRejectsConflicts", async () => {
      const treeStore = new MockTreeStore();

      const builder = store.builder();
      builder.add(createEntry("file.txt", { stage: MergeStage.OURS }));
      builder.add(createEntry("file.txt", { stage: MergeStage.THEIRS }));
      await builder.finish();

      await expect(store.writeTree(treeStore)).rejects.toThrow(/[Cc]onflict/);
    });

    it("testReadTree", async () => {
      const treeStore = new MockTreeStore();
      const treeId = await treeStore.storeTree([
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: "a".repeat(40) as ObjectId },
      ]);

      await store.readTree(treeStore, treeId);

      expect(await store.hasEntry("file.txt")).toBe(true);
      const entry = await store.getEntry("file.txt");
      expect(entry?.objectId).toBe("a".repeat(40));
    });

    it("testReadTreeClearsExisting", async () => {
      const treeStore = new MockTreeStore();
      const treeId = await treeStore.storeTree([
        { name: "new.txt", mode: FileMode.REGULAR_FILE, id: "a".repeat(40) as ObjectId },
      ]);

      // Add existing entry
      const builder = store.builder();
      builder.add(createEntry("old.txt"));
      await builder.finish();

      // Read tree replaces entries
      await store.readTree(treeStore, treeId);

      expect(await store.hasEntry("old.txt")).toBe(false);
      expect(await store.hasEntry("new.txt")).toBe(true);
    });
  });

  describe("clear", () => {
    it("testClear", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt"));
      await builder.finish();

      await store.clear();

      expect(await store.getEntryCount()).toBe(0);
      expect(await store.hasEntry("file.txt")).toBe(false);
    });
  });

  describe("persistence", () => {
    it("testWriteAndRead", async () => {
      const builder = store.builder();
      builder.add(createEntry("file.txt", { objectId: "abc".padEnd(40, "0") }));
      await builder.finish();
      await store.write();

      // Read into new store
      const store2 = new FileStagingStore(files, "index");
      await store2.read();

      expect(await store2.hasEntry("file.txt")).toBe(true);
      const entry = await store2.getEntry("file.txt");
      expect(entry?.objectId).toBe("abc".padEnd(40, "0"));
    });

    it("testUpdateTimeUpdatesOnWrite", async () => {
      const before = store.getUpdateTime();

      await store.write();

      expect(store.getUpdateTime()).toBeGreaterThanOrEqual(before);
    });

    it("testRoundtripPreservesEntries", async () => {
      const entries = [
        createEntry("a.txt", { mode: FileMode.REGULAR_FILE }),
        createEntry("b.txt", { mode: FileMode.EXECUTABLE_FILE }),
        createEntry("c/d.txt", { mode: FileMode.REGULAR_FILE }),
      ];

      const builder = store.builder();
      for (const entry of entries) {
        builder.add(entry);
      }
      await builder.finish();
      await store.write();

      // Read into new store
      const store2 = new FileStagingStore(files, "index");
      await store2.read();

      expect(await store2.getEntryCount()).toBe(entries.length);
      for (const entry of entries) {
        expect(await store2.hasEntry(entry.path)).toBe(true);
        const loaded = await store2.getEntry(entry.path);
        expect(loaded?.mode).toBe(entry.mode);
      }
    });
  });
});

// ============ Helper Functions ============

function createEntry(path: string, options: Partial<StagingEntry> = {}): StagingEntry {
  return {
    path,
    mode: options.mode ?? FileMode.REGULAR_FILE,
    objectId: (options.objectId ?? "0".repeat(40)) as ObjectId,
    stage: (options.stage ?? MergeStage.MERGED) as 0 | 1 | 2 | 3,
    size: options.size ?? 0,
    mtime: options.mtime ?? Date.now(),
    ...options,
  };
}

async function collectEntries(iterable: AsyncIterable<StagingEntry>): Promise<StagingEntry[]> {
  const entries: StagingEntry[] = [];
  for await (const entry of iterable) {
    entries.push(entry);
  }
  return entries;
}
