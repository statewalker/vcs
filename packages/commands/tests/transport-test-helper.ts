/**
 * Transport test helpers for @statewalker/vcs-commands
 *
 * Provides test infrastructure for remote operations (fetch, push, clone, pull).
 * Uses an in-memory Git HTTP server for testing with createVcsRepositoryAccess.
 */

import {
  type BlobStore,
  type CommitStore,
  type RefStore as CoreRefStore,
  DefaultSerializationApi,
  type GitObjectStore,
  type History,
  type HistoryStore,
  type HistoryWithOperations,
  isSymbolicRef,
  type ObjectId,
  type SerializationApi,
  type Staging,
  type TagStore,
  type TreeStore,
  type WorkingCopy,
  type Worktree,
} from "@statewalker/vcs-core";
import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
  MemoryTagStore,
} from "@statewalker/vcs-store-mem";
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters";

import { Git } from "../src/index.js";
import { testAuthor } from "./test-helper.js";

/**
 * Transport test store configuration.
 * Contains all the stores needed for transport operations.
 */
export interface TransportTestStores {
  /** Low-level Git object store for pack operations */
  objects: GitObjectStore;
  /** Blob storage */
  blobs: BlobStore;
  /** Tree storage */
  trees: TreeStore;
  /** Commit storage */
  commits: CommitStore;
  /** Reference storage */
  refs: CoreRefStore;
  /** Tag storage */
  tags: TagStore;
  /** Staging area */
  staging: Staging;
}

/**
 * Create transport test stores with Git-format object storage.
 *
 * All stores coordinate to use Git-format SHA-1 IDs, making this
 * compatible with createVcsRepositoryAccess.
 */
export function createTransportTestStores(): TransportTestStores {
  const objectStores = createMemoryObjectStores();
  return {
    blobs: objectStores.blobs,
    trees: objectStores.trees,
    commits: objectStores.commits,
    refs: new MemoryRefStore(),
    staging: new MemoryStagingStore(),
    tags: new MemoryTagStore(),
  };
}

/**
 * Create a minimal WorkingCopy from transport test stores.
 */
export function createWorkingCopyFromStores(stores: TransportTestStores): WorkingCopy {
  // Create a HistoryStore-like wrapper
  const repository = {
    objects: stores.objects,
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
    refs: stores.refs,
    config: {},
    async initialize() {},
    async close() {},
    async isInitialized() {
      return true;
    },
  } as unknown as HistoryStore;

  return {
    history: repository as unknown as History,
    checkout: {
      staging: stores.staging,
    } as never,
    worktree: {} as unknown as Worktree,
    stash: {} as never,
    config: {} as never,
    async getHead() {
      const ref = await stores.refs.resolve("HEAD");
      return ref?.objectId;
    },
    async getCurrentBranch() {
      const ref = await stores.refs.get("HEAD");
      if (ref && "target" in ref) {
        return ref.target.replace("refs/heads/", "");
      }
      return undefined;
    },
    async setHead() {},
    async isDetachedHead() {
      return false;
    },
    async getMergeState() {
      return undefined;
    },
    async getRebaseState() {
      return undefined;
    },
    async getCherryPickState() {
      return undefined;
    },
    async getRevertState() {
      return undefined;
    },
    async hasOperationInProgress() {
      return false;
    },
    async getStatus() {
      return {
        files: [],
        staged: [],
        unstaged: [],
        untracked: [],
        isClean: true,
        hasStaged: false,
        hasUnstaged: false,
        hasUntracked: false,
        hasConflicts: false,
      };
    },
  } as unknown as WorkingCopy;
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
  /** The server-side stores */
  serverStores: TransportTestStores;
  /** The server-side WorkingCopy */
  serverWorkingCopy: WorkingCopy;
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
    // Add duplex option when body is present (required by Node.js for streaming requests)
    const requestInit = init?.body ? { ...init, duplex: "half" } : init;
    const request = new Request(url, requestInit as RequestInit);
    return serverFetch(request);
  };
}

/**
 * Create a transport RefStore adapter from a vcs-core RefStore.
 */
function createTransportRefStoreAdapter(refs: CoreRefStore): TransportRefStore {
  return {
    async get(name: string): Promise<string | undefined> {
      const ref = await refs.resolve(name);
      return ref?.objectId;
    },

    async update(name: string, oid: string): Promise<void> {
      await refs.set(name, oid);
    },

    async listAll(): Promise<Iterable<[string, string]>> {
      const result: Array<[string, string]> = [];
      for await (const ref of refs.list()) {
        if (!isSymbolicRef(ref) && ref.objectId) {
          result.push([ref.name, ref.objectId]);
        }
      }
      return result;
    },

    async getSymrefTarget(name: string): Promise<string | undefined> {
      const ref = await refs.get(name);
      if (ref && isSymbolicRef(ref)) {
        return ref.target;
      }
      return undefined;
    },

    async isRefTip(oid: string): Promise<boolean> {
      for await (const ref of refs.list()) {
        if (!isSymbolicRef(ref) && ref.objectId === oid) {
          return true;
        }
      }
      return false;
    },
  };
}

/**
 * Create a mock HistoryWithOperations for transport tests.
 *
 * Wraps stores to provide the interface expected by createRepositoryFacade.
 */
function createMockHistoryWithOperations(
  stores: TransportTestStores,
  serialization: SerializationApi,
): HistoryWithOperations {
  // Create adapters for stores to match the new interfaces
  const blobsAdapter = {
    store: (content: Iterable<Uint8Array> | AsyncIterable<Uint8Array>) =>
      stores.blobs.store(content as AsyncIterable<Uint8Array>),
    load: (id: string) => stores.blobs.load(id),
    has: (id: string) => stores.blobs.has(id),
    remove: (id: string) => stores.blobs.delete(id),
    keys: () => stores.blobs.keys(),
    size: (id: string) => stores.blobs.size(id),
  };

  const treesAdapter = {
    store: (entries: unknown) => stores.trees.storeTree(entries as never),
    load: (id: string) => stores.trees.loadTree(id),
    has: async (id: string) => {
      try {
        const tree = stores.trees.loadTree(id);
        for await (const _ of tree) {
          break;
        }
        return true;
      } catch {
        return false;
      }
    },
    remove: async () => false,
    keys: async function* () {},
    getEntry: async () => undefined,
    getEmptyTreeId: () => "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  };

  const commitsAdapter = {
    store: (commit: unknown) => stores.commits.storeCommit(commit as never),
    load: async (id: string) => {
      try {
        return await stores.commits.loadCommit(id);
      } catch {
        return undefined;
      }
    },
    has: async (id: string) => {
      try {
        await stores.commits.loadCommit(id);
        return true;
      } catch {
        return false;
      }
    },
    remove: async () => false,
    keys: async function* () {},
    getParents: (id: string) => stores.commits.getParents(id),
    getTree: (id: string) => stores.commits.getTree(id),
    walkAncestry: (startId: string | string[], options?: unknown) =>
      stores.commits.walkAncestry(startId, options as never),
    findMergeBase: (c1: string, c2: string) => stores.commits.findMergeBase(c1, c2),
    isAncestor: (ancestor: string, descendant: string) =>
      stores.commits.isAncestor(ancestor, descendant),
  };

  const tagsAdapter = {
    store: (tag: unknown) => stores.tags.storeTag(tag as never),
    load: async (id: string) => {
      try {
        return await stores.tags.loadTag(id);
      } catch {
        return undefined;
      }
    },
    has: async (id: string) => {
      try {
        await stores.tags.loadTag(id);
        return true;
      } catch {
        return false;
      }
    },
    remove: async () => false,
    keys: async function* () {},
    getTarget: async (tagId: string) => {
      try {
        const tag = await stores.tags.loadTag(tagId);
        return tag.object;
      } catch {
        return undefined;
      }
    },
  };

  const refsAdapter = {
    get: (name: string) => stores.refs.get(name),
    set: (name: string, oid: string) => stores.refs.set(name, oid),
    setSymbolic: (name: string, target: string) => stores.refs.setSymbolic(name, target),
    delete: (name: string) => stores.refs.delete(name),
    list: () => stores.refs.list(),
    resolve: (name: string) => stores.refs.resolve(name),
  };

  return {
    blobs: blobsAdapter,
    trees: treesAdapter,
    commits: commitsAdapter,
    tags: tagsAdapter,
    refs: refsAdapter,
    serialization,
    delta: {} as never,
    capabilities: {
      nativeBlobDeltas: false,
      randomAccess: false,
      atomicBatch: false,
      nativeGitFormat: false,
    },
    async initialize() {},
    async close() {},
    collectReachableObjects: function* (wants: Set<string>, exclude: Set<string>) {
      // Simple implementation for tests - just yield wants that aren't in exclude
      for (const want of wants) {
        if (!exclude.has(want)) {
          yield want;
        }
      }
    },
  } as unknown as HistoryWithOperations;
}

/**
 * Create a test HTTP server for Git operations.
 *
 * @param serverStores Optional pre-configured server stores
 * @returns Test server configuration
 */
export function createTestServer(serverStores?: TransportTestStores): TestServer {
  const stores = serverStores ?? createTransportTestStores();
  const workingCopy = createWorkingCopyFromStores(stores);

  // Create serialization API for pack operations
  const serialization = new DefaultSerializationApi({
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
  });

  // Create a mock HistoryWithOperations for the repository facade
  const mockHistory = createMockHistoryWithOperations(stores, serialization);

  // Create repository facade for transport operations
  const repository = createRepositoryFacade({
    history: mockHistory,
  });

  // Create transport ref store adapter
  const refStore = createTransportRefStoreAdapter(stores.refs);

  const serverFetch = createFetchHandler({
    async resolveRepository(repoPath) {
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
    serverStores: stores,
    serverWorkingCopy: workingCopy,
    serverGit: Git.fromWorkingCopy(workingCopy),
  };
}

/**
 * Create an initialized test server with an initial commit.
 */
export async function createInitializedTestServer(): Promise<
  TestServer & { initialCommitId: string }
> {
  const stores = createTransportTestStores();
  const workingCopy = createWorkingCopyFromStores(stores);
  const git = Git.fromWorkingCopy(workingCopy);

  // Create and store empty tree
  const emptyTreeId = await stores.trees.storeTree([]);

  // Create initial commit
  const initialCommit = {
    tree: emptyTreeId,
    parents: [] as string[],
    author: testAuthor(),
    committer: testAuthor(),
    message: "Initial commit",
  };

  const initialCommitId = await stores.commits.storeCommit(initialCommit);

  // Set up refs
  await stores.refs.set("refs/heads/main", initialCommitId);
  await stores.refs.setSymbolic("HEAD", "refs/heads/main");

  // Initialize staging
  await stores.staging.readTree(stores.trees, emptyTreeId);

  // Create serialization API for pack operations
  const serialization = new DefaultSerializationApi({
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
  });

  // Create a mock HistoryWithOperations for the repository facade
  const mockHistory = createMockHistoryWithOperations(stores, serialization);

  // Create repository facade for transport operations
  const repository = createRepositoryFacade({
    history: mockHistory,
  });

  // Create transport ref store adapter
  const refStore = createTransportRefStoreAdapter(stores.refs);

  const serverFetch = createFetchHandler({
    async resolveRepository(repoPath) {
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
    serverStores: stores,
    serverWorkingCopy: workingCopy,
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
    // Add duplex option when body is present (required by Node.js for streaming requests)
    const requestInit = init?.body ? { ...init, duplex: "half" } : init;
    const request = new Request(url, requestInit as RequestInit);
    return server.fetch(request);
  };
}

/**
 * Add a file to a WorkingCopy and create a commit.
 *
 * This function stores objects in Git format, compatible with
 * transport operations.
 */
export async function addFileAndCommitWc(
  wc: WorkingCopy,
  path: string,
  content: string,
  message: string,
): Promise<ObjectId> {
  // Store blob
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const blobId = await wc.history.blobs.store([data]);

  // Update staging
  const staging = wc.checkout.staging as unknown as {
    createEditor?: () => { add(edit: unknown): void; finish(): Promise<void> };
    editor?: () => { add(edit: unknown): void; finish(): Promise<void> };
  };
  const editorFn = staging.createEditor ?? staging.editor;
  if (!editorFn) {
    throw new Error("Staging must have either createEditor() or editor() method");
  }
  const editor = editorFn.call(staging);
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

  // Write tree
  const treeId = await wc.checkout.staging.writeTree(wc.history.trees);

  // Get parent
  let parents: ObjectId[] = [];
  try {
    const headRef = await wc.history.refs.resolve("HEAD");
    if (headRef?.objectId) {
      parents = [headRef.objectId];
    }
  } catch {
    // No HEAD yet
  }

  // Create commit
  const commit = {
    tree: treeId,
    parents,
    author: testAuthor(),
    committer: testAuthor(),
    message,
  };

  const commitId = await wc.history.commits.storeCommit(commit);

  // Update HEAD
  const head = await wc.history.refs.get("HEAD");
  if (head && "target" in head) {
    await wc.history.refs.set(head.target, commitId);
  } else {
    await wc.history.refs.set("HEAD", commitId);
  }

  // Update staging
  await wc.checkout.staging.readTree(wc.history.trees, treeId);

  return commitId;
}

/**
 * Add a file to stores and create a commit.
 *
 * This function stores objects in Git format, compatible with
 * createVcsRepositoryAccess.
 */
export async function addFileAndCommit(
  stores: TransportTestStores,
  path: string,
  content: string,
  message: string,
): Promise<ObjectId> {
  // Store blob using BlobStore (handles Git header automatically)
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const blobId = await stores.blobs.store([data]);

  // Update staging - handle both Staging (createEditor) and StagingStore (editor) interfaces
  const staging = stores.staging as unknown as {
    createEditor?: () => { add(edit: unknown): void; finish(): Promise<void> };
    editor?: () => { add(edit: unknown): void; finish(): Promise<void> };
  };
  const editorFn = staging.createEditor ?? staging.editor;
  if (!editorFn) {
    throw new Error("Staging must have either createEditor() or editor() method");
  }
  const editor = editorFn.call(staging);
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

  // Write tree
  const treeId = await stores.staging.writeTree(stores.trees);

  // Get parent
  let parents: ObjectId[] = [];
  try {
    const headRef = await stores.refs.resolve("HEAD");
    if (headRef?.objectId) {
      parents = [headRef.objectId];
    }
  } catch {
    // No HEAD yet
  }

  // Create commit
  const commit = {
    tree: treeId,
    parents,
    author: testAuthor(),
    committer: testAuthor(),
    message,
  };

  const commitId = await stores.commits.storeCommit(commit);

  // Update HEAD
  const head = await stores.refs.get("HEAD");
  if (head && "target" in head) {
    await stores.refs.set(head.target, commitId);
  } else {
    await stores.refs.set("HEAD", commitId);
  }

  // Update staging
  await stores.staging.readTree(stores.trees, treeId);

  return commitId;
}
