/**
 * Tests for StagingBuilder and StagingEditor
 *
 * Tests the builder pattern for bulk staging modifications and
 * editor pattern for targeted staging updates.
 * Based on JGit's DirCacheBuilder and DirCacheEditor patterns.
 */

import type { FilesApi, StatsEntry } from "@statewalker/webrun-files";
import type { ObjectId, TreeEntry, TreeStore } from "@webrun-vcs/core";
import {
  DeleteStagingEntry,
  DeleteStagingTree,
  FileMode,
  MergeStage,
  ResolveStagingConflict,
  SetAssumeValid,
  SetIntentToAdd,
  SetSkipWorktree,
  UpdateStagingEntry,
} from "@webrun-vcs/core";
import { beforeEach, describe, expect, it } from "vitest";
import { FileStagingStore } from "../../src/staging/file-staging-store.js";

const sampleObjectId = "0".repeat(40) as ObjectId;
const anotherObjectId = "a".repeat(40) as ObjectId;
const thirdObjectId = "b".repeat(40) as ObjectId;

/**
 * Mock FilesApi for testing staging store
 */
class MockFilesApi implements FilesApi {
  private data: Uint8Array | null = null;
  private lastModified = 0;

  setData(data: Uint8Array): void {
    this.data = data;
    this.lastModified = Date.now();
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

  // Other methods not needed for these tests
  async *list(_path: string): AsyncIterable<string> {}
  async *read(_path: string): AsyncIterable<Uint8Array> {
    if (this.data) yield this.data;
  }
  async delete(_path: string): Promise<void> {}
  async rename(_from: string, _to: string): Promise<void> {}
  async mkdir(_path: string): Promise<void> {}
}

/**
 * Mock TreeStore for testing addTree functionality
 */
class MockTreeStore implements TreeStore {
  private trees = new Map<ObjectId, TreeEntry[]>();

  addTree(id: ObjectId, entries: TreeEntry[]): void {
    this.trees.set(id, entries);
  }

  async *loadTree(treeId: ObjectId): AsyncIterable<TreeEntry> {
    const entries = this.trees.get(treeId);
    if (!entries) {
      throw new Error(`Tree not found: ${treeId}`);
    }
    for (const entry of entries) {
      yield entry;
    }
  }

  async storeTree(entries: TreeEntry[] | AsyncIterable<TreeEntry>): Promise<ObjectId> {
    const entryArray: TreeEntry[] = [];
    if (Array.isArray(entries)) {
      entryArray.push(...entries);
    } else {
      for await (const entry of entries) {
        entryArray.push(entry);
      }
    }
    const id = `tree${this.trees.size.toString().padStart(38, "0")}` as ObjectId;
    this.trees.set(id, entryArray);
    return id;
  }
}

describe("StagingBuilder", () => {
  let files: MockFilesApi;
  let store: FileStagingStore;

  beforeEach(() => {
    files = new MockFilesApi();
    store = new FileStagingStore(files, ".git/index");
  });

  describe("add()", () => {
    it("adds single entry", async () => {
      const builder = store.builder();
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: sampleObjectId,
      });
      await builder.finish();

      const entry = await store.getEntry("file.txt");
      expect(entry).toBeDefined();
      expect(entry?.path).toBe("file.txt");
      expect(entry?.objectId).toBe(sampleObjectId);
      expect(entry?.mode).toBe(FileMode.REGULAR_FILE);
      expect(entry?.stage).toBe(MergeStage.MERGED);
    });

    it("adds multiple entries in sorted order", async () => {
      const builder = store.builder();
      builder.add({ path: "z.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      builder.add({ path: "a.txt", mode: FileMode.REGULAR_FILE, objectId: anotherObjectId });
      builder.add({ path: "m.txt", mode: FileMode.REGULAR_FILE, objectId: thirdObjectId });
      await builder.finish();

      const entries: string[] = [];
      for await (const entry of store.listEntries()) {
        entries.push(entry.path);
      }

      expect(entries).toEqual(["a.txt", "m.txt", "z.txt"]);
    });

    it("adds entries with different modes", async () => {
      const builder = store.builder();
      builder.add({ path: "file.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      builder.add({ path: "script.sh", mode: FileMode.EXECUTABLE_FILE, objectId: sampleObjectId });
      builder.add({ path: "link", mode: FileMode.SYMLINK, objectId: sampleObjectId });
      await builder.finish();

      expect((await store.getEntry("file.txt"))?.mode).toBe(FileMode.REGULAR_FILE);
      expect((await store.getEntry("script.sh"))?.mode).toBe(FileMode.EXECUTABLE_FILE);
      expect((await store.getEntry("link"))?.mode).toBe(FileMode.SYMLINK);
    });

    it("adds entries with conflict stages", async () => {
      const builder = store.builder();
      builder.add({
        path: "conflict.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: sampleObjectId,
        stage: MergeStage.BASE,
      });
      builder.add({
        path: "conflict.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: anotherObjectId,
        stage: MergeStage.OURS,
      });
      builder.add({
        path: "conflict.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: thirdObjectId,
        stage: MergeStage.THEIRS,
      });
      await builder.finish();

      expect(await store.hasConflicts()).toBe(true);
      const entries = await store.getEntries("conflict.txt");
      expect(entries.length).toBe(3);
    });

    it("preserves entry metadata", async () => {
      const now = Date.now();
      const builder = store.builder();
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: sampleObjectId,
        size: 12345,
        mtime: now,
        ctime: now - 1000,
        dev: 100,
        ino: 200,
        assumeValid: true,
        intentToAdd: false,
        skipWorktree: true,
      });
      await builder.finish();

      const entry = await store.getEntry("file.txt");
      expect(entry?.size).toBe(12345);
      expect(entry?.mtime).toBe(now);
      expect(entry?.ctime).toBe(now - 1000);
      expect(entry?.dev).toBe(100);
      expect(entry?.ino).toBe(200);
      expect(entry?.assumeValid).toBe(true);
      expect(entry?.skipWorktree).toBe(true);
    });
  });

  describe("keep()", () => {
    it("keeps entries from existing index", async () => {
      // First, populate the index
      const builder1 = store.builder();
      builder1.add({ path: "a.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      builder1.add({ path: "b.txt", mode: FileMode.REGULAR_FILE, objectId: anotherObjectId });
      builder1.add({ path: "c.txt", mode: FileMode.REGULAR_FILE, objectId: thirdObjectId });
      await builder1.finish();

      // Now use keep() to preserve some entries
      const builder2 = store.builder();
      builder2.keep(0, 2); // Keep first two entries (a.txt, b.txt)
      builder2.add({ path: "d.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      await builder2.finish();

      expect(await store.getEntryCount()).toBe(3);
      expect(await store.hasEntry("a.txt")).toBe(true);
      expect(await store.hasEntry("b.txt")).toBe(true);
      expect(await store.hasEntry("c.txt")).toBe(false);
      expect(await store.hasEntry("d.txt")).toBe(true);
    });

    it("handles empty keep range", async () => {
      const builder1 = store.builder();
      builder1.add({ path: "file.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      await builder1.finish();

      const builder2 = store.builder();
      builder2.keep(0, 0); // Keep nothing
      builder2.add({ path: "new.txt", mode: FileMode.REGULAR_FILE, objectId: anotherObjectId });
      await builder2.finish();

      expect(await store.getEntryCount()).toBe(1);
      expect(await store.hasEntry("file.txt")).toBe(false);
      expect(await store.hasEntry("new.txt")).toBe(true);
    });

    it("handles out of bounds keep range", async () => {
      const builder1 = store.builder();
      builder1.add({ path: "file.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      await builder1.finish();

      const builder2 = store.builder();
      builder2.keep(0, 100); // More than exists
      await builder2.finish();

      expect(await store.getEntryCount()).toBe(1);
      expect(await store.hasEntry("file.txt")).toBe(true);
    });
  });

  describe("addTree()", () => {
    it("adds entries from tree recursively", async () => {
      const treeStore = new MockTreeStore();

      // Create nested tree structure
      const subTreeId = "subtree0000000000000000000000000000000" as ObjectId;
      treeStore.addTree(subTreeId, [
        { name: "nested.txt", mode: FileMode.REGULAR_FILE, id: sampleObjectId },
      ]);

      const rootTreeId = "root0000000000000000000000000000000000" as ObjectId;
      treeStore.addTree(rootTreeId, [
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: sampleObjectId },
        { name: "dir", mode: FileMode.TREE, id: subTreeId },
      ]);

      const builder = store.builder();
      await builder.addTree(treeStore, rootTreeId, "");
      await builder.finish();

      expect(await store.getEntryCount()).toBe(2);
      expect(await store.hasEntry("file.txt")).toBe(true);
      expect(await store.hasEntry("dir/nested.txt")).toBe(true);
    });

    it("adds entries with prefix", async () => {
      const treeStore = new MockTreeStore();

      const treeId = "tree0000000000000000000000000000000000" as ObjectId;
      treeStore.addTree(treeId, [
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: sampleObjectId },
      ]);

      const builder = store.builder();
      await builder.addTree(treeStore, treeId, "src/main");
      await builder.finish();

      expect(await store.hasEntry("src/main/file.txt")).toBe(true);
    });

    it("adds entries with specific merge stage", async () => {
      const treeStore = new MockTreeStore();

      const treeId = "tree0000000000000000000000000000000000" as ObjectId;
      treeStore.addTree(treeId, [
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: sampleObjectId },
      ]);

      const builder = store.builder();
      await builder.addTree(treeStore, treeId, "", MergeStage.OURS);
      await builder.finish();

      const entry = await store.getEntryByStage("file.txt", MergeStage.OURS);
      expect(entry).toBeDefined();
      expect(entry?.stage).toBe(MergeStage.OURS);
    });
  });

  describe("finish() validation", () => {
    it("rejects duplicate entries (same path and stage)", async () => {
      const builder = store.builder();
      builder.add({ path: "file.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      builder.add({ path: "file.txt", mode: FileMode.REGULAR_FILE, objectId: anotherObjectId });

      await expect(builder.finish()).rejects.toThrow("Duplicate entry");
    });

    it("rejects stage 0 mixed with other stages for same path", async () => {
      const builder = store.builder();
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: sampleObjectId,
        stage: MergeStage.MERGED,
      });
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: anotherObjectId,
        stage: MergeStage.OURS,
      });

      await expect(builder.finish()).rejects.toThrow("stage 0 cannot coexist");
    });

    it("allows conflict stages without stage 0", async () => {
      const builder = store.builder();
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: sampleObjectId,
        stage: MergeStage.BASE,
      });
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: anotherObjectId,
        stage: MergeStage.OURS,
      });
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: thirdObjectId,
        stage: MergeStage.THEIRS,
      });

      await expect(builder.finish()).resolves.toBeUndefined();
      expect(await store.hasConflicts()).toBe(true);
    });

    it("replaces entire index on finish", async () => {
      // First, populate with some entries
      const builder1 = store.builder();
      builder1.add({ path: "old.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
      await builder1.finish();

      // Create new builder without keeping old entries
      const builder2 = store.builder();
      builder2.add({ path: "new.txt", mode: FileMode.REGULAR_FILE, objectId: anotherObjectId });
      await builder2.finish();

      expect(await store.getEntryCount()).toBe(1);
      expect(await store.hasEntry("old.txt")).toBe(false);
      expect(await store.hasEntry("new.txt")).toBe(true);
    });
  });
});

describe("StagingEditor", () => {
  let files: MockFilesApi;
  let store: FileStagingStore;

  beforeEach(async () => {
    files = new MockFilesApi();
    store = new FileStagingStore(files, ".git/index");

    // Pre-populate with some entries
    const builder = store.builder();
    builder.add({ path: "a.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
    builder.add({ path: "b.txt", mode: FileMode.REGULAR_FILE, objectId: anotherObjectId });
    builder.add({ path: "c.txt", mode: FileMode.REGULAR_FILE, objectId: thirdObjectId });
    builder.add({ path: "dir/file1.txt", mode: FileMode.REGULAR_FILE, objectId: sampleObjectId });
    builder.add({ path: "dir/file2.txt", mode: FileMode.REGULAR_FILE, objectId: anotherObjectId });
    await builder.finish();
  });

  describe("UpdateStagingEntry", () => {
    it("updates existing entry", async () => {
      const newObjectId = "c".repeat(40) as ObjectId;
      const editor = store.editor();
      editor.add(new UpdateStagingEntry("a.txt", newObjectId, FileMode.REGULAR_FILE));
      await editor.finish();

      const entry = await store.getEntry("a.txt");
      expect(entry?.objectId).toBe(newObjectId);
    });

    it("creates new entry if path doesn't exist", async () => {
      const newObjectId = "c".repeat(40) as ObjectId;
      const editor = store.editor();
      editor.add(new UpdateStagingEntry("new.txt", newObjectId, FileMode.EXECUTABLE_FILE));
      await editor.finish();

      expect(await store.getEntryCount()).toBe(6);
      const entry = await store.getEntry("new.txt");
      expect(entry).toBeDefined();
      expect(entry?.mode).toBe(FileMode.EXECUTABLE_FILE);
    });

    it("preserves unmodified entries", async () => {
      const newObjectId = "c".repeat(40) as ObjectId;
      const editor = store.editor();
      editor.add(new UpdateStagingEntry("a.txt", newObjectId, FileMode.REGULAR_FILE));
      await editor.finish();

      expect(await store.getEntryCount()).toBe(5);
      expect((await store.getEntry("b.txt"))?.objectId).toBe(anotherObjectId);
      expect((await store.getEntry("c.txt"))?.objectId).toBe(thirdObjectId);
    });
  });

  describe("DeleteStagingEntry", () => {
    it("deletes existing entry", async () => {
      const editor = store.editor();
      editor.add(new DeleteStagingEntry("a.txt"));
      await editor.finish();

      expect(await store.getEntryCount()).toBe(4);
      expect(await store.hasEntry("a.txt")).toBe(false);
    });

    it("does nothing for non-existent path", async () => {
      const editor = store.editor();
      editor.add(new DeleteStagingEntry("nonexistent.txt"));
      await editor.finish();

      expect(await store.getEntryCount()).toBe(5);
    });

    it("preserves other entries", async () => {
      const editor = store.editor();
      editor.add(new DeleteStagingEntry("b.txt"));
      await editor.finish();

      expect(await store.hasEntry("a.txt")).toBe(true);
      expect(await store.hasEntry("b.txt")).toBe(false);
      expect(await store.hasEntry("c.txt")).toBe(true);
    });
  });

  describe("DeleteStagingTree", () => {
    it("deletes entire directory tree", async () => {
      const editor = store.editor();
      editor.add(new DeleteStagingTree("dir"));
      await editor.finish();

      expect(await store.getEntryCount()).toBe(3);
      expect(await store.hasEntry("dir/file1.txt")).toBe(false);
      expect(await store.hasEntry("dir/file2.txt")).toBe(false);
      expect(await store.hasEntry("a.txt")).toBe(true);
    });

    it("does nothing for non-existent directory", async () => {
      const editor = store.editor();
      editor.add(new DeleteStagingTree("nonexistent"));
      await editor.finish();

      expect(await store.getEntryCount()).toBe(5);
    });
  });

  describe("SetIntentToAdd", () => {
    it("creates intent-to-add entry", async () => {
      const editor = store.editor();
      editor.add(new SetIntentToAdd("intent.txt", FileMode.REGULAR_FILE));
      await editor.finish();

      const entry = await store.getEntry("intent.txt");
      expect(entry).toBeDefined();
      expect(entry?.intentToAdd).toBe(true);
      expect(entry?.objectId).toBe(SetIntentToAdd.EMPTY_BLOB_ID);
    });
  });

  describe("SetAssumeValid", () => {
    it("sets assume-valid flag", async () => {
      const editor = store.editor();
      editor.add(new SetAssumeValid("a.txt", true));
      await editor.finish();

      const entry = await store.getEntry("a.txt");
      expect(entry?.assumeValid).toBe(true);
    });

    it("clears assume-valid flag", async () => {
      // First set it
      const editor1 = store.editor();
      editor1.add(new SetAssumeValid("a.txt", true));
      await editor1.finish();

      // Then clear it
      const editor2 = store.editor();
      editor2.add(new SetAssumeValid("a.txt", false));
      await editor2.finish();

      const entry = await store.getEntry("a.txt");
      expect(entry?.assumeValid).toBe(false);
    });
  });

  describe("SetSkipWorktree", () => {
    it("sets skip-worktree flag", async () => {
      const editor = store.editor();
      editor.add(new SetSkipWorktree("a.txt", true));
      await editor.finish();

      const entry = await store.getEntry("a.txt");
      expect(entry?.skipWorktree).toBe(true);
    });
  });

  describe("ResolveStagingConflict", () => {
    it("resolves conflict by choosing stage", async () => {
      // First create a conflict
      const builder = store.builder();
      builder.add({
        path: "conflict.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: sampleObjectId,
        stage: MergeStage.BASE,
      });
      builder.add({
        path: "conflict.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: anotherObjectId,
        stage: MergeStage.OURS,
      });
      builder.add({
        path: "conflict.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: thirdObjectId,
        stage: MergeStage.THEIRS,
      });
      await builder.finish();

      expect(await store.hasConflicts()).toBe(true);

      // Resolve by choosing OURS
      const editor = store.editor();
      editor.add(new ResolveStagingConflict("conflict.txt", MergeStage.OURS));
      await editor.finish();

      expect(await store.hasConflicts()).toBe(false);
      const entry = await store.getEntry("conflict.txt");
      expect(entry?.objectId).toBe(anotherObjectId);
      expect(entry?.stage).toBe(MergeStage.MERGED);
    });
  });

  describe("multiple edits", () => {
    it("applies multiple edits in path order", async () => {
      const editor = store.editor();
      editor.add(new DeleteStagingEntry("c.txt"));
      editor.add(new UpdateStagingEntry("a.txt", thirdObjectId, FileMode.EXECUTABLE_FILE));
      editor.add(new SetAssumeValid("b.txt", true));
      await editor.finish();

      expect(await store.getEntryCount()).toBe(4);
      expect((await store.getEntry("a.txt"))?.objectId).toBe(thirdObjectId);
      expect((await store.getEntry("a.txt"))?.mode).toBe(FileMode.EXECUTABLE_FILE);
      expect((await store.getEntry("b.txt"))?.assumeValid).toBe(true);
      expect(await store.hasEntry("c.txt")).toBe(false);
    });

    it("handles interleaved adds and deletes", async () => {
      const editor = store.editor();
      editor.add(new DeleteStagingEntry("b.txt"));
      editor.add(new UpdateStagingEntry("b2.txt", anotherObjectId, FileMode.REGULAR_FILE)); // New entry between b and c
      await editor.finish();

      const entries: string[] = [];
      for await (const entry of store.listEntries()) {
        entries.push(entry.path);
      }

      expect(entries).toContain("a.txt");
      expect(entries).not.toContain("b.txt");
      expect(entries).toContain("b2.txt");
      expect(entries).toContain("c.txt");
    });
  });
});
