/**
 * Tests for CheckoutCommand.
 *
 * Tests checkout operations including:
 * - Full checkout of branches/commits
 * - Path-specific checkout
 * - Conflict detection
 * - Index updates
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type {
  Commit,
  CommitStore,
  MergeStageValue,
  ObjectId,
  ObjectStore,
  Ref,
  RefStore,
  StagingBuilder,
  StagingEditor,
  StagingEntry,
  StagingEntryOptions,
  StagingStore,
  SymbolicRef,
  TreeEntry,
  TreeStore,
} from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";
import { beforeEach, describe, expect, it } from "vitest";
import { CheckoutCommand } from "../src/checkout-command.js";

/**
 * Mock file system.
 */
interface MockFile {
  content: Uint8Array;
  lastModified: number;
}

function createMockFilesApi() {
  const files = new Map<string, MockFile>();
  const directories = new Set<string>();

  return {
    files,
    directories,

    async exists(path: string): Promise<boolean> {
      return files.has(path) || directories.has(path);
    },

    async *list(path: string): AsyncIterable<{ name: string; kind: "file" | "directory" }> {
      const prefix = path === "" ? "" : `${path}/`;
      const seen = new Set<string>();

      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const rest = filePath.substring(prefix.length);
          const slashIdx = rest.indexOf("/");
          const name = slashIdx >= 0 ? rest.substring(0, slashIdx) : rest;
          if (!seen.has(name)) {
            seen.add(name);
            yield { name, kind: slashIdx >= 0 ? "directory" : "file" };
          }
        }
      }
    },

    async readFile(path: string): Promise<Uint8Array> {
      const file = files.get(path);
      if (!file) throw new Error(`File not found: ${path}`);
      return file.content;
    },

    async write(path: string, chunks: Iterable<Uint8Array>): Promise<void> {
      const content = concatChunks(chunks);
      files.set(path, { content, lastModified: Date.now() });
    },

    async mkdir(path: string): Promise<void> {
      directories.add(path);
    },

    async remove(path: string): Promise<boolean> {
      return files.delete(path) || directories.delete(path);
    },

    async stats(path: string): Promise<{ size?: number; lastModified?: number } | null> {
      const file = files.get(path);
      if (file) {
        return { size: file.content.length, lastModified: file.lastModified };
      }
      if (directories.has(path)) {
        return { size: 0, lastModified: Date.now() };
      }
      return null;
    },
  };
}

function concatChunks(chunks: Iterable<Uint8Array>): Uint8Array {
  const arrays = [...chunks];
  if (arrays.length === 0) return new Uint8Array(0);
  if (arrays.length === 1) return arrays[0];

  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

/**
 * Mock object store.
 */
function createMockObjectStore() {
  const objects = new Map<ObjectId, Uint8Array>();

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
      const content = concatChunks(chunks);
      const id = `obj_${objects.size}`;
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
function createMockStagingStore() {
  let entries: StagingEntry[] = [];
  let pendingEntries: StagingEntryOptions[] = [];

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

describe("CheckoutCommand", () => {
  let files: ReturnType<typeof createMockFilesApi>;
  let objects: ReturnType<typeof createMockObjectStore>;
  let trees: ReturnType<typeof createMockTreeStore>;
  let commits: ReturnType<typeof createMockCommitStore>;
  let refs: ReturnType<typeof createMockRefStore>;
  let stagingMock: ReturnType<typeof createMockStagingStore>;
  let checkout: CheckoutCommand;
  const ROOT = "/repo";

  beforeEach(() => {
    files = createMockFilesApi();
    objects = createMockObjectStore();
    trees = createMockTreeStore();
    commits = createMockCommitStore();
    refs = createMockRefStore();
    stagingMock = createMockStagingStore();

    checkout = new CheckoutCommand({
      files: files as FilesApi,
      workTreeRoot: ROOT,
      objects,
      trees,
      commits,
      refs,
      staging: stagingMock.store,
    });
  });

  // Helper to get file path with root
  function fullPath(path: string): string {
    return `${ROOT}/${path}`;
  }

  describe("checkout", () => {
    it("should checkout a branch", async () => {
      // Setup: Create blob, tree, commit, and branch
      const content = new TextEncoder().encode("Hello, World!");
      objects.objects.set("blob1", content);

      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Initial commit",
      });

      refs.refs.set("refs/heads/main", { objectId: "commit1" });
      refs.refs.set("HEAD", { target: "refs/heads/main" });

      // Checkout
      const result = await checkout.checkout("main");

      // Verify
      expect(result.added).toContain("file.txt");
      expect(result.conflicts).toHaveLength(0);
      expect(result.newHead).toBe("commit1");
      expect(result.newBranch).toBe("main");

      // Verify file was written
      const writtenFile = files.files.get(fullPath("file.txt"));
      expect(writtenFile).toBeDefined();
      expect(new TextDecoder().decode(writtenFile?.content)).toBe("Hello, World!");
    });

    it("should checkout a commit by ID", async () => {
      // Setup
      const content = new TextEncoder().encode("Content");
      objects.objects.set("blob1", content);

      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("abc123", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      // Checkout by commit ID
      const result = await checkout.checkout("abc123");

      expect(result.added).toContain("file.txt");
      expect(result.newHead).toBe("abc123");
      expect(result.newBranch).toBeUndefined(); // Detached HEAD
    });

    it("should create a new branch if requested", async () => {
      // Setup
      objects.objects.set("blob1", new TextEncoder().encode("Content"));
      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);
      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });
      refs.refs.set("refs/heads/main", { objectId: "commit1" });

      // Checkout with new branch
      const result = await checkout.checkout("main", { createBranch: "feature" });

      expect(result.newBranch).toBe("feature");
      expect(refs.refs.has("refs/heads/feature")).toBe(true);
      expect(refs.refs.get("refs/heads/feature")?.objectId).toBe("commit1");
    });

    it("should remove files not in target tree", async () => {
      // Setup: Current state has two files
      objects.objects.set("blob1", new TextEncoder().encode("File 1"));
      objects.objects.set("blob2", new TextEncoder().encode("File 2"));

      // Current index has two files
      stagingMock.setEntries([
        {
          path: "file1.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 6,
          mtime: 0,
        },
        {
          path: "file2.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob2",
          stage: 0,
          size: 6,
          mtime: 0,
        },
      ]);

      // Current working tree has both files
      files.files.set(fullPath("file1.txt"), {
        content: new TextEncoder().encode("File 1"),
        lastModified: 0,
      });
      files.files.set(fullPath("file2.txt"), {
        content: new TextEncoder().encode("File 2"),
        lastModified: 0,
      });

      // Target tree only has file1
      trees.trees.set("tree1", [{ name: "file1.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      refs.refs.set("refs/heads/main", { objectId: "commit1" });

      // Checkout
      const result = await checkout.checkout("main", { force: true });

      expect(result.removed).toContain("file2.txt");
      expect(files.files.has(fullPath("file2.txt"))).toBe(false);
    });

    it("should update existing files", async () => {
      // Setup: file exists with old content
      const oldContent = new TextEncoder().encode("Old content");
      const newContent = new TextEncoder().encode("New content");

      objects.objects.set("blob_old", oldContent);
      objects.objects.set("blob_new", newContent);

      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob_old",
          stage: 0,
          size: 11,
          mtime: 0,
        },
      ]);

      files.files.set(fullPath("file.txt"), { content: oldContent, lastModified: 0 });

      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob_new" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      refs.refs.set("refs/heads/main", { objectId: "commit1" });

      // Checkout
      const result = await checkout.checkout("main", { force: true });

      expect(result.updated).toContain("file.txt");
      const writtenFile = files.files.get(fullPath("file.txt"));
      expect(new TextDecoder().decode(writtenFile?.content)).toBe("New content");
    });

    it("should handle nested directories", async () => {
      // Setup: file in nested directory
      const content = new TextEncoder().encode("Nested file");
      objects.objects.set("blob1", content);

      // Nested tree structure
      trees.trees.set("subtree", [
        { name: "nested.txt", mode: FileMode.REGULAR_FILE, id: "blob1" },
      ]);

      trees.trees.set("tree1", [{ name: "src", mode: FileMode.TREE, id: "subtree" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      refs.refs.set("refs/heads/main", { objectId: "commit1" });

      // Checkout
      const result = await checkout.checkout("main");

      expect(result.added).toContain("src/nested.txt");
      expect(files.files.has(fullPath("src/nested.txt"))).toBe(true);
    });
  });

  describe("checkoutPaths", () => {
    it("should checkout specific path from index", async () => {
      // Setup: file in index
      const content = new TextEncoder().encode("Index content");
      objects.objects.set("blob1", content);

      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob1",
          stage: 0,
          size: 13,
          mtime: 0,
        },
      ]);

      // Working tree has different content
      files.files.set(fullPath("file.txt"), {
        content: new TextEncoder().encode("Modified content"),
        lastModified: Date.now(),
      });

      // Checkout path from index
      const result = await checkout.checkoutPaths(["file.txt"]);

      expect(result.updated).toContain("file.txt");
      const writtenFile = files.files.get(fullPath("file.txt"));
      expect(new TextDecoder().decode(writtenFile?.content)).toBe("Index content");
    });

    it("should checkout specific path from HEAD", async () => {
      // Setup
      const content = new TextEncoder().encode("HEAD content");
      objects.objects.set("blob1", content);

      trees.trees.set("tree1", [{ name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob1" }]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      refs.refs.set("HEAD", { objectId: "commit1" });

      // Checkout path from HEAD
      const result = await checkout.checkoutPaths(["file.txt"], { source: "head" });

      expect(result.updated).toContain("file.txt");
    });

    it("should report conflict for missing path", async () => {
      // Empty index
      stagingMock.setEntries([]);

      // Checkout non-existent path
      const result = await checkout.checkoutPaths(["nonexistent.txt"]);

      expect(result.conflicts).toContain("nonexistent.txt");
      expect(result.updated).toHaveLength(0);
    });
  });

  describe("conflict detection", () => {
    it("should detect conflicts when working tree is modified", async () => {
      // Setup: HEAD has file
      const headContent = new TextEncoder().encode("HEAD content");
      const targetContent = new TextEncoder().encode("Target content");

      objects.objects.set("blob_head", headContent);
      objects.objects.set("blob_target", targetContent);

      trees.trees.set("head_tree", [
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob_head" },
      ]);

      trees.trees.set("target_tree", [
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob_target" },
      ]);

      commits.commits.set("head_commit", {
        tree: "head_tree",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "HEAD",
      });

      commits.commits.set("target_commit", {
        tree: "target_tree",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Target",
      });

      refs.refs.set("HEAD", { objectId: "head_commit" });
      refs.refs.set("refs/heads/target", { objectId: "target_commit" });

      // Index matches HEAD
      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob_head",
          stage: 0,
          size: 12,
          mtime: 1000,
        },
      ]);

      // Working tree is modified (different size)
      files.files.set(fullPath("file.txt"), {
        content: new TextEncoder().encode("Modified in working tree"),
        lastModified: Date.now(),
      });

      // Checkout without force
      const result = await checkout.checkout("target");

      expect(result.conflicts).toContain("file.txt");
      expect(result.updated).toHaveLength(0);
      expect(result.added).toHaveLength(0);
    });

    it("should allow force checkout even with conflicts", async () => {
      // Same setup as above
      const headContent = new TextEncoder().encode("HEAD content");
      const targetContent = new TextEncoder().encode("Target content");

      objects.objects.set("blob_head", headContent);
      objects.objects.set("blob_target", targetContent);

      trees.trees.set("head_tree", [
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob_head" },
      ]);

      trees.trees.set("target_tree", [
        { name: "file.txt", mode: FileMode.REGULAR_FILE, id: "blob_target" },
      ]);

      commits.commits.set("head_commit", {
        tree: "head_tree",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "HEAD",
      });

      commits.commits.set("target_commit", {
        tree: "target_tree",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Target",
      });

      refs.refs.set("HEAD", { objectId: "head_commit" });
      refs.refs.set("refs/heads/target", { objectId: "target_commit" });

      stagingMock.setEntries([
        {
          path: "file.txt",
          mode: FileMode.REGULAR_FILE,
          objectId: "blob_head",
          stage: 0,
          size: 12,
          mtime: 1000,
        },
      ]);

      files.files.set(fullPath("file.txt"), {
        content: new TextEncoder().encode("Modified in working tree"),
        lastModified: Date.now(),
      });

      // Force checkout
      const result = await checkout.checkout("target", { force: true });

      expect(result.conflicts).toHaveLength(0);
      expect(result.updated).toContain("file.txt");

      const writtenFile = files.files.get(fullPath("file.txt"));
      expect(new TextDecoder().decode(writtenFile?.content)).toBe("Target content");
    });
  });

  describe("error handling", () => {
    it("should throw error for unresolvable target", async () => {
      await expect(checkout.checkout("nonexistent")).rejects.toThrow(
        "Cannot resolve 'nonexistent' to a commit",
      );
    });
  });

  describe("progress reporting", () => {
    it("should call progress callback", async () => {
      // Setup
      objects.objects.set("blob1", new TextEncoder().encode("File 1"));
      objects.objects.set("blob2", new TextEncoder().encode("File 2"));

      trees.trees.set("tree1", [
        { name: "file1.txt", mode: FileMode.REGULAR_FILE, id: "blob1" },
        { name: "file2.txt", mode: FileMode.REGULAR_FILE, id: "blob2" },
      ]);

      commits.commits.set("commit1", {
        tree: "tree1",
        parents: [],
        author: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        committer: { name: "Test", email: "test@test.com", timestamp: 0, tzOffset: "+0000" },
        message: "Commit",
      });

      refs.refs.set("refs/heads/main", { objectId: "commit1" });

      const progressCalls: { current: number; total: number; path: string }[] = [];

      // Checkout with progress
      await checkout.checkout("main", {
        onProgress: (current, total, path) => {
          progressCalls.push({ current, total, path });
        },
      });

      expect(progressCalls.length).toBe(2);
      expect(progressCalls[0].current).toBe(1);
      expect(progressCalls[0].total).toBe(2);
      expect(progressCalls[1].current).toBe(2);
      expect(progressCalls[1].total).toBe(2);
    });
  });
});
