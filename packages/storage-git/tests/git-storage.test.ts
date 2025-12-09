/**
 * Integration tests for GitStorage
 *
 * Tests the complete storage workflow including:
 * - Repository initialization
 * - Object storage (blobs, trees, commits, tags)
 * - Reference management
 */

import { FilesApi, joinPath, MemFilesApi } from "@statewalker/webrun-files";
import { setCompression } from "@webrun-vcs/compression";
import { createNodeCompression } from "@webrun-vcs/compression/compression-node";
import { FileMode, type ObjectId, ObjectType } from "@webrun-vcs/storage";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createGitStorage, GitStorage } from "../src/git-storage.js";

describe("GitStorage", () => {
  let files: FilesApi;
  const gitDir = "/repo/.git";

  beforeAll(() => {
    setCompression(createNodeCompression());
  });

  beforeEach(() => {
    files = new FilesApi(new MemFilesApi());
  });

  describe("repository initialization", () => {
    it("creates a new repository", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Verify directory structure
      expect(await files.exists(gitDir)).toBe(true);
      expect(await files.exists(joinPath(gitDir, "objects"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "refs"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "refs", "heads"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "refs", "tags"))).toBe(true);
      expect(await files.exists(joinPath(gitDir, "HEAD"))).toBe(true);

      // Verify HEAD points to default branch
      const headContent = await files.readFile(joinPath(gitDir, "HEAD"));
      expect(new TextDecoder().decode(headContent)).toBe("ref: refs/heads/main\n");

      await storage.close();
    });

    it("creates a repository with custom default branch", async () => {
      const storage = await GitStorage.init(files, gitDir, {
        create: true,
        defaultBranch: "master",
      });

      const headContent = await files.readFile(joinPath(gitDir, "HEAD"));
      expect(new TextDecoder().decode(headContent)).toBe("ref: refs/heads/master\n");

      await storage.close();
    });

    it("opens an existing repository", async () => {
      // Create first
      const storage1 = await GitStorage.init(files, gitDir, { create: true });
      await storage1.close();

      // Open existing
      const storage2 = await GitStorage.open(files, gitDir);
      expect(storage2).toBeDefined();
      expect(storage2.gitDir).toBe(gitDir);

      await storage2.close();
    });

    it("throws when opening non-existent repository", async () => {
      await expect(GitStorage.open(files, gitDir)).rejects.toThrow(/Not a valid git repository/);
    });
  });

  describe("blob storage", () => {
    it("stores and retrieves blobs", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const content = new TextEncoder().encode("Hello, World!");
      const objectId = await storage.objects.store(
        (async function* () {
          yield content;
        })(),
      );

      expect(objectId).toMatch(/^[0-9a-f]{40}$/);
      expect(await storage.objects.has(objectId)).toBe(true);

      const chunks: Uint8Array[] = [];
      for await (const chunk of storage.objects.load(objectId)) {
        chunks.push(chunk);
      }
      expect(chunks[0]).toEqual(content);

      await storage.close();
    });

    it("deduplicates identical content", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const content = new TextEncoder().encode("Duplicate content");
      const objectId1 = await storage.objects.store(
        (async function* () {
          yield content;
        })(),
      );
      const objectId2 = await storage.objects.store(
        (async function* () {
          yield content;
        })(),
      );

      expect(objectId1).toBe(objectId2);

      await storage.close();
    });
  });

  describe("tree storage", () => {
    it("stores and retrieves trees", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Store a blob first
      const content = new TextEncoder().encode("File content");
      const blobId = await storage.objects.store(
        (async function* () {
          yield content;
        })(),
      );

      // Store tree with the blob
      const treeId = await storage.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId },
      ]);

      expect(treeId).toMatch(/^[0-9a-f]{40}$/);
      expect(await storage.trees.hasTree(treeId)).toBe(true);

      // Load tree entries
      const entries = [];
      for await (const entry of storage.trees.loadTree(treeId)) {
        entries.push(entry);
      }

      expect(entries).toHaveLength(1);
      expect(entries[0].name).toBe("file.txt");
      expect(entries[0].id).toBe(blobId);
      expect(entries[0].mode).toBe(FileMode.REGULAR_FILE);

      await storage.close();
    });

    it("handles empty trees", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTreeId = storage.trees.getEmptyTreeId();
      expect(await storage.trees.hasTree(emptyTreeId)).toBe(true);

      const entries = [];
      for await (const entry of storage.trees.loadTree(emptyTreeId)) {
        entries.push(entry);
      }
      expect(entries).toHaveLength(0);

      await storage.close();
    });

    it("sorts entries canonically", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Create blobs for files
      const blob1Id = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("a");
        })(),
      );
      const blob2Id = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("b");
        })(),
      );

      // Store tree with entries in wrong order
      const treeId = await storage.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "z-file", id: blob1Id },
        { mode: FileMode.REGULAR_FILE, name: "a-file", id: blob2Id },
      ]);

      // Entries should be returned in sorted order
      const entries = [];
      for await (const entry of storage.trees.loadTree(treeId)) {
        entries.push(entry);
      }

      expect(entries[0].name).toBe("a-file");
      expect(entries[1].name).toBe("z-file");

      await storage.close();
    });

    it("gets specific entry from tree", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const blobId = await storage.objects.store(
        (async function* () {
          yield new TextEncoder().encode("content");
        })(),
      );

      const treeId = await storage.trees.storeTree([
        { mode: FileMode.REGULAR_FILE, name: "target.txt", id: blobId },
        { mode: FileMode.REGULAR_FILE, name: "other.txt", id: blobId },
      ]);

      const entry = await storage.trees.getEntry(treeId, "target.txt");
      expect(entry).toBeDefined();
      expect(entry?.name).toBe("target.txt");

      const missing = await storage.trees.getEntry(treeId, "missing.txt");
      expect(missing).toBeUndefined();

      await storage.close();
    });
  });

  describe("commit storage", () => {
    it("stores and retrieves commits", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Create a tree
      const emptyTree = storage.trees.getEmptyTreeId();

      // Create commit
      const timestamp = 1700000000;
      const commitId = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: {
          name: "Test Author",
          email: "test@example.com",
          timestamp,
          tzOffset: "+0000",
        },
        committer: {
          name: "Test Committer",
          email: "commit@example.com",
          timestamp,
          tzOffset: "+0000",
        },
        message: "Initial commit",
      });

      expect(commitId).toMatch(/^[0-9a-f]{40}$/);
      expect(await storage.commits.hasCommit(commitId)).toBe(true);

      // Load and verify
      const commit = await storage.commits.loadCommit(commitId);
      expect(commit.tree).toBe(emptyTree);
      expect(commit.parents).toEqual([]);
      expect(commit.author.name).toBe("Test Author");
      expect(commit.committer.email).toBe("commit@example.com");
      expect(commit.message).toBe("Initial commit");

      await storage.close();
    });

    it("creates commit chains", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTree = storage.trees.getEmptyTreeId();
      const timestamp = 1700000000;
      const person = {
        name: "Author",
        email: "a@b.com",
        timestamp,
        tzOffset: "+0000",
      };

      // First commit
      const commit1 = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "First",
      });

      // Second commit
      const commit2 = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [commit1],
        author: { ...person, timestamp: timestamp + 1 },
        committer: { ...person, timestamp: timestamp + 1 },
        message: "Second",
      });

      // Third commit
      const commit3 = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [commit2],
        author: { ...person, timestamp: timestamp + 2 },
        committer: { ...person, timestamp: timestamp + 2 },
        message: "Third",
      });

      // Verify parent chain
      expect(await storage.commits.getParents(commit3)).toEqual([commit2]);
      expect(await storage.commits.getParents(commit2)).toEqual([commit1]);
      expect(await storage.commits.getParents(commit1)).toEqual([]);

      // Walk ancestry
      const ancestry = [];
      for await (const id of storage.commits.walkAncestry(commit3)) {
        ancestry.push(id);
      }
      expect(ancestry).toEqual([commit3, commit2, commit1]);

      // Check isAncestor
      expect(await storage.commits.isAncestor(commit1, commit3)).toBe(true);
      expect(await storage.commits.isAncestor(commit3, commit1)).toBe(false);

      await storage.close();
    });

    it("limits ancestry walk", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      const emptyTree = storage.trees.getEmptyTreeId();
      const timestamp = 1700000000;
      const person = {
        name: "Author",
        email: "a@b.com",
        timestamp,
        tzOffset: "+0000",
      };

      let parent: ObjectId[] = [];
      const commits: ObjectId[] = [];
      for (let i = 0; i < 5; i++) {
        const id = await storage.commits.storeCommit({
          tree: emptyTree,
          parents: parent,
          author: { ...person, timestamp: timestamp + i },
          committer: { ...person, timestamp: timestamp + i },
          message: `Commit ${i}`,
        });
        commits.push(id);
        parent = [id];
      }

      const limited = [];
      for await (const id of storage.commits.walkAncestry(commits[4], { limit: 3 })) {
        limited.push(id);
      }
      expect(limited).toHaveLength(3);

      await storage.close();
    });
  });

  describe("tag storage", () => {
    it("stores and retrieves annotated tags", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Create a commit to tag
      const emptyTree = storage.trees.getEmptyTreeId();
      const timestamp = 1700000000;
      const person = {
        name: "Author",
        email: "a@b.com",
        timestamp,
        tzOffset: "+0000",
      };

      const commitId = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "Tagged commit",
      });

      // Create annotated tag
      const tagId = await storage.tags.storeTag({
        object: commitId,
        objectType: ObjectType.COMMIT,
        tag: "v1.0.0",
        tagger: person,
        message: "Release version 1.0.0",
      });

      expect(tagId).toMatch(/^[0-9a-f]{40}$/);
      expect(await storage.tags.hasTag(tagId)).toBe(true);

      // Load and verify
      const tag = await storage.tags.loadTag(tagId);
      expect(tag.object).toBe(commitId);
      expect(tag.objectType).toBe(ObjectType.COMMIT);
      expect(tag.tag).toBe("v1.0.0");
      expect(tag.tagger?.name).toBe("Author");
      expect(tag.message).toBe("Release version 1.0.0");

      // Get target
      expect(await storage.tags.getTarget(tagId)).toBe(commitId);

      await storage.close();
    });
  });

  describe("reference management", () => {
    it("reads and writes branches", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Create a commit
      const emptyTree = storage.trees.getEmptyTreeId();
      const person = {
        name: "Author",
        email: "a@b.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      const commitId = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "Initial",
      });

      // Create branch
      await storage.refs.setRef("refs/heads/main", commitId);

      // Read branch
      const mainRef = await storage.refs.exactRef("refs/heads/main");
      expect(mainRef).toBeDefined();
      expect(mainRef && "objectId" in mainRef ? mainRef.objectId : undefined).toBe(commitId);

      // List branches
      const branches = await storage.refs.getBranches();
      expect(branches).toHaveLength(1);
      expect(branches[0].name).toBe("refs/heads/main");

      await storage.close();
    });

    it("resolves HEAD through symbolic ref", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });

      // Create a commit
      const emptyTree = storage.trees.getEmptyTreeId();
      const person = {
        name: "Author",
        email: "a@b.com",
        timestamp: 1700000000,
        tzOffset: "+0000",
      };

      const commitId = await storage.commits.storeCommit({
        tree: emptyTree,
        parents: [],
        author: person,
        committer: person,
        message: "Initial",
      });

      // Point main to commit
      await storage.refs.setRef("refs/heads/main", commitId);

      // HEAD should resolve to same commit
      const resolved = await storage.refs.resolve("HEAD");
      expect(resolved).toBeDefined();
      expect(resolved?.objectId).toBe(commitId);

      // Current branch should be main
      expect(await storage.getCurrentBranch()).toBe("main");

      await storage.close();
    });

    it("reads current branch", async () => {
      const storage = await GitStorage.init(files, gitDir, { create: true });
      expect(await storage.getCurrentBranch()).toBe("main");
      await storage.close();
    });
  });

  describe("factory function", () => {
    it("creates new repository with create option", async () => {
      const storage = await createGitStorage(files, gitDir, { create: true });
      expect(await files.exists(gitDir)).toBe(true);
      await storage.close();
    });

    it("opens existing repository without create option", async () => {
      // Create first
      const storage1 = await createGitStorage(files, gitDir, { create: true });
      await storage1.close();

      // Open
      const storage2 = await createGitStorage(files, gitDir);
      expect(storage2.gitDir).toBe(gitDir);
      await storage2.close();
    });
  });
});
