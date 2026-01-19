/**
 * Transport test helpers for @statewalker/vcs-commands
 *
 * Provides test infrastructure for remote operations (fetch, push, clone, pull).
 * Uses an in-memory Git HTTP server for testing with createVcsRepositoryAccess.
 */

import type { ObjectId } from "@statewalker/vcs-core";
import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
  MemoryTagStore,
} from "@statewalker/vcs-store-mem";
import { createGitHttpServer } from "@statewalker/vcs-transport";
import { createVcsRepositoryAccess } from "@statewalker/vcs-transport-adapters/implementations";

import { Git, type GitStore } from "../src/index.js";
import { testAuthor } from "./test-helper.js";

/**
 * Create a GitStore with Git-format object storage for testing.
 *
 * All stores coordinate to use Git-format SHA-1 IDs, making this
 * compatible with createVcsRepositoryAccess.
 */
export function createGitFormatTestStore(): GitStore {
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
 * Test server setup result.
 */
export interface TestServer {
  /** The Git HTTP server fetch function (for Request objects) */
  fetch: (request: Request) => Promise<Response>;
  /** Mock fetch function that can replace globalThis.fetch */
  mockFetch: typeof globalThis.fetch;
  /** Base URL for the server */
  baseUrl: string;
  /** The server-side GitStore */
  serverStore: GitStore;
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
export function createTestServer(serverStore?: GitStore): TestServer {
  const store = serverStore ?? createGitFormatTestStore();

  // Use createVcsRepositoryAccess with high-level stores
  const repositoryAccess = createVcsRepositoryAccess({
    blobs: store.blobs,
    trees: store.trees,
    commits: store.commits,
    tags: store.tags,
    refs: store.refs,
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

  // Use createVcsRepositoryAccess with high-level stores
  const repositoryAccess = createVcsRepositoryAccess({
    blobs: store.blobs,
    trees: store.trees,
    commits: store.commits,
    tags: store.tags,
    refs: store.refs,
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
 * createVcsRepositoryAccess.
 */
export async function addFileAndCommit(
  store: GitStore,
  path: string,
  content: string,
  message: string,
): Promise<ObjectId> {
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

  // Write tree
  const treeId = await store.staging.writeTree(store.trees);

  // Get parent
  let parents: ObjectId[] = [];
  try {
    const headRef = await store.refs.resolve("HEAD");
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
