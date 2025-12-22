/**
 * Parametrized tests for FileStagingStore
 *
 * Uses the standard test suite to verify FileStagingStore follows
 * the StagingStore interface contract.
 */

import type { FilesApi, StatsEntry } from "@statewalker/webrun-files";
import type { ObjectId, TreeEntry, TreeStore } from "@webrun-vcs/core";
import { FileMode, MergeStage, type StagingEntry } from "@webrun-vcs/core";
import { createStagingStoreTests } from "@webrun-vcs/testing";
import { describe, expect, it } from "vitest";
import { FileStagingStore } from "../../src/staging/file-staging-store.js";
import { serializeIndexFile } from "../../src/staging/index-format.js";

/**
 * Mock FilesApi for testing
 */
class MockFilesApi implements FilesApi {
  private data: Uint8Array | null = null;
  private lastModified = 0;

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

// Run the parametrized test suite
createStagingStoreTests("FileStagingStore", async () => ({
  stagingStore: new FileStagingStore(new MockFilesApi(), "index"),
  treeStore: new MockTreeStore(),
}));

// Additional tests specific to FileStagingStore
describe("FileStagingStore extras", () => {
  describe("Git index persistence", () => {
    it("persists entries to file on write()", async () => {
      const files = new MockFilesApi();
      const store = new FileStagingStore(files, "index");

      const builder = store.builder();
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: "0".repeat(40),
        stage: MergeStage.MERGED,
        size: 100,
        mtime: Date.now(),
      });
      await builder.finish();
      await store.write();

      // Should be able to read back
      const store2 = new FileStagingStore(files, "index");
      await store2.read();

      expect(await store2.hasEntry("file.txt")).toBe(true);
    });

    it("reads existing index file", async () => {
      const files = new MockFilesApi();

      // Create initial index
      const entries: StagingEntry[] = [
        {
          path: "existing.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "a".repeat(40),
          stage: MergeStage.MERGED,
          size: 50,
          mtime: Date.now(),
        },
      ];
      const data = await serializeIndexFile(entries);
      await files.write("index", [data]);

      // Read into store
      const store = new FileStagingStore(files, "index");
      await store.read();

      expect(await store.hasEntry("existing.txt")).toBe(true);
      const entry = await store.getEntry("existing.txt");
      expect(entry?.objectId).toBe("a".repeat(40));
    });

    it("handles empty index file gracefully", async () => {
      const files = new MockFilesApi();
      const store = new FileStagingStore(files, "index");

      // No file exists - should initialize empty
      await store.read();
      expect(await store.getEntryCount()).toBe(0);
    });

    it("detects outdated index", async () => {
      const files = new MockFilesApi();
      const store = new FileStagingStore(files, "index");

      // Add entry and write
      const builder = store.builder();
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: "0".repeat(40),
        size: 0,
        mtime: 0,
      });
      await builder.finish();
      await store.write();

      // File was just written - not outdated
      expect(await store.isOutdated()).toBe(false);
    });

    it("preserves all entry properties through roundtrip", async () => {
      const files = new MockFilesApi();
      const store = new FileStagingStore(files, "index");
      const now = Date.now();

      const builder = store.builder();
      builder.add({
        path: "full.txt",
        mode: FileMode.EXECUTABLE_FILE,
        objectId: "b".repeat(40),
        stage: MergeStage.MERGED,
        size: 1234,
        mtime: now,
        ctime: now - 1000,
        dev: 42,
        ino: 123456,
        assumeValid: true,
        intentToAdd: false,
        skipWorktree: true,
      });
      await builder.finish();
      await store.write();

      // Read back
      const store2 = new FileStagingStore(files, "index");
      await store2.read();

      const entry = await store2.getEntry("full.txt");
      expect(entry).toBeDefined();
      expect(entry?.mode).toBe(FileMode.EXECUTABLE_FILE);
      expect(entry?.objectId).toBe("b".repeat(40));
      expect(entry?.size).toBe(1234);
      expect(entry?.dev).toBe(42);
      expect(entry?.ino).toBe(123456);
      expect(entry?.assumeValid).toBe(true);
      expect(entry?.skipWorktree).toBe(true);
    });
  });

  describe("version handling", () => {
    it("preserves index version through read/write", async () => {
      const files = new MockFilesApi();
      const store = new FileStagingStore(files, "index");

      // Add entry and write (defaults to version 2)
      const builder = store.builder();
      builder.add({
        path: "file.txt",
        mode: FileMode.REGULAR_FILE,
        objectId: "0".repeat(40),
        size: 0,
        mtime: 0,
      });
      await builder.finish();
      await store.write();

      // Read back
      const store2 = new FileStagingStore(files, "index");
      await store2.read();

      // @ts-expect-error - accessing internal method for testing
      expect(store2._getVersion()).toBe(2);
    });
  });
});
