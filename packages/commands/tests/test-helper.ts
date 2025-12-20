/**
 * Test helpers for @webrun-vcs/commands
 */

import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
} from "@webrun-vcs/store-mem";
import type { ObjectId, PersonIdent } from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";

import { Git, type GitStore } from "../src/index.js";

/**
 * Create an in-memory GitStore for testing.
 * Uses the new object-storage API with Git-compatible SHA-1 hashing.
 */
export function createTestStore(): GitStore {
  const stores = createMemoryObjectStores();
  return {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs: new MemoryRefStore(),
    staging: new MemoryStagingStore(),
    tags: stores.tags,
  };
}

/**
 * Create an initialized Git instance with an initial commit.
 *
 * Sets up:
 * - HEAD -> refs/heads/main
 * - Initial empty commit on main
 */
export async function createInitializedGit(): Promise<{
  git: Git;
  store: GitStore;
  initialCommitId: ObjectId;
}> {
  const store = createTestStore();
  const git = Git.wrap(store);

  // Create and store empty tree (storeTree returns the well-known empty tree ID)
  const emptyTreeId = await store.trees.storeTree([]);

  // Create initial commit
  const initialCommit = {
    tree: emptyTreeId,
    parents: [],
    author: testAuthor(),
    committer: testAuthor(),
    message: "Initial commit",
  };

  const initialCommitId = await store.commits.storeCommit(initialCommit);

  // Set up refs
  await store.refs.set("refs/heads/main", initialCommitId);
  await store.refs.setSymbolic("HEAD", "refs/heads/main");

  // Initialize staging with empty tree
  await store.staging.readTree(store.trees, emptyTreeId);

  return { git, store, initialCommitId };
}

/**
 * Create a test author identity.
 */
export function testAuthor(name = "Test Author", email = "test@example.com"): PersonIdent {
  return {
    name,
    email,
    timestamp: Math.floor(Date.now() / 1000),
    tzOffset: "+0000",
  };
}

/**
 * Add a file to the staging area and return its object ID.
 */
export async function addFile(store: GitStore, path: string, content: string): Promise<ObjectId> {
  // Store the content as a blob
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const objectId = await store.blobs.storeWithSize(
    data.length,
    (async function* () {
      yield data;
    })(),
  );

  // Add to staging
  const editor = store.staging.editor();
  editor.add({
    path,
    apply: () => ({
      path,
      mode: FileMode.REGULAR_FILE,
      objectId,
      stage: 0,
      size: data.length,
      mtime: Date.now(),
    }),
  });
  await editor.finish();

  return objectId;
}

/**
 * Create a commit with the given message and files.
 */
export async function createCommit(
  store: GitStore,
  message: string,
  files: Record<string, string> = {},
  parentIds?: ObjectId[],
): Promise<ObjectId> {
  // Add files to staging
  for (const [path, content] of Object.entries(files)) {
    await addFile(store, path, content);
  }

  // Write tree from staging
  const treeId = await store.staging.writeTree(store.trees);

  // Get parent(s)
  let parents: ObjectId[];
  if (parentIds !== undefined) {
    parents = parentIds;
  } else {
    try {
      const headRef = await store.refs.resolve("HEAD");
      parents = headRef?.objectId ? [headRef.objectId] : [];
    } catch {
      parents = [];
    }
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

  // Update staging to match new tree
  await store.staging.readTree(store.trees, treeId);

  return commitId;
}

/**
 * Remove a file from the staging area.
 */
export async function removeFile(store: GitStore, path: string): Promise<void> {
  const builder = store.staging.builder();
  // Add all entries except the one we want to remove
  for await (const entry of store.staging.listEntries()) {
    if (entry.path !== path) {
      builder.add(entry);
    }
  }
  await builder.finish();
}

/**
 * Collect async iterable to array.
 */
export async function toArray<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of iterable) {
    result.push(item);
  }
  return result;
}
