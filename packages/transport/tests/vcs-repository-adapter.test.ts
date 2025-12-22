/**
 * Tests for VCS repository adapter.
 *
 * Tests the adapter that converts VCS store interfaces to RepositoryAccess interface.
 */

import type {
  AnnotatedTag,
  Commit,
  CommitStore,
  GitObjectStore,
  ObjectTypeCode,
  Ref,
  RefStore,
  RefStoreLocation,
  RefUpdateResult,
  SymbolicRef,
  TagStore,
  TreeEntry,
  TreeStore,
} from "@webrun-vcs/core";
import { describe, expect, it } from "vitest";
import {
  createVcsRepositoryAdapter,
  createVcsServerOptions,
  type VcsStores,
} from "../src/storage-adapters/vcs-repository-adapter.js";

// Object type codes
const OBJ_COMMIT = 1 as ObjectTypeCode;
const OBJ_TREE = 2 as ObjectTypeCode;
const OBJ_BLOB = 3 as ObjectTypeCode;
const OBJ_TAG = 4 as ObjectTypeCode;

// Sample object IDs
const COMMIT_ID = "a".repeat(40);
const COMMIT_ID_2 = "a1".padEnd(40, "0");
const TREE_ID = "b".repeat(40);
const BLOB_ID = "c".repeat(40);
const TAG_ID = "t".repeat(40);

/**
 * Create a Git object with proper header.
 */
function createGitObject(type: string, content: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const fullData = new Uint8Array(header.length + content.length);
  fullData.set(header, 0);
  fullData.set(content, header.length);
  return fullData;
}

/**
 * Parse Git object header to extract type and content size.
 */
function parseGitObjectHeader(data: Uint8Array): {
  type: string;
  size: number;
  headerLength: number;
} {
  let nullIdx = -1;
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    if (data[i] === 0x00) {
      nullIdx = i;
      break;
    }
  }
  if (nullIdx < 0) throw new Error("Invalid Git object: no header null byte");

  const header = new TextDecoder().decode(data.subarray(0, nullIdx));
  const spaceIdx = header.indexOf(" ");
  if (spaceIdx < 0) throw new Error("Invalid Git object header");

  return {
    type: header.substring(0, spaceIdx),
    size: parseInt(header.substring(spaceIdx + 1), 10),
    headerLength: nullIdx + 1,
  };
}

/**
 * Create mock GitObjectStore.
 */
function createMockObjectStore(objects?: Map<string, Uint8Array>): GitObjectStore {
  const store =
    objects ??
    new Map([
      [COMMIT_ID, createGitObject("commit", new TextEncoder().encode(`tree ${TREE_ID}`))],
      [TREE_ID, createGitObject("tree", new Uint8Array(0))],
      [BLOB_ID, createGitObject("blob", new TextEncoder().encode("Hello, World!"))],
    ]);

  return {
    async store(type, content) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of content) {
        chunks.push(chunk);
      }
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const body = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.length;
      }
      // Create full git object with header
      const fullData = createGitObject(type, body);
      // Generate simple hash-like ID
      const id = Array.from(fullData.slice(0, 20))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .padEnd(40, "0");
      store.set(id, fullData);
      return id;
    },
    async *load(id) {
      const obj = store.get(id);
      if (!obj) throw new Error(`Object not found: ${id}`);
      const { headerLength } = parseGitObjectHeader(obj);
      yield obj.subarray(headerLength);
    },
    async *loadRaw(id) {
      const obj = store.get(id);
      if (!obj) throw new Error(`Object not found: ${id}`);
      yield obj;
    },
    async getHeader(id) {
      const obj = store.get(id);
      if (!obj) throw new Error(`Object not found: ${id}`);
      const { type, size } = parseGitObjectHeader(obj);
      return { type: type as "commit" | "tree" | "blob" | "tag", size };
    },
    async has(id) {
      return store.has(id);
    },
    async delete(id) {
      return store.delete(id);
    },
    async *list() {
      for (const id of store.keys()) {
        yield id;
      }
    },
  };
}

/**
 * Create mock RefStore.
 */
function createMockRefStore(options?: {
  refs?: Map<string, { objectId?: string; target?: string; peeledObjectId?: string }>;
}): RefStore {
  const refs =
    options?.refs ??
    new Map([
      ["refs/heads/master", { objectId: COMMIT_ID }],
      ["HEAD", { target: "refs/heads/master" }],
    ]);

  const location: RefStoreLocation = "primary" as RefStoreLocation;

  return {
    async get(refName) {
      const ref = refs.get(refName);
      if (!ref) return undefined;

      if (ref.target) {
        return {
          name: refName,
          target: ref.target,
          storage: location,
        } as SymbolicRef;
      }

      return {
        name: refName,
        objectId: ref.objectId,
        storage: location,
        peeled: !!ref.peeledObjectId,
        peeledObjectId: ref.peeledObjectId,
      } as Ref;
    },
    async resolve(refName) {
      const ref = refs.get(refName);
      if (!ref) return undefined;

      if (ref.target) {
        // Follow symbolic ref
        const targetRef = refs.get(ref.target);
        if (targetRef?.objectId) {
          return {
            name: ref.target,
            objectId: targetRef.objectId,
            storage: location,
            peeled: false,
          } as Ref;
        }
        return undefined;
      }

      return {
        name: refName,
        objectId: ref.objectId,
        storage: location,
        peeled: false,
      } as Ref;
    },
    async has(refName) {
      return refs.has(refName);
    },
    async *list(prefix?) {
      for (const [name, ref] of refs) {
        if (prefix && !name.startsWith(prefix)) continue;

        if (ref.target) {
          yield {
            name,
            target: ref.target,
            storage: location,
          } as SymbolicRef;
        } else if (ref.objectId) {
          yield {
            name,
            objectId: ref.objectId,
            storage: location,
            peeled: !!ref.peeledObjectId,
            peeledObjectId: ref.peeledObjectId,
          } as Ref;
        }
      }
    },
    async set(refName, objectId) {
      refs.set(refName, { objectId });
    },
    async setSymbolic(refName, target) {
      refs.set(refName, { target });
    },
    async delete(refName) {
      return refs.delete(refName);
    },
    async compareAndSwap(refName, expectedOld, newValue) {
      const current = refs.get(refName);
      const currentId = current?.objectId;

      if (currentId !== expectedOld) {
        return {
          success: false,
          previousValue: currentId,
          errorMessage: "Ref changed since last read",
        } as RefUpdateResult;
      }

      refs.set(refName, { objectId: newValue });
      return {
        success: true,
        previousValue: currentId,
      } as RefUpdateResult;
    },
  };
}

/**
 * Create mock CommitStore.
 */
function createMockCommitStore(
  commits?: Map<string, { tree: string; parents: string[] }>,
): CommitStore {
  const store = commits ?? new Map([[COMMIT_ID, { tree: TREE_ID, parents: [] }]]);

  const personIdent = {
    name: "Test",
    email: "test@test.com",
    timestamp: 1234567890,
    tzOffset: "+0000",
  };

  return {
    async storeCommit(commit: Commit) {
      const id = `commit-${store.size}`.padEnd(40, "0");
      store.set(id, { tree: commit.tree, parents: commit.parents });
      return id;
    },
    async loadCommit(id) {
      const commit = store.get(id);
      if (!commit) throw new Error(`Commit not found: ${id}`);
      return {
        tree: commit.tree,
        parents: commit.parents,
        author: personIdent,
        committer: personIdent,
        message: "Test commit",
      };
    },
    async getParents(id) {
      const commit = store.get(id);
      if (!commit) throw new Error(`Commit not found: ${id}`);
      return commit.parents;
    },
    async getTree(id) {
      const commit = store.get(id);
      if (!commit) throw new Error(`Commit not found: ${id}`);
      return commit.tree;
    },
    async *walkAncestry(startIds) {
      const ids = Array.isArray(startIds) ? startIds : [startIds];
      const seen = new Set<string>();
      const queue = [...ids];

      while (queue.length > 0) {
        const id = queue.shift();
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const commit = store.get(id);
        if (commit) {
          yield id;
          queue.push(...commit.parents);
        }
      }
    },
    async findMergeBase() {
      return [];
    },
    async hasCommit(id) {
      return store.has(id);
    },
    async isAncestor() {
      return false;
    },
  };
}

/**
 * Create mock TreeStore.
 */
function createMockTreeStore(trees?: Map<string, TreeEntry[]>): TreeStore {
  const store = trees ?? new Map([[TREE_ID, []]]);

  const emptyTreeId = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

  return {
    async storeTree(entries) {
      const entryList: TreeEntry[] = [];
      for await (const entry of entries) {
        entryList.push(entry);
      }
      const id = `tree-${store.size}`.padEnd(40, "0");
      store.set(id, entryList);
      return id;
    },
    async *loadTree(id) {
      const tree = store.get(id);
      if (!tree) throw new Error(`Tree not found: ${id}`);
      yield* tree;
    },
    async getEntry(treeId, name) {
      const tree = store.get(treeId);
      if (!tree) return undefined;
      return tree.find((e) => e.name === name);
    },
    async hasTree(id) {
      return store.has(id);
    },
    getEmptyTreeId() {
      return emptyTreeId;
    },
  };
}

/**
 * Create mock TagStore.
 */
function createMockTagStore(
  tags?: Map<string, { object: string; objectType: ObjectTypeCode }>,
): TagStore {
  const store = tags ?? new Map([[TAG_ID, { object: COMMIT_ID, objectType: OBJ_COMMIT }]]);

  const personIdent = {
    name: "Tagger",
    email: "tagger@test.com",
    timestamp: 1234567890,
    tzOffset: "+0000",
  };

  return {
    async storeTag(tag: AnnotatedTag) {
      const id = `tag-${store.size}`.padEnd(40, "0");
      store.set(id, { object: tag.object, objectType: tag.objectType });
      return id;
    },
    async loadTag(id) {
      const tag = store.get(id);
      if (!tag) throw new Error(`Tag not found: ${id}`);
      return {
        object: tag.object,
        objectType: tag.objectType,
        tag: "v1.0",
        tagger: personIdent,
        message: "Test tag",
      };
    },
    async getTarget(id, peel?) {
      let current = id;
      const visited = new Set<string>();

      while (true) {
        if (visited.has(current)) {
          throw new Error("Tag chain cycle detected");
        }
        visited.add(current);

        const tag = store.get(current);
        if (!tag) return current;

        if (!peel || tag.objectType !== OBJ_TAG) {
          return tag.object;
        }

        current = tag.object;
      }
    },
    async hasTag(id) {
      return store.has(id);
    },
  };
}

/**
 * Create complete VCS stores mock.
 */
function createMockVcsStores(options?: {
  objects?: Map<string, Uint8Array>;
  refs?: Map<string, { objectId?: string; target?: string; peeledObjectId?: string }>;
  commits?: Map<string, { tree: string; parents: string[] }>;
  trees?: Map<string, TreeEntry[]>;
  tags?: Map<string, { object: string; objectType: ObjectTypeCode }>;
}): VcsStores {
  return {
    objects: createMockObjectStore(options?.objects),
    refs: createMockRefStore({ refs: options?.refs }),
    commits: createMockCommitStore(options?.commits),
    trees: createMockTreeStore(options?.trees),
    tags: createMockTagStore(options?.tags),
  };
}

describe("createVcsRepositoryAdapter", () => {
  describe("listRefs", () => {
    it("should list all refs", async () => {
      const stores = createMockVcsStores({
        refs: new Map([
          ["refs/heads/master", { objectId: COMMIT_ID }],
          ["refs/heads/develop", { objectId: COMMIT_ID_2 }],
          ["refs/tags/v1.0", { objectId: COMMIT_ID }],
          ["HEAD", { target: "refs/heads/master" }],
        ]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const refs: Array<{ name: string; objectId: string }> = [];
      for await (const ref of adapter.listRefs()) {
        refs.push(ref);
      }

      expect(refs).toHaveLength(4);
      expect(refs.map((r) => r.name)).toContain("refs/heads/master");
      expect(refs.map((r) => r.name)).toContain("refs/heads/develop");
      expect(refs.map((r) => r.name)).toContain("refs/tags/v1.0");
      expect(refs.map((r) => r.name)).toContain("HEAD");
    });

    it("should resolve symbolic refs to objectId", async () => {
      const stores = createMockVcsStores({
        refs: new Map([
          ["refs/heads/master", { objectId: COMMIT_ID }],
          ["HEAD", { target: "refs/heads/master" }],
        ]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const refs: Array<{ name: string; objectId: string }> = [];
      for await (const ref of adapter.listRefs()) {
        refs.push(ref);
      }

      const head = refs.find((r) => r.name === "HEAD");
      expect(head).toBeDefined();
      expect(head?.objectId).toBe(COMMIT_ID);
    });

    it("should include peeled IDs for annotated tags", async () => {
      const stores = createMockVcsStores({
        refs: new Map([["refs/tags/v1.0", { objectId: TAG_ID, peeledObjectId: COMMIT_ID }]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const refs: Array<{ name: string; objectId: string; peeledId?: string }> = [];
      for await (const ref of adapter.listRefs()) {
        refs.push(ref);
      }

      expect(refs).toHaveLength(1);
      expect(refs[0].peeledId).toBe(COMMIT_ID);
    });

    it("should skip refs without objectId", async () => {
      const stores = createMockVcsStores({
        refs: new Map([
          ["refs/heads/master", { objectId: COMMIT_ID }],
          ["refs/heads/broken", {}], // No objectId
        ]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const refs: Array<{ name: string }> = [];
      for await (const ref of adapter.listRefs()) {
        refs.push(ref);
      }

      expect(refs).toHaveLength(1);
      expect(refs[0].name).toBe("refs/heads/master");
    });
  });

  describe("getHead", () => {
    it("should return symbolic HEAD target", async () => {
      const stores = createMockVcsStores({
        refs: new Map([
          ["HEAD", { target: "refs/heads/master" }],
          ["refs/heads/master", { objectId: COMMIT_ID }],
        ]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const head = await adapter.getHead();

      expect(head).not.toBeNull();
      expect(head?.target).toBe("refs/heads/master");
    });

    it("should return detached HEAD objectId", async () => {
      const stores = createMockVcsStores({
        refs: new Map([["HEAD", { objectId: COMMIT_ID }]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const head = await adapter.getHead();

      expect(head).not.toBeNull();
      expect(head?.objectId).toBe(COMMIT_ID);
    });

    it("should return null for non-existent HEAD", async () => {
      const stores = createMockVcsStores({
        refs: new Map([]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const head = await adapter.getHead();

      expect(head).toBeNull();
    });
  });

  describe("hasObject", () => {
    it("should return true for existing object", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const has = await adapter.hasObject(COMMIT_ID);

      expect(has).toBe(true);
    });

    it("should return false for non-existing object", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const has = await adapter.hasObject("nonexistent".repeat(4));

      expect(has).toBe(false);
    });
  });

  describe("getObjectInfo", () => {
    it("should return info for commit object", async () => {
      const commitContent = new TextEncoder().encode(`tree ${TREE_ID}`);
      const stores = createMockVcsStores({
        objects: new Map([[COMMIT_ID, createGitObject("commit", commitContent)]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const info = await adapter.getObjectInfo(COMMIT_ID);

      expect(info).not.toBeNull();
      expect(info?.type).toBe(OBJ_COMMIT);
    });

    it("should return info for tree object", async () => {
      const stores = createMockVcsStores({
        objects: new Map([[TREE_ID, createGitObject("tree", new Uint8Array(0))]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const info = await adapter.getObjectInfo(TREE_ID);

      expect(info).not.toBeNull();
      expect(info?.type).toBe(OBJ_TREE);
    });

    it("should return info for blob object", async () => {
      const blobContent = new TextEncoder().encode("Hello, World!");
      const stores = createMockVcsStores({
        objects: new Map([[BLOB_ID, createGitObject("blob", blobContent)]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const info = await adapter.getObjectInfo(BLOB_ID);

      expect(info).not.toBeNull();
      expect(info?.type).toBe(OBJ_BLOB);
    });

    it("should return info for tag object", async () => {
      const tagContent = new TextEncoder().encode(`object ${COMMIT_ID}`);
      const stores = createMockVcsStores({
        objects: new Map([[TAG_ID, createGitObject("tag", tagContent)]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const info = await adapter.getObjectInfo(TAG_ID);

      expect(info).not.toBeNull();
      expect(info?.type).toBe(OBJ_TAG);
    });

    it("should return null for non-existing object", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const info = await adapter.getObjectInfo("nonexistent".repeat(4));

      expect(info).toBeNull();
    });
  });

  describe("loadObject", () => {
    it("should yield object data", async () => {
      const blobContent = new TextEncoder().encode("Hello, World!");
      const stores = createMockVcsStores({
        objects: new Map([[BLOB_ID, createGitObject("blob", blobContent)]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const chunks: Uint8Array[] = [];
      for await (const chunk of adapter.loadObject(BLOB_ID)) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThan(0);
      const fullData = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        fullData.set(chunk, offset);
        offset += chunk.length;
      }

      // Should contain blob header and content
      const text = new TextDecoder().decode(fullData);
      expect(text).toContain("blob");
      expect(text).toContain("Hello, World!");
    });
  });

  describe("storeObject", () => {
    it("should store blob object", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const content = new TextEncoder().encode("Test content");
      const id = await adapter.storeObject(OBJ_BLOB, content);

      expect(id).toBeDefined();
      expect(id.length).toBe(40);

      // Verify object was stored
      const has = await adapter.hasObject(id);
      expect(has).toBe(true);
    });

    it("should store commit object", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const content = new TextEncoder().encode(`tree ${TREE_ID}\n\nTest commit`);
      const id = await adapter.storeObject(OBJ_COMMIT, content);

      expect(id).toBeDefined();
      expect(id.length).toBe(40);
    });

    it("should store tree object", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const content = new Uint8Array(0); // Empty tree
      const id = await adapter.storeObject(OBJ_TREE, content);

      expect(id).toBeDefined();
      expect(id.length).toBe(40);
    });
  });

  describe("updateRef", () => {
    it("should create new ref", async () => {
      const refs = new Map<string, { objectId?: string; target?: string }>([
        ["HEAD", { target: "refs/heads/master" }],
        ["refs/heads/master", { objectId: COMMIT_ID }],
      ]);
      const stores = createMockVcsStores({ refs });
      const adapter = createVcsRepositoryAdapter(stores);

      const result = await adapter.updateRef("refs/heads/new-branch", null, COMMIT_ID);

      expect(result).toBe(true);
    });

    it("should update existing ref with compare-and-swap", async () => {
      const newCommit = "n".repeat(40);
      const refs = new Map<string, { objectId?: string; target?: string }>([
        ["refs/heads/master", { objectId: COMMIT_ID }],
      ]);
      const stores = createMockVcsStores({ refs });
      const adapter = createVcsRepositoryAdapter(stores);

      const result = await adapter.updateRef("refs/heads/master", COMMIT_ID, newCommit);

      expect(result).toBe(true);
    });

    it("should fail compare-and-swap with wrong oldId", async () => {
      const refs = new Map<string, { objectId?: string; target?: string }>([
        ["refs/heads/master", { objectId: COMMIT_ID }],
      ]);
      const stores = createMockVcsStores({ refs });
      const adapter = createVcsRepositoryAdapter(stores);

      const wrongOldId = "w".repeat(40);
      const newCommit = "n".repeat(40);
      const result = await adapter.updateRef("refs/heads/master", wrongOldId, newCommit);

      expect(result).toBe(false);
    });

    it("should delete ref when newId is null", async () => {
      const refs = new Map<string, { objectId?: string; target?: string }>([
        ["refs/heads/master", { objectId: COMMIT_ID }],
        ["refs/heads/to-delete", { objectId: COMMIT_ID }],
      ]);
      const stores = createMockVcsStores({ refs });
      const adapter = createVcsRepositoryAdapter(stores);

      const result = await adapter.updateRef("refs/heads/to-delete", COMMIT_ID, null);

      expect(result).toBe(true);
    });
  });

  describe("walkObjects", () => {
    it("should walk commit and its tree", async () => {
      const commitContent = new TextEncoder().encode(`tree ${TREE_ID}\n\nTest`);
      const stores = createMockVcsStores({
        objects: new Map([
          [COMMIT_ID, createGitObject("commit", commitContent)],
          [TREE_ID, createGitObject("tree", new Uint8Array(0))],
        ]),
        commits: new Map([[COMMIT_ID, { tree: TREE_ID, parents: [] }]]),
        trees: new Map([[TREE_ID, []]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const objects: Array<{ id: string; type: ObjectTypeCode }> = [];
      for await (const obj of adapter.walkObjects([COMMIT_ID], [])) {
        objects.push({ id: obj.id, type: obj.type });
      }

      expect(objects.length).toBeGreaterThanOrEqual(1);
      expect(objects.find((o) => o.id === COMMIT_ID)).toBeDefined();
      expect(objects.find((o) => o.id === TREE_ID)).toBeDefined();
    });

    it("should skip objects in haves", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const objects: Array<{ id: string }> = [];
      for await (const obj of adapter.walkObjects([COMMIT_ID], [COMMIT_ID])) {
        objects.push({ id: obj.id });
      }

      // Commit should be skipped since it's in haves
      expect(objects.find((o) => o.id === COMMIT_ID)).toBeUndefined();
    });

    it("should not repeat objects", async () => {
      const stores = createMockVcsStores();
      const adapter = createVcsRepositoryAdapter(stores);

      const objects: Array<{ id: string }> = [];
      // Request same object twice
      for await (const obj of adapter.walkObjects([COMMIT_ID, COMMIT_ID], [])) {
        objects.push({ id: obj.id });
      }

      // Should only appear once
      const commitCount = objects.filter((o) => o.id === COMMIT_ID).length;
      expect(commitCount).toBeLessThanOrEqual(1);
    });

    it("should walk tree entries", async () => {
      const treeWithBlob = "tree-with-blob".padEnd(40, "0");
      const commitContent = new TextEncoder().encode(`tree ${treeWithBlob}\n\nTest`);
      const stores = createMockVcsStores({
        objects: new Map([
          [COMMIT_ID, createGitObject("commit", commitContent)],
          [treeWithBlob, createGitObject("tree", new Uint8Array(20))],
          [BLOB_ID, createGitObject("blob", new TextEncoder().encode("content"))],
        ]),
        commits: new Map([[COMMIT_ID, { tree: treeWithBlob, parents: [] }]]),
        trees: new Map([[treeWithBlob, [{ mode: 0o100644, name: "file.txt", id: BLOB_ID }]]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const objects: Array<{ id: string; type: ObjectTypeCode }> = [];
      for await (const obj of adapter.walkObjects([COMMIT_ID], [])) {
        objects.push({ id: obj.id, type: obj.type });
      }

      expect(objects.find((o) => o.id === COMMIT_ID)).toBeDefined();
      expect(objects.find((o) => o.id === treeWithBlob)).toBeDefined();
      expect(objects.find((o) => o.id === BLOB_ID)).toBeDefined();
    });

    it("should walk annotated tags", async () => {
      const tagContent = new TextEncoder().encode(
        `object ${COMMIT_ID}\ntype commit\ntag v1.0\n\nTag message`,
      );
      const commitContent = new TextEncoder().encode(`tree ${TREE_ID}\n\nTest`);
      const stores = createMockVcsStores({
        objects: new Map([
          [TAG_ID, createGitObject("tag", tagContent)],
          [COMMIT_ID, createGitObject("commit", commitContent)],
          [TREE_ID, createGitObject("tree", new Uint8Array(0))],
        ]),
        commits: new Map([[COMMIT_ID, { tree: TREE_ID, parents: [] }]]),
        trees: new Map([[TREE_ID, []]]),
        tags: new Map([[TAG_ID, { object: COMMIT_ID, objectType: OBJ_COMMIT }]]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const objects: Array<{ id: string; type: ObjectTypeCode }> = [];
      for await (const obj of adapter.walkObjects([TAG_ID], [])) {
        objects.push({ id: obj.id, type: obj.type });
      }

      expect(objects.find((o) => o.id === TAG_ID)).toBeDefined();
      expect(objects.find((o) => o.id === COMMIT_ID)).toBeDefined();
    });

    it("should walk commit parents", async () => {
      const parentCommitId = "parent".padEnd(40, "0");
      const parentTreeId = "parent-tree".padEnd(40, "0");
      const childCommitContent = new TextEncoder().encode(
        `tree ${TREE_ID}\nparent ${parentCommitId}\n\nChild`,
      );
      const parentCommitContent = new TextEncoder().encode(`tree ${parentTreeId}\n\nParent`);

      const stores = createMockVcsStores({
        objects: new Map([
          [COMMIT_ID, createGitObject("commit", childCommitContent)],
          [parentCommitId, createGitObject("commit", parentCommitContent)],
          [TREE_ID, createGitObject("tree", new Uint8Array(0))],
          [parentTreeId, createGitObject("tree", new Uint8Array(0))],
        ]),
        commits: new Map([
          [COMMIT_ID, { tree: TREE_ID, parents: [parentCommitId] }],
          [parentCommitId, { tree: parentTreeId, parents: [] }],
        ]),
        trees: new Map([
          [TREE_ID, []],
          [parentTreeId, []],
        ]),
      });
      const adapter = createVcsRepositoryAdapter(stores);

      const objects: Array<{ id: string; type: ObjectTypeCode }> = [];
      for await (const obj of adapter.walkObjects([COMMIT_ID], [])) {
        objects.push({ id: obj.id, type: obj.type });
      }

      expect(objects.find((o) => o.id === COMMIT_ID)).toBeDefined();
      expect(objects.find((o) => o.id === parentCommitId)).toBeDefined();
    });
  });
});

describe("createVcsServerOptions", () => {
  it("should create server options with resolveRepository", async () => {
    const stores = createMockVcsStores();
    const options = createVcsServerOptions(async () => stores);

    expect(options.resolveRepository).toBeDefined();

    // Test that resolveRepository returns RepositoryAccess
    const request = new Request("http://localhost/repo.git/info/refs");
    const repo = await options.resolveRepository(request, "repo.git");

    expect(repo).not.toBeNull();
    expect(typeof repo?.listRefs).toBe("function");
    expect(typeof repo?.getHead).toBe("function");
  });

  it("should return null when resolver returns null", async () => {
    const options = createVcsServerOptions(async () => null);

    const request = new Request("http://localhost/repo.git/info/refs");
    const repo = await options.resolveRepository(request, "nonexistent");

    expect(repo).toBeNull();
  });

  it("should merge additional options", async () => {
    const stores = createMockVcsStores();
    const customLogger = { error: () => {} };
    const options = createVcsServerOptions(async () => stores, {
      logger: customLogger,
      basePath: "/git/",
    });

    expect(options.logger).toBe(customLogger);
    expect(options.basePath).toBe("/git/");
  });
});

describe("Object type parsing", () => {
  it("should parse commit type correctly", async () => {
    const commitContent = new TextEncoder().encode("tree abc\n\nmessage");
    const stores = createMockVcsStores({
      objects: new Map([[COMMIT_ID, createGitObject("commit", commitContent)]]),
    });
    const adapter = createVcsRepositoryAdapter(stores);

    const info = await adapter.getObjectInfo(COMMIT_ID);

    expect(info?.type).toBe(OBJ_COMMIT);
  });

  it("should parse tree type correctly", async () => {
    const stores = createMockVcsStores({
      objects: new Map([[TREE_ID, createGitObject("tree", new Uint8Array(0))]]),
    });
    const adapter = createVcsRepositoryAdapter(stores);

    const info = await adapter.getObjectInfo(TREE_ID);

    expect(info?.type).toBe(OBJ_TREE);
  });

  it("should parse blob type correctly", async () => {
    const blobContent = new TextEncoder().encode("file content");
    const stores = createMockVcsStores({
      objects: new Map([[BLOB_ID, createGitObject("blob", blobContent)]]),
    });
    const adapter = createVcsRepositoryAdapter(stores);

    const info = await adapter.getObjectInfo(BLOB_ID);

    expect(info?.type).toBe(OBJ_BLOB);
  });

  it("should parse tag type correctly", async () => {
    const tagContent = new TextEncoder().encode(`object ${COMMIT_ID}\ntype commit\n`);
    const stores = createMockVcsStores({
      objects: new Map([[TAG_ID, createGitObject("tag", tagContent)]]),
    });
    const adapter = createVcsRepositoryAdapter(stores);

    const info = await adapter.getObjectInfo(TAG_ID);

    expect(info?.type).toBe(OBJ_TAG);
  });
});
