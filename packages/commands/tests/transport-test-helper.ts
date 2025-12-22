/**
 * Transport test helpers for @webrun-vcs/commands
 *
 * Provides test infrastructure for remote operations (fetch, push, clone, pull).
 * Uses an in-memory Git HTTP server for testing with createVcsRepositoryAdapter.
 */

import { serializeCommit, serializeTree } from "@webrun-vcs/storage-git";
import { MemoryRefStore, MemoryStagingStore, MemoryTagStore } from "@webrun-vcs/store-mem";
import { createGitHttpServer, createVcsRepositoryAdapter } from "@webrun-vcs/transport";
import type {
  AncestryOptions,
  BlobStore,
  Commit,
  CommitStore,
  GitObjectHeader,
  GitObjectStore,
  ObjectId,
  ObjectTypeString,
  TreeEntry,
  TreeStore,
} from "@webrun-vcs/vcs";

import { Git, type GitStore } from "../src/index.js";
import { testAuthor } from "./test-helper.js";

/**
 * SHA-1 hash function using Web Crypto API.
 */
async function sha1Hex(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-1", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create a Git object with header.
 */
function createGitObject(type: string, content: Uint8Array): Uint8Array {
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const result = new Uint8Array(header.length + content.length);
  result.set(header, 0);
  result.set(content, header.length);
  return result;
}

/**
 * Concatenate byte arrays.
 */
function concatBytes(arrays: Uint8Array[]): Uint8Array {
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
 * In-memory object store that stores Git-format objects (with headers).
 *
 * This store is compatible with createVcsRepositoryAdapter which expects
 * objects stored in Git format: "{type} {size}\0{content}"
 */
class MemoryGitObjectStore implements GitObjectStore {
  private objects = new Map<string, Uint8Array>();

  async store(
    type: ObjectTypeString,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<ObjectId> {
    const chunks: Uint8Array[] = [];
    if (Symbol.asyncIterator in content) {
      for await (const chunk of content as AsyncIterable<Uint8Array>) {
        chunks.push(chunk);
      }
    } else {
      for (const chunk of content as Iterable<Uint8Array>) {
        chunks.push(chunk);
      }
    }
    const rawContent = concatBytes(chunks);
    const gitObject = createGitObject(type, rawContent);

    // Hash the Git object (header + content)
    const id = await sha1Hex(gitObject);
    if (!this.objects.has(id)) {
      this.objects.set(id, gitObject);
    }
    return id;
  }

  /**
   * Store raw Git object (already has header)
   */
  async storeRaw(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
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
    const content = concatBytes(chunks);
    const id = await sha1Hex(content);
    if (!this.objects.has(id)) {
      this.objects.set(id, content);
    }
    return id;
  }

  async *load(id: ObjectId): AsyncIterable<Uint8Array> {
    const data = this.objects.get(id);
    if (!data) {
      throw new Error(`Object ${id} not found`);
    }
    // Strip header and return content only
    const nullIndex = data.indexOf(0);
    if (nullIndex === -1) {
      throw new Error(`Invalid Git object format: ${id}`);
    }
    yield data.subarray(nullIndex + 1);
  }

  async *loadRaw(id: ObjectId): AsyncIterable<Uint8Array> {
    const data = this.objects.get(id);
    if (!data) {
      throw new Error(`Object ${id} not found`);
    }
    yield data;
  }

  async getHeader(id: ObjectId): Promise<GitObjectHeader> {
    const data = this.objects.get(id);
    if (!data) {
      throw new Error(`Object ${id} not found`);
    }
    // Parse header: "type size\0"
    const nullIndex = data.indexOf(0);
    if (nullIndex === -1) {
      throw new Error(`Invalid Git object format: ${id}`);
    }
    const headerStr = new TextDecoder().decode(data.subarray(0, nullIndex));
    const spaceIndex = headerStr.indexOf(" ");
    if (spaceIndex === -1) {
      throw new Error(`Invalid Git object header: ${headerStr}`);
    }
    const type = headerStr.substring(0, spaceIndex) as ObjectTypeString;
    const size = parseInt(headerStr.substring(spaceIndex + 1), 10);
    return { type, size };
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }

  async delete(id: ObjectId): Promise<boolean> {
    return this.objects.delete(id);
  }

  async *list(): AsyncIterable<ObjectId> {
    for (const id of this.objects.keys()) {
      yield id;
    }
  }
}

/**
 * Collect chunks from sync or async iterable.
 */
async function collectChunks(
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<Uint8Array[]> {
  const chunks: Uint8Array[] = [];
  if (Symbol.asyncIterator in content) {
    for await (const chunk of content as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
  } else {
    for (const chunk of content as Iterable<Uint8Array>) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

/**
 * BlobStore wrapper that works with MemoryGitObjectStore.
 *
 * Handles Git header format: "blob {size}\0{content}"
 */
class GitFormatBlobStore implements BlobStore {
  private objectStore: MemoryGitObjectStore;

  constructor(objectStore: MemoryGitObjectStore) {
    this.objectStore = objectStore;
  }

  async store(content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.objectStore.store("blob", content);
  }

  async *load(id: ObjectId): AsyncIterable<Uint8Array> {
    // Load raw Git object and strip header
    const chunks: Uint8Array[] = [];
    for await (const chunk of this.objectStore.load(id)) {
      chunks.push(chunk);
    }
    const data = concatBytes(chunks);

    // Find null byte after header
    let nullIdx = -1;
    for (let i = 0; i < Math.min(data.length, 32); i++) {
      if (data[i] === 0x00) {
        nullIdx = i;
        break;
      }
    }
    if (nullIdx < 0) {
      throw new Error("Invalid Git object: no header null byte");
    }

    yield data.subarray(nullIdx + 1);
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.objectStore.has(id);
  }
}

/**
 * CommitStore that uses Git-format SHA-1 IDs and coordinates with object store.
 *
 * Stores commits both as structured data (for loadCommit) and as Git-format
 * objects in the shared object store (for protocol handlers).
 */
class GitFormatCommitStore implements CommitStore {
  private commits = new Map<ObjectId, Commit>();
  private objectStore: MemoryGitObjectStore;

  constructor(objectStore: MemoryGitObjectStore) {
    this.objectStore = objectStore;
  }

  async storeCommit(commit: Commit): Promise<ObjectId> {
    // Serialize commit to Git format
    const content = serializeCommit(commit);

    // Store in object store and get Git-format SHA-1 ID
    const id = await this.objectStore.store("commit", [content]);

    // Store structured commit data for loadCommit
    if (!this.commits.has(id)) {
      this.commits.set(id, {
        tree: commit.tree,
        parents: [...commit.parents],
        author: { ...commit.author },
        committer: { ...commit.committer },
        message: commit.message,
        encoding: commit.encoding,
        gpgSignature: commit.gpgSignature,
      });
    }

    return id;
  }

  async loadCommit(id: ObjectId): Promise<Commit> {
    const commit = this.commits.get(id);
    if (!commit) {
      throw new Error(`Commit ${id} not found`);
    }
    return {
      tree: commit.tree,
      parents: [...commit.parents],
      author: { ...commit.author },
      committer: { ...commit.committer },
      message: commit.message,
      encoding: commit.encoding,
      gpgSignature: commit.gpgSignature,
    };
  }

  async getParents(id: ObjectId): Promise<ObjectId[]> {
    const commit = await this.loadCommit(id);
    return commit.parents;
  }

  async getTree(id: ObjectId): Promise<ObjectId> {
    const commit = await this.loadCommit(id);
    return commit.tree;
  }

  walkAncestry(
    startIds: ObjectId | ObjectId[],
    options: AncestryOptions = {},
  ): AsyncIterable<ObjectId> {
    return this.walkAncestryGenerator(startIds, options);
  }

  private async *walkAncestryGenerator(
    startIds: ObjectId | ObjectId[],
    options: AncestryOptions,
  ): AsyncGenerator<ObjectId> {
    const starts = Array.isArray(startIds) ? startIds : [startIds];
    const { limit, stopAt, firstParentOnly } = options;
    const stopSet = new Set(stopAt || []);
    const queue: Array<{ id: ObjectId; timestamp: number }> = [];
    const visited = new Set<ObjectId>();
    let count = 0;

    for (const id of starts) {
      if (!visited.has(id) && !stopSet.has(id)) {
        visited.add(id);
        try {
          const commit = await this.loadCommit(id);
          queue.push({ id, timestamp: commit.committer.timestamp });
        } catch {
          // Skip missing commits
        }
      }
    }

    queue.sort((a, b) => b.timestamp - a.timestamp);

    while (queue.length > 0) {
      if (limit !== undefined && count >= limit) break;

      const entry = queue.shift();
      if (!entry) break;
      yield entry.id;
      count++;

      const commit = await this.loadCommit(entry.id);
      const parents = firstParentOnly ? commit.parents.slice(0, 1) : commit.parents;

      for (const parentId of parents) {
        if (!visited.has(parentId) && !stopSet.has(parentId)) {
          visited.add(parentId);
          try {
            const parent = await this.loadCommit(parentId);
            queue.push({ id: parentId, timestamp: parent.committer.timestamp });
            queue.sort((a, b) => b.timestamp - a.timestamp);
          } catch {
            // Skip missing parents
          }
        }
      }
    }
  }

  async findMergeBase(commitA: ObjectId, commitB: ObjectId): Promise<ObjectId[]> {
    const colorA = new Set<ObjectId>();
    for await (const id of this.walkAncestry(commitA)) {
      colorA.add(id);
    }

    const mergeBases: ObjectId[] = [];
    for await (const id of this.walkAncestry(commitB)) {
      if (colorA.has(id)) {
        let isRedundant = false;
        for (const base of mergeBases) {
          if (await this.isAncestor(id, base)) {
            isRedundant = true;
            break;
          }
        }
        if (!isRedundant) {
          const filtered: ObjectId[] = [];
          for (const base of mergeBases) {
            if (!(await this.isAncestor(base, id))) {
              filtered.push(base);
            }
          }
          filtered.push(id);
          mergeBases.length = 0;
          mergeBases.push(...filtered);
        }
      }
    }
    return mergeBases;
  }

  async hasCommit(id: ObjectId): Promise<boolean> {
    return this.commits.has(id);
  }

  async isAncestor(ancestorId: ObjectId, descendantId: ObjectId): Promise<boolean> {
    if (ancestorId === descendantId) return true;
    for await (const id of this.walkAncestry(descendantId)) {
      if (id === ancestorId) return true;
    }
    return false;
  }
}

/**
 * TreeStore that uses Git-format SHA-1 IDs and coordinates with object store.
 */
class GitFormatTreeStore implements TreeStore {
  private trees = new Map<ObjectId, TreeEntry[]>();
  private objectStore: MemoryGitObjectStore;

  constructor(objectStore: MemoryGitObjectStore) {
    this.objectStore = objectStore;
  }

  async storeTree(entries: TreeEntry[]): Promise<ObjectId> {
    // Sort entries by name (Git requirement)
    const sortedEntries = [...entries].sort((a, b) => a.name.localeCompare(b.name));

    // Serialize tree to Git format
    const content = serializeTree(sortedEntries);

    // Store in object store and get Git-format SHA-1 ID
    const id = await this.objectStore.store("tree", [content]);

    // Store structured tree data for loadTree
    if (!this.trees.has(id)) {
      this.trees.set(
        id,
        sortedEntries.map((e) => ({ ...e })),
      );
    }

    return id;
  }

  async *loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    // Handle well-known empty tree
    if (id === this.getEmptyTreeId()) {
      return; // Empty iterator
    }
    const entries = this.trees.get(id);
    if (!entries) {
      throw new Error(`Tree ${id} not found`);
    }
    for (const entry of entries) {
      yield { ...entry };
    }
  }

  async hasTree(id: ObjectId): Promise<boolean> {
    // Handle well-known empty tree
    if (id === this.getEmptyTreeId()) {
      return true;
    }
    return this.trees.has(id);
  }

  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    const entries = this.trees.get(treeId);
    if (!entries) {
      return undefined;
    }
    return entries.find((e) => e.name === name);
  }

  getEmptyTreeId(): ObjectId {
    // SHA-1 of empty tree Git object: "tree 0\0"
    return "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  }
}

/**
 * Extended GitStore interface for testing that includes ObjectStore for transport.
 */
export interface TestGitStore extends GitStore {
  /** Low-level object storage (for transport/pack operations) */
  readonly objects: ObjectStore;
}

/**
 * Create a GitStore with Git-format object storage for testing.
 *
 * All stores coordinate to use Git-format SHA-1 IDs, making this
 * compatible with createVcsRepositoryAdapter.
 */
export function createGitFormatTestStore(): TestGitStore {
  const objects = new MemoryGitObjectStore();
  return {
    objects,
    blobs: new GitFormatBlobStore(objects),
    trees: new GitFormatTreeStore(objects),
    commits: new GitFormatCommitStore(objects),
    refs: new MemoryRefStore(),
    staging: new MemoryStagingStore(),
    tags: new MemoryTagStore(),
  };
}

/**
 * Test server setup result.
 */
export interface TestServer {
  /** The Git HTTP server fetch function (for Request objects) */
  fetch: (request: Request) => Promise<Response>;
  /** Mock fetch function that can replace globalThis.fetch */
  mockFetch: typeof globalThis.fetch;
  /** Base URL for the server */
  baseUrl: string;
  /** The server-side GitStore (with objects for transport) */
  serverStore: TestGitStore;
  /** The server-side Git facade */
  serverGit: Git;
}

/**
 * Create a mock fetch function from a test server.
 */
function createMockFetch(
  serverFetch: (request: Request) => Promise<Response>,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.href;
    } else if (input instanceof Request) {
      url = input.url;
    } else {
      throw new Error(`Invalid fetch input: ${typeof input}`);
    }
    const request = new Request(url, init);
    return serverFetch(request);
  };
}

/**
 * Create a test HTTP server for Git operations.
 *
 * @param serverStore Optional pre-configured server store
 * @returns Test server configuration
 */
export function createTestServer(serverStore?: TestGitStore): TestServer {
  const store = serverStore ?? createGitFormatTestStore();

  // Use createVcsRepositoryAdapter from transport package
  const repositoryAccess = createVcsRepositoryAdapter({
    objects: store.objects,
    refs: store.refs,
    commits: store.commits,
    trees: store.trees,
    tags: store.tags,
  });

  const server = createGitHttpServer({
    async resolveRepository(_request, repoPath) {
      if (repoPath) {
        return repositoryAccess;
      }
      return null;
    },
  });

  const baseUrl = "http://localhost:3000";
  const serverFetch = (request: Request) => server.fetch(request);

  return {
    fetch: serverFetch,
    mockFetch: createMockFetch(serverFetch),
    baseUrl,
    serverStore: store,
    serverGit: Git.wrap(store),
  };
}

/**
 * Create an initialized test server with an initial commit.
 */
export async function createInitializedTestServer(): Promise<
  TestServer & { initialCommitId: string }
> {
  const store = createGitFormatTestStore();
  const git = Git.wrap(store);

  // Create and store empty tree
  const emptyTreeId = await store.trees.storeTree([]);

  // Create initial commit
  const initialCommit = {
    tree: emptyTreeId,
    parents: [] as string[],
    author: testAuthor(),
    committer: testAuthor(),
    message: "Initial commit",
  };

  const initialCommitId = await store.commits.storeCommit(initialCommit);

  // Set up refs
  await store.refs.set("refs/heads/main", initialCommitId);
  await store.refs.setSymbolic("HEAD", "refs/heads/main");

  // Initialize staging
  await store.staging.readTree(store.trees, emptyTreeId);

  // Use createVcsRepositoryAdapter from transport package
  const repositoryAccess = createVcsRepositoryAdapter({
    objects: store.objects,
    refs: store.refs,
    commits: store.commits,
    trees: store.trees,
    tags: store.tags,
  });

  const server = createGitHttpServer({
    async resolveRepository(_request, repoPath) {
      if (repoPath) {
        return repositoryAccess;
      }
      return null;
    },
  });

  const baseUrl = "http://localhost:3000";
  const serverFetch = (request: Request) => server.fetch(request);

  return {
    fetch: serverFetch,
    mockFetch: createMockFetch(serverFetch),
    baseUrl,
    serverStore: store,
    serverGit: git,
    initialCommitId,
  };
}

/**
 * Create a Git URL for testing.
 */
export function createTestUrl(baseUrl: string, repoName = "test.git"): string {
  return `${baseUrl}/${repoName}`;
}

/**
 * HTTP client that routes requests through the test server.
 */
export function createTestFetch(server: TestServer): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const request = new Request(url, init);
    return server.fetch(request);
  };
}

/**
 * Add a file to a store and create a commit.
 *
 * This function stores objects in Git format, compatible with
 * createVcsRepositoryAdapter.
 */
export async function addFileAndCommit(
  store: TestGitStore,
  path: string,
  content: string,
  message: string,
): Promise<string> {
  // Store blob using BlobStore (handles Git header automatically)
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const blobId = await store.blobs.store([data]);

  // Update staging
  const editor = store.staging.editor();
  editor.add({
    path,
    apply: () => ({
      path,
      mode: 0o100644,
      objectId: blobId,
      stage: 0,
      size: data.length,
      mtime: Date.now(),
    }),
  });
  await editor.finish();

  // Write tree (GitFormatTreeStore handles Git format)
  const treeId = await store.staging.writeTree(store.trees);

  // Get parent
  let parents: string[] = [];
  try {
    const headRef = await store.refs.resolve("HEAD");
    if (headRef?.objectId) {
      parents = [headRef.objectId];
    }
  } catch {
    // No HEAD yet
  }

  // Create commit (GitFormatCommitStore handles Git format)
  const commit = {
    tree: treeId,
    parents,
    author: testAuthor(),
    committer: testAuthor(),
    message,
  };

  const commitId = await store.commits.storeCommit(commit);

  // Update HEAD
  const head = await store.refs.get("HEAD");
  if (head && "target" in head) {
    await store.refs.set(head.target, commitId);
  } else {
    await store.refs.set("HEAD", commitId);
  }

  // Update staging
  await store.staging.readTree(store.trees, treeId);

  return commitId;
}
