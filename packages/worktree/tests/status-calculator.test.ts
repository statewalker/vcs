/**
 * Tests for StatusCalculator.
 *
 * Tests status calculation operations including:
 * - Three-way comparison (HEAD, index, worktree)
 * - File status detection (added, modified, deleted, untracked, ignored)
 * - Conflict detection
 * - Path filtering
 */

import type {
  Commit,
  CommitStore,
  ObjectId,
  Ref,
  RefStore,
  SymbolicRef,
  TreeEntry,
  TreeStore,
} from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";
import { beforeEach, describe, expect, it } from "vitest";
import type {
  MergeStageValue,
  StagingBuilder,
  StagingEditor,
  StagingEntry,
  StagingEntryOptions,
  StagingStore,
} from "../src/interfaces/staging-store.js";
import { FileStatus } from "../src/interfaces/status.js";
import type {
  WorkingTreeEntry,
  WorkingTreeIterator,
  WorkingTreeIteratorOptions,
} from "../src/interfaces/working-tree-iterator.js";
import { createStatusCalculator, StatusCalculatorImpl } from "../src/status-calculator.js";

/**
 * Mock working tree iterator.
 */
function createMockWorktreeIterator() {
  const entries = new Map<string, WorkingTreeEntry>();

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

    async *readContent(_path: string): AsyncIterable<Uint8Array> {
      yield new Uint8Array(0);
    },
  };

  return {
    iterator,
    entries,
    addFile(
      path: string,
      options: { size?: number; mtime?: number; mode?: number; isIgnored?: boolean } = {},
    ) {
      const parts = path.split("/");
      entries.set(path, {
        path,
        name: parts[parts.length - 1],
        mode: options.mode ?? FileMode.REGULAR_FILE,
        size: options.size ?? 100,
        mtime: options.mtime ?? Date.now(),
        isDirectory: false,
        isIgnored: options.isIgnored ?? false,
      });
    },
  };
}

/**
 * Mock tree store.
 */
function createMockTreeStore() {
  const trees = new Map<ObjectId, TreeEntry[]>();

  return {
    trees,

    async storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
      const arr: TreeEntry[] = [];
      if (Symbol.asyncIterator in entries) {
        for await (const entry of entries as AsyncIterable<TreeEntry>) {
          arr.push(entry);
        }
      } else {
        for (const entry of entries as Iterable<TreeEntry>) {
          arr.push(entry);
        }
      }
      arr.sort((a, b) => a.name.localeCompare(b.name));
      const id = `tree_${trees.size}`;
      trees.set(id, arr);
      return id;
    },

    async *loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
      const entries = trees.get(id);
      if (!entries) throw new Error(`Tree not found: ${id}`);
      for (const entry of entries) {
        yield entry;
      }
    },

    async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
      const entries = trees.get(treeId);
      return entries?.find((e) => e.name === name);
    },

    async hasTree(id: ObjectId): Promise<boolean> {
      return trees.has(id);
    },

    getEmptyTreeId(): ObjectId {
      return "empty_tree";
    },
  } satisfies TreeStore;
}

/**
 * Mock commit store.
 */
function createMockCommitStore() {
  const commits = new Map<ObjectId, Commit>();

  return {
    commits,

    async storeCommit(commit: Commit): Promise<ObjectId> {
      const id = `commit_${commits.size}`;
      commits.set(id, commit);
      return id;
    },

    async loadCommit(id: ObjectId): Promise<Commit> {
      const commit = commits.get(id);
      if (!commit) throw new Error(`Commit not found: ${id}`);
      return commit;
    },

    async getParents(id: ObjectId): Promise<ObjectId[]> {
      const commit = commits.get(id);
      return commit?.parents ?? [];
    },

    async getTree(id: ObjectId): Promise<ObjectId> {
      const commit = commits.get(id);
      if (!commit) throw new Error(`Commit not found: ${id}`);
      return commit.tree;
    },

    async *walkAncestry(startIds: ObjectId | ObjectId[]): AsyncIterable<ObjectId> {
      const ids = Array.isArray(startIds) ? startIds : [startIds];
      for (const id of ids) {
        yield id;
      }
    },

    async findMergeBase(_commitA: ObjectId, _commitB: ObjectId): Promise<ObjectId[]> {
      return [];
    },

    async hasCommit(id: ObjectId): Promise<boolean> {
      return commits.has(id);
    },

    async isAncestor(_ancestorId: ObjectId, _descendantId: ObjectId): Promise<boolean> {
      return false;
    },
  } satisfies CommitStore;
}

/**
 * Mock ref store.
 */
function createMockRefStore() {
  const refs = new Map<string, { objectId?: ObjectId; target?: string }>();

  return {
    refs,

    async get(refName: string): Promise<Ref | SymbolicRef | undefined> {
      const ref = refs.get(refName);
      if (!ref) return undefined;
      if (ref.target) {
        return { name: refName, target: ref.target, storage: "primary" as const };
      }
      return {
        name: refName,
        objectId: ref.objectId,
        storage: "primary" as const,
        peeled: false,
      };
    },

    async resolve(refName: string): Promise<Ref | undefined> {
      let current = refName;
      const visited = new Set<string>();

      while (current && !visited.has(current)) {
        visited.add(current);
        const ref = refs.get(current);
        if (!ref) return undefined;

        if (ref.objectId) {
          return {
            name: current,
            objectId: ref.objectId,
            storage: "primary" as const,
            peeled: false,
          };
        }

        if (ref.target) {
          current = ref.target;
        } else {
          return undefined;
        }
      }

      return undefined;
    },

    async has(refName: string): Promise<boolean> {
      return refs.has(refName);
    },

    async *list(prefix?: string): AsyncIterable<Ref | SymbolicRef> {
      for (const [name, ref] of refs) {
        if (!prefix || name.startsWith(prefix)) {
          if (ref.target) {
            yield { name, target: ref.target, storage: "primary" as const };
          } else {
            yield {
              name,
              objectId: ref.objectId,
              storage: "primary" as const,
              peeled: false,
            };
          }
        }
      }
    },

    async set(refName: string, objectId: ObjectId): Promise<void> {
      refs.set(refName, { objectId });
    },

    async setSymbolic(refName: string, target: string): Promise<void> {
      refs.set(refName, { target });
    },

    async delete(refName: string): Promise<boolean> {
      return refs.delete(refName);
    },

    async compareAndSwap(
      _refName: string,
      _expectedOld: ObjectId | undefined,
      _newValue: ObjectId,
    ): Promise<{ success: boolean }> {
      return { success: true };
    },
  } satisfies RefStore;
}

/**
 * Mock staging store.
 */
// Constants for time-based testing
const OLD_TIME = Date.now() - 60000; // 60 seconds ago (safe for racily clean detection)
const INDEX_UPDATE_TIME = Date.now() - 30000; // 30 seconds ago

function createMockStagingStore() {
  let entries: StagingEntry[] = [];
  let pendingEntries: StagingEntryOptions[] = [];
  let updateTime = INDEX_UPDATE_TIME; // Default to 30 seconds ago

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
      pendingEntries = [];
      return {
        add(options: StagingEntryOptions): void {
          pendingEntries.push(options);
        },
        finish(): void {
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
      throw new Error("Not implemented");
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
      return updateTime;
    },
  };

  return {
    store,
    getEntries: () => entries,
    setEntries: (e: StagingEntry[]) => {
      entries = e;
    },
    setUpdateTime: (t: number) => {
      updateTime = t;
    },
  };
}

describe("StatusCalculator", () => {
  let worktreeMock: ReturnType<typeof createMockWorktreeIterator>;
  let trees: ReturnType<typeof createMockTreeStore>;
  let commits: ReturnType<typeof createMockCommitStore>;
  let refs: ReturnType<typeof createMockRefStore>;
  let stagingMock: ReturnType<typeof createMockStagingStore>;
  let calculator: StatusCalculatorImpl;

  beforeEach(() => {
    worktreeMock = createMockWorktreeIterator();
    trees = createMockTreeStore();
    commits = createMockCommitStore();
    refs = createMockRefStore();
    stagingMock = createMockStagingStore();

    // Add empty tree to tree store
    trees.trees.set("empty_tree", []);

    calculator = new StatusCalculatorImpl({
      worktree: worktreeMock.iterator,
      staging: stagingMock.store,
      trees,
      commits,
      refs,
    });
  });

  describe("calculateStatus", () => {
    it("should return clean status for empty repository", async () => {
      const status = await calculator.calculateStatus();

      expect(status.isClean).toBe(true);
      expect(status.files).toHaveLength(0);
      expect(status.hasStaged).toBe(false);
      expect(status.hasUnstaged).toBe(false);
      expect(status.hasUntracked).toBe(false);
      expect(status.hasConflicts).toBe(false);
    });

    it("should detect untracked files", async () => {
      // Add file to worktree only
      worktreeMock.addFile("new-file.txt", { size: 100 });

      const status = await calculator.calculateStatus();

      expect(status.isClean).toBe(false);
      expect(status.hasUntracked).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("new-file.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.UNMODIFIED);
      expect(status.files[0].workTreeStatus).toBe(FileStatus.UNTRACKED);
    });

    it("should detect ignored files when includeIgnored is true", async () => {
      // Add ignored file to worktree
      worktreeMock.addFile("ignored.txt", { size: 100, isIgnored: true });

      const status = await calculator.calculateStatus({ includeIgnored: true });

      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("ignored.txt");
      expect(status.files[0].workTreeStatus).toBe(FileStatus.IGNORED);
    });

    it("should exclude ignored files by default", async () => {
      // Add ignored file to worktree
      worktreeMock.addFile("ignored.txt", { size: 100, isIgnored: true });

      const status = await calculator.calculateStatus();

      expect(status.files).toHaveLength(0);
    });

    it("should detect files added to index", async () => {
      // Setup: file in index but not in HEAD
      stagingMock.setEntries([
        {
          path: "new-file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: OLD_TIME,
        },
      ]);

      // File also in worktree (same size, old mtime to avoid racily-clean detection)
      worktreeMock.addFile("new-file.txt", { size: 100, mtime: OLD_TIME - 1000 });

      const status = await calculator.calculateStatus();

      expect(status.hasStaged).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("new-file.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.ADDED);
      expect(status.files[0].workTreeStatus).toBe(FileStatus.UNMODIFIED);
    });

    it("should detect files deleted from index", async () => {
      // Setup: file in HEAD but not in index
      trees.trees.set("tree1", [{ name: "deleted.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Initial commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      const status = await calculator.calculateStatus();

      expect(status.hasStaged).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("deleted.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.DELETED);
    });

    it("should detect files modified in index", async () => {
      // Setup: file in HEAD with one blob ID
      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Initial commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      // File in index with different blob ID
      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob2",
          stage: 0,
          size: 150,
          mtime: OLD_TIME,
        },
      ]);

      // File in worktree (same as index, old mtime)
      worktreeMock.addFile("file.txt", { size: 150, mtime: OLD_TIME - 1000 });

      const status = await calculator.calculateStatus();

      expect(status.hasStaged).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("file.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.MODIFIED);
      expect(status.files[0].workTreeStatus).toBe(FileStatus.UNMODIFIED);
    });

    it("should detect files deleted from worktree", async () => {
      // Setup: file in index but not in worktree
      // Also needs to be in HEAD to have indexStatus as UNMODIFIED
      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Initial commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: OLD_TIME,
        },
      ]);

      const status = await calculator.calculateStatus();

      expect(status.hasUnstaged).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("file.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.UNMODIFIED);
      expect(status.files[0].workTreeStatus).toBe(FileStatus.DELETED);
    });

    it("should detect files modified in worktree (size change)", async () => {
      // Setup: file in HEAD and index
      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Initial commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: OLD_TIME,
        },
      ]);

      // File in worktree with different size
      worktreeMock.addFile("file.txt", { size: 200, mtime: Date.now() });

      const status = await calculator.calculateStatus();

      expect(status.hasUnstaged).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("file.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.UNMODIFIED);
      expect(status.files[0].workTreeStatus).toBe(FileStatus.MODIFIED);
    });

    it("should detect mode changes in worktree", async () => {
      // Setup: file in index as regular file
      stagingMock.setEntries([
        {
          path: "script.sh",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: Date.now() - 5000,
        },
      ]);

      // File in worktree as executable
      worktreeMock.addFile("script.sh", {
        size: 100,
        mode: FileMode.EXECUTABLE_FILE,
        mtime: Date.now() - 6000,
      });

      const status = await calculator.calculateStatus();

      expect(status.hasUnstaged).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("script.sh");
      expect(status.files[0].workTreeStatus).toBe(FileStatus.MODIFIED);
    });

    it("should detect conflicts", async () => {
      // Setup: conflict entries in staging
      stagingMock.setEntries([
        {
          path: "conflict.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob_base",
          stage: 1,
          size: 100,
          mtime: Date.now(),
        },
        {
          path: "conflict.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob_ours",
          stage: 2,
          size: 100,
          mtime: Date.now(),
        },
        {
          path: "conflict.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob_theirs",
          stage: 3,
          size: 100,
          mtime: Date.now(),
        },
      ]);

      // File in worktree
      worktreeMock.addFile("conflict.txt", { size: 100 });

      const status = await calculator.calculateStatus();

      expect(status.hasConflicts).toBe(true);
      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("conflict.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.CONFLICTED);
    });

    it("should filter by path prefix", async () => {
      // Setup: files in different directories
      worktreeMock.addFile("src/main.ts", { size: 100 });
      worktreeMock.addFile("src/utils.ts", { size: 100 });
      worktreeMock.addFile("test/main.test.ts", { size: 100 });

      const status = await calculator.calculateStatus({ pathPrefix: "src" });

      expect(status.files).toHaveLength(2);
      expect(status.files.every((f) => f.path.startsWith("src"))).toBe(true);
    });

    it("should exclude untracked when includeUntracked is false", async () => {
      worktreeMock.addFile("untracked.txt", { size: 100 });

      const status = await calculator.calculateStatus({ includeUntracked: false });

      expect(status.files).toHaveLength(0);
    });

    it("should report branch name", async () => {
      refs.refs.set("HEAD", { target: "refs/heads/main" });
      refs.refs.set("refs/heads/main", { objectId: "commit1" });

      commits.commits.set("commit1", {
        tree: "empty_tree",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      const status = await calculator.calculateStatus();

      expect(status.branch).toBe("main");
      expect(status.head).toBe("commit1");
    });

    it("should handle detached HEAD", async () => {
      refs.refs.set("HEAD", { objectId: "commit1" });

      commits.commits.set("commit1", {
        tree: "empty_tree",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      const status = await calculator.calculateStatus();

      expect(status.branch).toBeUndefined();
      expect(status.head).toBe("commit1");
    });

    it("should handle nested directory in HEAD tree", async () => {
      // Setup: nested tree structure
      trees.trees.set("subtree", [
        { name: "nested.txt", mode: FileMode.REGULAR_FILE, id: "blob1" },
      ]);

      trees.trees.set("tree1", [{ name: "src", mode: FileMode.TREE, id: "subtree" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Initial commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      // File not in index or worktree (deleted)
      const status = await calculator.calculateStatus();

      expect(status.files).toHaveLength(1);
      expect(status.files[0].path).toBe("src/nested.txt");
      expect(status.files[0].indexStatus).toBe(FileStatus.DELETED);
    });

    it("should sort files by path", async () => {
      worktreeMock.addFile("z-file.txt", { size: 100 });
      worktreeMock.addFile("a-file.txt", { size: 100 });
      worktreeMock.addFile("m-file.txt", { size: 100 });

      const status = await calculator.calculateStatus();

      expect(status.files.map((f) => f.path)).toEqual(["a-file.txt", "m-file.txt", "z-file.txt"]);
    });
  });

  describe("getFileStatus", () => {
    it("should return undefined for unmodified file", async () => {
      // Setup: file in HEAD, index, and worktree with same content
      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: OLD_TIME,
        },
      ]);

      // Use OLD_TIME - 1000 to avoid racily-clean detection
      worktreeMock.addFile("file.txt", { size: 100, mtime: OLD_TIME - 1000 });

      const status = await calculator.getFileStatus("file.txt");

      expect(status).toBeUndefined();
    });

    it("should return status for untracked file", async () => {
      worktreeMock.addFile("new-file.txt", { size: 100 });

      const status = await calculator.getFileStatus("new-file.txt");

      expect(status).toBeDefined();
      expect(status?.path).toBe("new-file.txt");
      expect(status?.workTreeStatus).toBe(FileStatus.UNTRACKED);
    });

    it("should return status for staged file", async () => {
      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: Date.now() - 5000,
        },
      ]);

      worktreeMock.addFile("file.txt", { size: 100, mtime: Date.now() - 6000 });

      const status = await calculator.getFileStatus("file.txt");

      expect(status).toBeDefined();
      expect(status?.indexStatus).toBe(FileStatus.ADDED);
    });

    it("should return undefined for non-existent file", async () => {
      const status = await calculator.getFileStatus("nonexistent.txt");

      expect(status).toBeUndefined();
    });

    it("should handle nested path", async () => {
      trees.trees.set("subtree", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      trees.trees.set("tree1", [{ name: "src", mode: FileMode.TREE, id: "subtree" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      const status = await calculator.getFileStatus("src/file.txt");

      expect(status).toBeDefined();
      expect(status?.path).toBe("src/file.txt");
      expect(status?.indexStatus).toBe(FileStatus.DELETED);
    });
  });

  describe("isModified", () => {
    it("should return false for file matching index", async () => {
      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: OLD_TIME,
        },
      ]);

      // Worktree file with same size and old mtime (older than index update)
      worktreeMock.addFile("file.txt", { size: 100, mtime: OLD_TIME - 1000 });

      const modified = await calculator.isModified("file.txt");

      expect(modified).toBe(false);
    });

    it("should return true for file with different size", async () => {
      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: Date.now() - 5000,
        },
      ]);

      worktreeMock.addFile("file.txt", { size: 200, mtime: Date.now() - 6000 });

      const modified = await calculator.isModified("file.txt");

      expect(modified).toBe(true);
    });

    it("should return true for untracked file", async () => {
      worktreeMock.addFile("new-file.txt", { size: 100 });

      const modified = await calculator.isModified("new-file.txt");

      expect(modified).toBe(true);
    });

    it("should return true for deleted file", async () => {
      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: Date.now(),
        },
      ]);

      // File not in worktree

      const modified = await calculator.isModified("file.txt");

      expect(modified).toBe(true);
    });

    it("should return true for racily clean file", async () => {
      // Setup: file was recently modified (after index update)
      const now = Date.now();
      stagingMock.setUpdateTime(now - 2000); // Index updated 2 seconds ago

      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 100,
          mtime: now - 2000,
        },
      ]);

      // File modified after index (potential race condition)
      worktreeMock.addFile("file.txt", { size: 100, mtime: now });

      const modified = await calculator.isModified("file.txt");

      // Should conservatively return true for racily clean files
      expect(modified).toBe(true);
    });
  });

  describe("createStatusCalculator factory", () => {
    it("should create a StatusCalculator instance", () => {
      const calc = createStatusCalculator({
        worktree: worktreeMock.iterator,
        staging: stagingMock.store,
        trees,
        commits,
        refs,
      });

      expect(calc).toBeDefined();
      expect(typeof calc.calculateStatus).toBe("function");
      expect(typeof calc.getFileStatus).toBe("function");
      expect(typeof calc.isModified).toBe("function");
    });
  });
});
