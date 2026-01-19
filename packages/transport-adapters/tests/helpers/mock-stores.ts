/**
 * Mock VCS stores for testing VcsRepositoryAccess
 */

import type {
  AncestryOptions,
  AnnotatedTag,
  BlobStore,
  Commit,
  CommitStore,
  ObjectId,
  Ref,
  RefStore,
  RefUpdateResult,
  SymbolicRef,
  TagStore,
  TreeEntry,
  TreeStore,
} from "@statewalker/vcs-core";
import { serializeCommit, serializeTag, serializeTree } from "@statewalker/vcs-core";
import { sha1 } from "@statewalker/vcs-utils/hash";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import { collect, concat } from "@statewalker/vcs-utils/streams";
import type { VcsRepositoryAccessParams } from "../../src/vcs-repository-access.js";

// Re-export VcsRepositoryAccessParams type
export type { VcsRepositoryAccessParams };

/**
 * Compute Git object ID (SHA-1 of "type size\0content")
 */
async function computeObjectId(type: string, content: Uint8Array): Promise<ObjectId> {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const data = concat(header, content);
  const hash = await sha1(data);
  return bytesToHex(hash) as ObjectId;
}

/**
 * Create mock BlobStore
 */
export function createMockBlobStore(blobs?: Map<ObjectId, Uint8Array>): BlobStore {
  const store = blobs ?? new Map<ObjectId, Uint8Array>();

  return {
    async store(content) {
      const data = await collect(
        (async function* () {
          for await (const chunk of content) {
            yield chunk;
          }
        })(),
      );
      const id = await computeObjectId("blob", data);
      store.set(id, data);
      return id;
    },

    async *load(id) {
      const data = store.get(id);
      if (!data) throw new Error(`Blob not found: ${id}`);
      yield data;
    },

    async has(id) {
      return store.has(id);
    },

    async *keys() {
      for (const id of store.keys()) {
        yield id;
      }
    },

    async size(id) {
      const data = store.get(id);
      if (!data) throw new Error(`Blob not found: ${id}`);
      return data.length;
    },

    async delete(id) {
      return store.delete(id);
    },
  };
}

/**
 * Create mock TreeStore
 */
export function createMockTreeStore(trees?: Map<ObjectId, TreeEntry[]>): TreeStore {
  const store = trees ?? new Map<ObjectId, TreeEntry[]>();
  const emptyTreeId = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

  return {
    async storeTree(entries) {
      const entriesArray: TreeEntry[] = [];
      for await (const entry of entries) {
        entriesArray.push(entry);
      }
      const sorted = [...entriesArray].sort((a, b) => a.name.localeCompare(b.name));
      const data = serializeTree(sorted);
      const id = await computeObjectId("tree", data);
      store.set(id, sorted);
      return id;
    },

    async *loadTree(id) {
      const entries = store.get(id);
      if (!entries) throw new Error(`Tree not found: ${id}`);
      for (const entry of entries) {
        yield entry;
      }
    },

    async getEntry(treeId, name) {
      const entries = store.get(treeId);
      if (!entries) return undefined;
      return entries.find((e) => e.name === name);
    },

    async has(id) {
      return store.has(id);
    },

    async *keys() {
      for (const id of store.keys()) {
        yield id;
      }
    },

    getEmptyTreeId() {
      return emptyTreeId;
    },
  };
}

/**
 * Create mock CommitStore
 */
export function createMockCommitStore(commits?: Map<ObjectId, Commit>): CommitStore {
  const store = commits ?? new Map<ObjectId, Commit>();

  return {
    async storeCommit(commit) {
      const data = serializeCommit(commit);
      const id = await computeObjectId("commit", data);
      store.set(id, commit);
      return id;
    },

    async loadCommit(id) {
      const commit = store.get(id);
      if (!commit) throw new Error(`Commit not found: ${id}`);
      return commit;
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

    async *walkAncestry(startIds: ObjectId | ObjectId[], options?: AncestryOptions) {
      const starts = Array.isArray(startIds) ? startIds : [startIds];
      const visited = new Set<ObjectId>();
      const queue = [...starts];
      let count = 0;

      while (queue.length > 0) {
        const id = queue.shift();
        if (!id) continue;
        if (visited.has(id)) continue;
        if (options?.stopAt?.includes(id)) continue;

        visited.add(id);
        count++;

        if (options?.limit && count > options.limit) break;

        const commit = store.get(id);
        if (commit) {
          yield id;
          const parents = options?.firstParentOnly ? commit.parents.slice(0, 1) : commit.parents;
          queue.push(...parents);
        }
      }
    },

    async findMergeBase() {
      // Simplified mock - returns empty
      return [];
    },

    async has(id) {
      return store.has(id);
    },

    async *keys() {
      for (const id of store.keys()) {
        yield id;
      }
    },

    async isAncestor() {
      // Simplified mock
      return false;
    },
  };
}

/**
 * Create mock TagStore
 */
export function createMockTagStore(tags?: Map<ObjectId, AnnotatedTag>): TagStore {
  const store = tags ?? new Map<ObjectId, AnnotatedTag>();

  return {
    async storeTag(tag) {
      const data = serializeTag(tag);
      const id = await computeObjectId("tag", data);
      store.set(id, tag);
      return id;
    },

    async loadTag(id) {
      const tag = store.get(id);
      if (!tag) throw new Error(`Tag not found: ${id}`);
      return tag;
    },

    async getTarget(id, peel = false) {
      const tag = store.get(id);
      if (!tag) throw new Error(`Tag not found: ${id}`);
      if (peel) {
        // For simplicity, just return the direct object
        return tag.object;
      }
      return tag.object;
    },

    async has(id) {
      return store.has(id);
    },

    async *keys() {
      for (const id of store.keys()) {
        yield id;
      }
    },
  };
}

/**
 * Create mock RefStore
 */
export function createMockRefStore(refs?: Map<string, Ref | SymbolicRef>): RefStore {
  const store =
    refs ??
    new Map<string, Ref | SymbolicRef>([
      ["HEAD", { name: "HEAD", target: "refs/heads/main", storage: "loose" as const }],
    ]);

  return {
    async get(refName) {
      return store.get(refName);
    },

    async resolve(refName) {
      let current = store.get(refName);
      const seen = new Set<string>();

      while (current && "target" in current) {
        if (seen.has(current.target)) {
          throw new Error(`Circular symbolic ref: ${refName}`);
        }
        seen.add(current.target);
        current = store.get(current.target);
      }

      return current as Ref | undefined;
    },

    async has(refName) {
      return store.has(refName);
    },

    async *list(prefix?: string) {
      for (const [name, ref] of store.entries()) {
        if (!prefix || name.startsWith(prefix)) {
          yield ref;
        }
      }
    },

    async set(refName, objectId) {
      store.set(refName, {
        name: refName,
        objectId,
        storage: "loose" as const,
        peeled: false,
      });
    },

    async setSymbolic(refName, target) {
      store.set(refName, {
        name: refName,
        target,
        storage: "loose" as const,
      });
    },

    async delete(refName) {
      return store.delete(refName);
    },

    async compareAndSwap(
      refName: string,
      expectedOld: ObjectId | undefined,
      newValue: ObjectId,
    ): Promise<RefUpdateResult> {
      const current = store.get(refName);
      const currentOid = current && "objectId" in current ? current.objectId : undefined;

      if (currentOid !== expectedOld) {
        return { success: false, previousValue: currentOid, errorMessage: "Compare failed" };
      }

      store.set(refName, {
        name: refName,
        objectId: newValue,
        storage: "loose" as const,
        peeled: false,
      });
      return { success: true, previousValue: currentOid };
    },
  };
}

/**
 * Options for creating mock stores
 */
export interface MockStoresOptions {
  blobs?: Map<ObjectId, Uint8Array>;
  trees?: Map<ObjectId, TreeEntry[]>;
  commits?: Map<ObjectId, Commit>;
  tags?: Map<ObjectId, AnnotatedTag>;
  refs?: Map<string, Ref | SymbolicRef>;
}

/**
 * Create all mock VCS stores
 */
export function createMockStores(options?: MockStoresOptions): VcsRepositoryAccessParams {
  return {
    blobs: createMockBlobStore(options?.blobs),
    trees: createMockTreeStore(options?.trees),
    commits: createMockCommitStore(options?.commits),
    tags: createMockTagStore(options?.tags),
    refs: createMockRefStore(options?.refs),
  };
}

/**
 * Sample data for testing
 */
export const SAMPLE_COMMIT_ID = "1234567890123456789012345678901234567890";
export const SAMPLE_TREE_ID = "abcdef1234567890abcdef1234567890abcdef12";
export const SAMPLE_BLOB_ID = "fedcba0987654321fedcba0987654321fedcba09";
export const SAMPLE_TAG_ID = "deadbeef12345678deadbeef12345678deadbeef";

export const SAMPLE_IDENT = {
  name: "Test User",
  email: "test@example.com",
  timestamp: 1700000000,
  tzOffset: "+0000",
};

export const SAMPLE_COMMIT: Commit = {
  tree: SAMPLE_TREE_ID,
  parents: [],
  author: SAMPLE_IDENT,
  committer: SAMPLE_IDENT,
  message: "Initial commit",
};

export const SAMPLE_TREE_ENTRY: TreeEntry = {
  mode: 0o100644,
  name: "test.txt",
  id: SAMPLE_BLOB_ID,
};

export const SAMPLE_TAG: AnnotatedTag = {
  object: SAMPLE_COMMIT_ID,
  objectType: 1, // COMMIT
  tag: "v1.0.0",
  tagger: SAMPLE_IDENT,
  message: "Release v1.0.0",
};

/**
 * Create mock stores with sample history data for walk tests
 */
export async function createMockStoresWithHistory(): Promise<{
  stores: VcsRepositoryAccessParams;
  commitId: ObjectId;
  treeId: ObjectId;
  blobId: ObjectId;
}> {
  const stores = createMockStores();

  // Store a blob
  const blobContent = new TextEncoder().encode("Hello, World!");
  const blobId = await stores.blobs.store([blobContent]);

  // Store a tree with the blob
  const treeId = await stores.trees.storeTree([{ mode: 0o100644, name: "hello.txt", id: blobId }]);

  // Store a commit
  const commitId = await stores.commits.storeCommit({
    tree: treeId,
    parents: [],
    author: SAMPLE_IDENT,
    committer: SAMPLE_IDENT,
    message: "Initial commit",
  });

  // Set up refs
  await stores.refs.set("refs/heads/main", commitId);
  await stores.refs.setSymbolic("HEAD", "refs/heads/main");

  return { stores, commitId, treeId, blobId };
}
