/**
 * Test helpers for integration tests
 *
 * Provides utilities for testing Git operations across multiple storage backends.
 */

import { Git, type GitStore } from "@statewalker/vcs-commands";
import type { ObjectId, PersonIdent } from "@statewalker/vcs-core";
import { FileMode } from "@statewalker/vcs-core";

import {
  backends,
  defaultFactory,
  filesApiFactory,
  type GitStoreFactory,
  type GitStoreTestContext,
  memoryFactory,
  sqlFactory,
} from "./backend-factories.js";

// Re-export factory types and functions for convenience
export type { GitStoreFactory, GitStoreTestContext };
export { backends, defaultFactory, filesApiFactory, memoryFactory, sqlFactory };

/**
 * Result of creating an initialized Git instance
 */
export interface InitializedGitResult {
  git: Git;
  store: GitStore;
  initialCommitId: ObjectId;
  cleanup?: () => Promise<void>;
}

/**
 * Create an initialized Git instance from a factory.
 *
 * Sets up:
 * - HEAD -> refs/heads/main
 * - Initial empty commit on main
 *
 * @param factory The factory function to use
 * @returns Initialized Git with store and cleanup function
 */
export async function createInitializedGitFromFactory(
  factory: GitStoreFactory,
): Promise<InitializedGitResult> {
  const ctx = await factory();
  const store = ctx.store;
  const git = Git.wrap(store);

  // Create and store empty tree
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

  return { git, store, initialCommitId, cleanup: ctx.cleanup };
}

/**
 * Create an initialized Git instance (default memory backend).
 */
export async function createInitializedGit(): Promise<InitializedGitResult> {
  return createInitializedGitFromFactory(defaultFactory);
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
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const objectId = await store.blobs.store([data]);

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
 * Create a commit with the given message and optional files.
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

/**
 * Truncate object ID for display.
 */
export function shortId(id: string): string {
  return id.slice(0, 7);
}
