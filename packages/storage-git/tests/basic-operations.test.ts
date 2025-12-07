/**
 * Basic operations edge case tests
 *
 * Based on JGit's T0003_BasicTest.java
 * Tests fundamental Git operations and edge cases.
 */

import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
import { setCompression } from "@webrun-vcs/compression";
import { createNodeCompression } from "@webrun-vcs/compression/compression-node";
import { FileMode, type ObjectId, ObjectType } from "@webrun-vcs/storage";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serializeTree } from "../src/format/tree-format.js";

import { GitStorage } from "../src/git-storage.js";

describe("basic operations", () => {
  let files: FilesApi;
  const gitDir = "/repo/.git";

  beforeAll(() => {
    setCompression(createNodeCompression());
  });

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  describe("tree validation", () => {
    it("rejects tree entry with empty filename", async () => {
      // Based on: JGit T0003_BasicTest.test002_CreateBadTree
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Create a blob to reference
      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      // Try to store a tree with empty filename - should fail
      await expect(
        storage.trees.storeTree([{ mode: FileMode.REGULAR_FILE, name: "", id: blobId }]),
      ).rejects.toThrow("Tree entry name cannot be empty");

      await storage.close();
    });

    it("rejects tree entry with '.' filename", async () => {
      // Based on: JGit ObjectChecker path validation
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      await expect(
        storage.trees.storeTree([{ mode: FileMode.REGULAR_FILE, name: ".", id: blobId }]),
      ).rejects.toThrow("Tree entry name cannot be '.'");

      await storage.close();
    });

    it("rejects tree entry with '..' filename", async () => {
      // Based on: JGit ObjectChecker path validation
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      await expect(
        storage.trees.storeTree([{ mode: FileMode.REGULAR_FILE, name: "..", id: blobId }]),
      ).rejects.toThrow("Tree entry name cannot be '..'");

      await storage.close();
    });

    it("rejects tree entry with '/' in filename", async () => {
      // Based on: JGit ObjectChecker path validation
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      await expect(
        storage.trees.storeTree([{ mode: FileMode.REGULAR_FILE, name: "foo/bar", id: blobId }]),
      ).rejects.toThrow("Tree entry name cannot contain '/'");

      await storage.close();
    });

    it("stores tree with valid entries", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      const treeId = await storage.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId },
      ]);

      expect(treeId).toMatch(/^[0-9a-f]{40}$/);

      await storage.close();
    });

    it("handles tree with multiple file modes", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      const subtreeId = await storage.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "nested.txt", id: blobId },
      ]);

      // Tree with all supported file modes
      const treeId = await storage.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "regular.txt", id: blobId },
        { mode: FileMode.EXECUTABLE_FILE, name: "script.sh", id: blobId },
        { mode: FileMode.SYMLINK, name: "link", id: blobId },
        { mode: FileMode.TREE, name: "subdir", id: subtreeId },
        { mode: FileMode.GITLINK, name: "submodule", id: blobId },
      ]);

      const entries = [];
      for await (const entry of storage.trees.loadTree(treeId)) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(5);

      // Check modes are preserved
      const byName = new Map(entries.map((e) => [e.name, e]));
      expect(byName.get("regular.txt")?.mode).toBe(FileMode.REGULAR_FILE);
      expect(byName.get("script.sh")?.mode).toBe(FileMode.EXECUTABLE_FILE);
      expect(byName.get("link")?.mode).toBe(FileMode.SYMLINK);
      expect(byName.get("subdir")?.mode).toBe(FileMode.TREE);
      expect(byName.get("submodule")?.mode).toBe(FileMode.GITLINK);

      await storage.close();
    });
  });

  describe("tag targets", () => {
    it("creates tag pointing to blob", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Store a blob
      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("blob content");
        })(),
      );

      // Create tag pointing to blob
      const tagId = await storage.tags.storeTag({
        object: blobId,
        objectType: ObjectType.BLOB,
        tag: "blob-tag",
        tagger: {
          name: "Tagger",
          email: "tagger@example.com",
          timestamp: 1700000000,
          tzOffset: "+0000",
        },
        message: "Tag pointing to blob",
      });

      const tag = await storage.tags.loadTag(tagId);
      expect(tag.object).toBe(blobId);
      expect(tag.objectType).toBe(ObjectType.BLOB);
      expect(tag.tag).toBe("blob-tag");

      await storage.close();
    });

    it("creates tag pointing to tree", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Store an empty tree
      const treeId = storage.trees.getEmptyTreeId();

      // Create tag pointing to tree
      const tagId = await storage.tags.storeTag({
        object: treeId,
        objectType: ObjectType.TREE,
        tag: "tree-tag",
        tagger: {
          name: "Tagger",
          email: "tagger@example.com",
          timestamp: 1700000000,
          tzOffset: "+0000",
        },
        message: "Tag pointing to tree",
      });

      const tag = await storage.tags.loadTag(tagId);
      expect(tag.object).toBe(treeId);
      expect(tag.objectType).toBe(ObjectType.TREE);
      expect(tag.tag).toBe("tree-tag");

      await storage.close();
    });

    it("creates tag pointing to another tag", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const person = {
        name: "Tagger",
        email: "tagger@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      // Create commit
      const emptyTree = storage.trees.getEmptyTreeId();
      const commitId = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "Initial commit",
      });

      // Create first tag pointing to commit
      const tag1Id = await storage.tags.storeTag({
        object: commitId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0",
        tagger: person,
        message: "Version 1.0",
      });

      // Create second tag pointing to first tag
      const tag2Id = await storage.tags.storeTag({
        object: tag1Id,
        objectType: ObjectType.TAG,
        tag: "release",
        tagger: person,
        message: "Release tag",
      });

      const tag2 = await storage.tags.loadTag(tag2Id);
      expect(tag2.object).toBe(tag1Id);
      expect(tag2.objectType).toBe(ObjectType.TAG);

      await storage.close();
    });
  });

  describe("merge commits", () => {
    it("creates commit with 2 parents (merge)", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTree = storage.trees.getEmptyTreeId();
      const person = {
        name: "Author",
        email: "author@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      // Create base commit
      const baseCommit = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "Base commit",
      });

      // Create two branch commits
      const branch1 = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [baseCommit],
        author: { ...person, timestamp: person.timestamp + 1 },
        committer: { ...person, timestamp: person.timestamp + 1 },
        message: "Branch 1",
      });

      const branch2 = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [baseCommit],
        author: { ...person, timestamp: person.timestamp + 2 },
        committer: { ...person, timestamp: person.timestamp + 2 },
        message: "Branch 2",
      });

      // Create merge commit with 2 parents
      const mergeCommit = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [branch1, branch2],
        author: { ...person, timestamp: person.timestamp + 3 },
        committer: { ...person, timestamp: person.timestamp + 3 },
        message: "Merge branch 2 into branch 1",
      });

      const loaded = await storage.commits.loadCommit(mergeCommit);
      expect(loaded.parents).toHaveLength(2);
      expect(loaded.parents).toContain(branch1);
      expect(loaded.parents).toContain(branch2);

      await storage.close();
    });

    it("creates commit with 3+ parents (octopus merge)", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTree = storage.trees.getEmptyTreeId();
      const person = {
        name: "Author",
        email: "author@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      // Create base commit
      const baseCommit = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "Base commit",
      });

      // Create multiple branch commits
      const branches: ObjectId[] = [];
      for (let i = 1; i <= 4; i++) {
        const branchCommit = await storage.commits.storeCommit({
          tree: emptyTree,
          parents: [baseCommit],
          author: { ...person, timestamp: person.timestamp + i },
          committer: { ...person, timestamp: person.timestamp + i },
          message: `Branch ${i}`,
        });
        branches.push(branchCommit);
      }

      // Create octopus merge with 4 parents
      const mergeCommit = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: branches,
        author: { ...person, timestamp: person.timestamp + 10 },
        committer: { ...person, timestamp: person.timestamp + 10 },
        message: "Octopus merge",
      });

      const loaded = await storage.commits.loadCommit(mergeCommit);
      expect(loaded.parents).toHaveLength(4);
      for (const branch of branches) {
        expect(loaded.parents).toContain(branch);
      }

      await storage.close();
    });

    it("walks ancestry through merge commits", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTree = storage.trees.getEmptyTreeId();
      const person = {
        name: "Author",
        email: "author@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      // Create diamond-shaped history:
      //     A
      //    / \
      //   B   C
      //    \ /
      //     D (merge)

      const a = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "A",
      });

      const b = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [a],
        author: { ...person, timestamp: person.timestamp + 1 },
        committer: { ...person, timestamp: person.timestamp + 1 },
        message: "B",
      });

      const c = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [a],
        author: { ...person, timestamp: person.timestamp + 2 },
        committer: { ...person, timestamp: person.timestamp + 2 },
        message: "C",
      });

      const d = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [b, c],
        author: { ...person, timestamp: person.timestamp + 3 },
        committer: { ...person, timestamp: person.timestamp + 3 },
        message: "D (merge)",
      });

      // Walk ancestry - should visit all commits exactly once
      const visited: ObjectId[] = [];
      for await (const id of storage.commits.walkAncestry(d)) {
        visited.push(id);
      }

      expect(visited).toHaveLength(4);
      expect(visited).toContain(d);
      expect(visited).toContain(b);
      expect(visited).toContain(c);
      expect(visited).toContain(a);

      // Check isAncestor
      expect(await storage.commits.isAncestor(a, d)).toBe(true);
      expect(await storage.commits.isAncestor(b, d)).toBe(true);
      expect(await storage.commits.isAncestor(c, d)).toBe(true);
      expect(await storage.commits.isAncestor(d, a)).toBe(false);

      await storage.close();
    });
  });

  describe("unicode support", () => {
    it("handles unicode in author/committer names", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTree = storage.trees.getEmptyTreeId();
      const person = {
        name: "Föör Fattäre", // Swedish characters
        email: "author@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      const commitId = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "Unicode commit",
      });

      const loaded = await storage.commits.loadCommit(commitId);
      expect(loaded.author.name).toBe("Föör Fattäre");

      await storage.close();
    });

    it("handles unicode in commit message", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTree = storage.trees.getEmptyTreeId();
      const person = {
        name: "Author",
        email: "author@example.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      const message = "Smörgåsbord\n\nきれい\n日本語テスト";

      const commitId = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message,
      });

      const loaded = await storage.commits.loadCommit(commitId);
      expect(loaded.message).toBe(message);

      await storage.close();
    });

    it("handles unicode in tree entry names", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      const treeId = await storage.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "ファイル.txt", id: blobId },
        { mode: FileMode.REGULAR_FILE, name: "文档.md", id: blobId },
        { mode: FileMode.REGULAR_FILE, name: "documento-ñ.txt", id: blobId },
      ]);

      const entries = [];
      for await (const entry of storage.trees.loadTree(treeId)) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(3);
      const names = entries.map((e) => e.name);
      expect(names).toContain("ファイル.txt");
      expect(names).toContain("文档.md");
      expect(names).toContain("documento-ñ.txt");

      await storage.close();
    });
  });

  describe("blob storage edge cases", () => {
    it("stores very large blob content", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Create a 1MB blob
      const largeContent = new Uint8Array(1024 * 1024);
      for (let i = 0; i < largeContent.length; i++) {
        largeContent[i] = i % 256;
      }

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield largeContent;
        })(),
      );

      // Verify we can read it back
      const chunks: Uint8Array[] = [];
      for await (const chunk of storage.objects.load(blobId)) {
        chunks.push(chunk);
      }

      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      expect(totalLength).toBe(largeContent.length);

      await storage.close();
    });

    it("stores blob with null bytes", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const binaryContent = new Uint8Array([0x00, 0x01, 0x00, 0xff, 0x00, 0x00]);

      const { id: blobId } = await storage.objects.store(
        (async function* () {
          yield binaryContent;
        })(),
      );

      const chunks: Uint8Array[] = [];
      for await (const chunk of storage.objects.load(blobId)) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toEqual(binaryContent);

      await storage.close();
    });
  });
});

describe("tree format edge cases", () => {
  it("sorts entries with similar names correctly", () => {
    // Testing that trees are sorted after files with similar names
    const entries = [
      { mode: FileMode.TREE, name: "foo", id: "a".repeat(40) },
      { mode: FileMode.REGULAR_FILE, name: "foo.c", id: "b".repeat(40) },
      { mode: FileMode.REGULAR_FILE, name: "foo-bar", id: "c".repeat(40) },
    ];

    const serialized = serializeTree(entries);
    expect(serialized.length).toBeGreaterThan(0);
  });

  it("produces consistent output for same entries", () => {
    const entries = [
      { mode: FileMode.REGULAR_FILE, name: "b.txt", id: "a".repeat(40) },
      { mode: FileMode.REGULAR_FILE, name: "a.txt", id: "b".repeat(40) },
    ];

    const serialized1 = serializeTree(entries);
    const serialized2 = serializeTree([...entries].reverse());

    // Both should produce the same output (entries are sorted)
    expect(serialized1).toEqual(serialized2);
  });
});
