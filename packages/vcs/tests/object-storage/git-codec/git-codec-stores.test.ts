/**
 * Tests for git-codec stores
 *
 * Tests the new object storage layer that uses RawStore and VolatileStore interfaces.
 */

import { describe, expect, it } from "vitest";
import { MemoryVolatileStore } from "../../../src/binary-storage/volatile/memory-volatile-store.js";
import { collect, toArray } from "../../../src/format/stream-utils.js";
import { GitBlobStore } from "../../../src/object-storage/git-codec/git-blob-store.js";
import { GitCommitStore } from "../../../src/object-storage/git-codec/git-commit-store.js";
import { GitObjectStore } from "../../../src/object-storage/git-codec/git-object-store.js";
import { GitTagStore } from "../../../src/object-storage/git-codec/git-tag-store.js";
import { GitTreeStore } from "../../../src/object-storage/git-codec/git-tree-store.js";
import type {
  AnnotatedTag,
  Commit,
  TreeEntry,
} from "../../../src/object-storage/interfaces/index.js";
import { FileMode, ObjectType } from "../../../src/object-storage/interfaces/index.js";
import { MemoryRawStore } from "./memory-raw-store.js";

describe("git-codec stores", () => {
  const encoder = new TextEncoder();

  interface GitCodecStores {
    objects: GitObjectStore;
    blobs: GitBlobStore;
    trees: GitTreeStore;
    commits: GitCommitStore;
    tags: GitTagStore;
  }

  function createStores(): GitCodecStores {
    const volatile = new MemoryVolatileStore();
    const storage = new MemoryRawStore();
    const objects = new GitObjectStore(volatile, storage);

    return {
      objects,
      blobs: new GitBlobStore(objects),
      trees: new GitTreeStore(objects),
      commits: new GitCommitStore(objects),
      tags: new GitTagStore(objects),
    };
  }

  describe("GitObjectStore", () => {
    it("stores blob with correct header format", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Hello World");
      }

      const id = await stores.objects.store("blob", content());
      expect(id).toHaveLength(40);

      const header = await stores.objects.getHeader(id);
      expect(header.type).toBe("blob");
      expect(header.size).toBe(11);
    });

    it("stores commit with correct header format", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904\n");
        yield encoder.encode("author Test <test@test.com> 1234567890 +0000\n");
        yield encoder.encode("committer Test <test@test.com> 1234567890 +0000\n");
        yield encoder.encode("\n");
        yield encoder.encode("Initial commit");
      }

      const id = await stores.objects.store("commit", content());
      const header = await stores.objects.getHeader(id);
      expect(header.type).toBe("commit");
    });

    it("computes correct SHA-1 hash", async () => {
      const stores = createStores();

      // Known git hash for "blob 11\0Hello World"
      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Hello World");
      }

      const id = await stores.objects.store("blob", content());
      // Git: echo -n "Hello World" | git hash-object --stdin
      expect(id).toBe("5e1c309dae7f45e0f39b1bf3ac3cd9db12e7d689");
    });

    it("loads content stripping header", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test content");
      }

      const id = await stores.objects.store("blob", content());
      const loaded = await collect(stores.objects.load(id));
      const text = new TextDecoder().decode(loaded);

      expect(text).toBe("Test content");
    });

    it("loads raw content with header", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }

      const id = await stores.objects.store("blob", content());
      const raw = await collect(stores.objects.loadRaw(id));
      const text = new TextDecoder().decode(raw);

      expect(text).toBe("blob 4\0Test");
    });

    it("checks object existence", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }

      const id = await stores.objects.store("blob", content());

      expect(await stores.objects.has(id)).toBe(true);
      expect(await stores.objects.has("0".repeat(40))).toBe(false);
    });

    it("deletes objects", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }

      const id = await stores.objects.store("blob", content());
      expect(await stores.objects.has(id)).toBe(true);

      const deleted = await stores.objects.delete(id);
      expect(deleted).toBe(true);
      expect(await stores.objects.has(id)).toBe(false);
    });

    it("lists all object IDs", async () => {
      const stores = createStores();

      async function* content1(): AsyncIterable<Uint8Array> {
        yield encoder.encode("First");
      }
      async function* content2(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Second");
      }

      const id1 = await stores.objects.store("blob", content1());
      const id2 = await stores.objects.store("blob", content2());

      const ids = await toArray(stores.objects.list());
      expect(ids).toContain(id1);
      expect(ids).toContain(id2);
    });
  });

  describe("GitBlobStore", () => {
    it("stores and loads blob", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Hello World");
      }

      const id = await stores.blobs.store(content());
      const loaded = await collect(stores.blobs.load(id));
      const text = new TextDecoder().decode(loaded);

      expect(text).toBe("Hello World");
    });

    it("stores with known size", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }

      const id = await stores.blobs.storeWithSize(4, content());
      expect(await stores.blobs.has(id)).toBe(true);
    });

    it("checks existence", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }

      const id = await stores.blobs.store(content());

      expect(await stores.blobs.has(id)).toBe(true);
      expect(await stores.blobs.has("0".repeat(40))).toBe(false);
    });
  });

  describe("GitTreeStore", () => {
    it("stores and loads tree", async () => {
      const stores = createStores();

      // First store a blob to reference
      async function* blobContent(): AsyncIterable<Uint8Array> {
        yield encoder.encode("file content");
      }
      const blobId = await stores.blobs.store(blobContent());

      const entries: TreeEntry[] = [{ mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId }];

      const treeId = await stores.trees.storeTree(entries);
      const loaded = await toArray(stores.trees.loadTree(treeId));

      expect(loaded).toHaveLength(1);
      expect(loaded[0].name).toBe("file.txt");
      expect(loaded[0].mode).toBe(FileMode.REGULAR_FILE);
      expect(loaded[0].id).toBe(blobId);
    });

    it("sorts entries canonically", async () => {
      const stores = createStores();
      const blobId = "a".repeat(40);

      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "z.txt", id: blobId },
        { mode: FileMode.REGULAR_FILE, name: "a.txt", id: blobId },
        { mode: FileMode.REGULAR_FILE, name: "m.txt", id: blobId },
      ];

      const treeId = await stores.trees.storeTree(entries);
      const loaded = await toArray(stores.trees.loadTree(treeId));

      expect(loaded.map((e) => e.name)).toEqual(["a.txt", "m.txt", "z.txt"]);
    });

    it("gets entry by name", async () => {
      const stores = createStores();
      const blobId = "a".repeat(40);

      const entries: TreeEntry[] = [
        { mode: FileMode.REGULAR_FILE, name: "file1.txt", id: blobId },
        { mode: FileMode.REGULAR_FILE, name: "file2.txt", id: blobId },
      ];

      const treeId = await stores.trees.storeTree(entries);
      const entry = await stores.trees.getEntry(treeId, "file2.txt");

      expect(entry).toBeDefined();
      expect(entry?.name).toBe("file2.txt");
    });

    it("returns undefined for missing entry", async () => {
      const stores = createStores();
      const blobId = "a".repeat(40);

      const entries: TreeEntry[] = [{ mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId }];

      const treeId = await stores.trees.storeTree(entries);
      const entry = await stores.trees.getEntry(treeId, "missing.txt");

      expect(entry).toBeUndefined();
    });

    it("returns empty tree ID", () => {
      const stores = createStores();
      const emptyTreeId = stores.trees.getEmptyTreeId();

      expect(emptyTreeId).toBe("4b825dc642cb6eb9a060e54bf8d69288fbee4904");
    });

    it("checks existence", async () => {
      const stores = createStores();
      const blobId = "a".repeat(40);

      const entries: TreeEntry[] = [{ mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId }];

      const treeId = await stores.trees.storeTree(entries);

      expect(await stores.trees.hasTree(treeId)).toBe(true);
      expect(await stores.trees.hasTree("0".repeat(40))).toBe(false);
    });
  });

  describe("GitCommitStore", () => {
    const sampleCommit: Commit = {
      tree: "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
      parents: [],
      author: {
        name: "Test Author",
        email: "test@example.com",
        timestamp: 1234567890,
        tzOffset: "+0000",
      },
      committer: {
        name: "Test Author",
        email: "test@example.com",
        timestamp: 1234567890,
        tzOffset: "+0000",
      },
      message: "Initial commit",
    };

    it("stores and loads commit", async () => {
      const stores = createStores();

      const id = await stores.commits.storeCommit(sampleCommit);
      const loaded = await stores.commits.loadCommit(id);

      expect(loaded.tree).toBe(sampleCommit.tree);
      expect(loaded.parents).toEqual([]);
      expect(loaded.author.name).toBe("Test Author");
      expect(loaded.message).toBe("Initial commit");
    });

    it("gets parents", async () => {
      const stores = createStores();

      const parentId = await stores.commits.storeCommit(sampleCommit);
      const childCommit: Commit = {
        ...sampleCommit,
        parents: [parentId],
        message: "Second commit",
      };

      const childId = await stores.commits.storeCommit(childCommit);
      const parents = await stores.commits.getParents(childId);

      expect(parents).toEqual([parentId]);
    });

    it("gets tree", async () => {
      const stores = createStores();

      const id = await stores.commits.storeCommit(sampleCommit);
      const tree = await stores.commits.getTree(id);

      expect(tree).toBe(sampleCommit.tree);
    });

    it("walks ancestry", async () => {
      const stores = createStores();

      const commit1 = await stores.commits.storeCommit(sampleCommit);
      const commit2 = await stores.commits.storeCommit({
        ...sampleCommit,
        parents: [commit1],
        message: "Second",
      });
      const commit3 = await stores.commits.storeCommit({
        ...sampleCommit,
        parents: [commit2],
        message: "Third",
      });

      const ancestry = await toArray(stores.commits.walkAncestry(commit3));

      expect(ancestry).toEqual([commit3, commit2, commit1]);
    });

    it("walks ancestry with limit", async () => {
      const stores = createStores();

      const commit1 = await stores.commits.storeCommit(sampleCommit);
      const commit2 = await stores.commits.storeCommit({
        ...sampleCommit,
        parents: [commit1],
      });
      const commit3 = await stores.commits.storeCommit({
        ...sampleCommit,
        parents: [commit2],
      });

      const ancestry = await toArray(stores.commits.walkAncestry(commit3, { limit: 2 }));

      expect(ancestry).toHaveLength(2);
    });

    it("finds merge base", async () => {
      const stores = createStores();

      const base = await stores.commits.storeCommit(sampleCommit);
      const branch1 = await stores.commits.storeCommit({
        ...sampleCommit,
        parents: [base],
        message: "Branch 1",
      });
      const branch2 = await stores.commits.storeCommit({
        ...sampleCommit,
        parents: [base],
        message: "Branch 2",
      });

      const mergeBase = await stores.commits.findMergeBase(branch1, branch2);

      expect(mergeBase).toEqual([base]);
    });

    it("checks if commit is ancestor", async () => {
      const stores = createStores();

      const commit1 = await stores.commits.storeCommit(sampleCommit);
      const commit2 = await stores.commits.storeCommit({
        ...sampleCommit,
        parents: [commit1],
      });

      expect(await stores.commits.isAncestor(commit1, commit2)).toBe(true);
      expect(await stores.commits.isAncestor(commit2, commit1)).toBe(false);
    });

    it("checks existence", async () => {
      const stores = createStores();

      const id = await stores.commits.storeCommit(sampleCommit);

      expect(await stores.commits.hasCommit(id)).toBe(true);
      expect(await stores.commits.hasCommit("0".repeat(40))).toBe(false);
    });
  });

  describe("GitTagStore", () => {
    const sampleTag: AnnotatedTag = {
      object: "a".repeat(40),
      objectType: ObjectType.COMMIT,
      tag: "v1.0.0",
      tagger: {
        name: "Test Tagger",
        email: "test@example.com",
        timestamp: 1234567890,
        tzOffset: "+0000",
      },
      message: "Version 1.0.0",
    };

    it("stores and loads tag", async () => {
      const stores = createStores();

      const id = await stores.tags.storeTag(sampleTag);
      const loaded = await stores.tags.loadTag(id);

      expect(loaded.tag).toBe("v1.0.0");
      expect(loaded.object).toBe(sampleTag.object);
      expect(loaded.objectType).toBe(ObjectType.COMMIT);
      expect(loaded.message).toBe("Version 1.0.0");
    });

    it("gets target without peeling", async () => {
      const stores = createStores();

      const id = await stores.tags.storeTag(sampleTag);
      const target = await stores.tags.getTarget(id);

      expect(target).toBe(sampleTag.object);
    });

    it("checks existence", async () => {
      const stores = createStores();

      const id = await stores.tags.storeTag(sampleTag);

      expect(await stores.tags.hasTag(id)).toBe(true);
      expect(await stores.tags.hasTag("0".repeat(40))).toBe(false);
    });
  });

  describe("cross-store consistency", () => {
    it("objects are accessible via underlying store", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }

      const blobId = await stores.blobs.store(content());

      // Should be accessible via underlying object store
      expect(await stores.objects.has(blobId)).toBe(true);

      const header = await stores.objects.getHeader(blobId);
      expect(header.type).toBe("blob");
    });

    it("produces consistent hashes across stores", async () => {
      const stores = createStores();

      async function* content(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }

      const blobId = await stores.blobs.store(content());

      // Store same content via object store
      async function* content2(): AsyncIterable<Uint8Array> {
        yield encoder.encode("Test");
      }
      const directId = await stores.objects.store("blob", content2());

      expect(blobId).toBe(directId);
    });
  });
});
