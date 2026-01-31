/**
 * Test helpers for @statewalker/vcs-commands
 *
 * Provides utilities for testing Git commands with multiple storage backends.
 *
 * Migration:
 * - Old: Use `createInitializedGit()` with `store` property
 * - New: Use `createInitializedGit()` with `workingCopy` property
 *
 * For multi-backend testing, use `createInitializedGitFromFactory()` with
 * different backend factories.
 */

import type { ObjectId, PersonIdent, WorkingCopy } from "@statewalker/vcs-core";
import { FileMode, MemoryWorkingCopy } from "@statewalker/vcs-core";
import {
  createMemoryObjectStores,
  MemoryRefStore,
  MemoryStagingStore,
} from "@statewalker/vcs-store-mem";

import { Git, type GitStore } from "../src/index.js";
import {
  backends,
  defaultFactory,
  type GitStoreFactory,
  type GitStoreTestContext,
  memoryFactory,
  sqlFactory,
  type WorkingCopyFactory,
  type WorkingCopyTestContext,
} from "./backend-factories.js";
import { createMockWorktreeStore } from "./mock-worktree-store.js";
import { createSimpleHistoryStore } from "./simple-history-store.js";

// Re-export factory types and functions for convenience
export type { GitStoreFactory, GitStoreTestContext, WorkingCopyFactory, WorkingCopyTestContext };
export { backends, defaultFactory, memoryFactory, sqlFactory };

/**
 * Create an in-memory GitStore for testing (synchronous).
 * Uses the memory backend (fastest, no cleanup needed).
 *
 * @deprecated Use `createTestWorkingCopy()` instead.
 *
 * For multi-backend testing, use `createInitializedGitFromFactory()` instead.
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
 * Create an in-memory WorkingCopy for testing (synchronous).
 * Uses the memory backend (fastest, no cleanup needed).
 *
 * For multi-backend testing, use `createInitializedGitFromFactory()` instead.
 */
export function createTestWorkingCopy(): { workingCopy: WorkingCopy; store: GitStore } {
  const stores = createMemoryObjectStores();
  const refs = new MemoryRefStore();
  const staging = new MemoryStagingStore();

  // Create legacy GitStore for backward compatibility
  const store: GitStore = {
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    refs,
    staging,
    tags: stores.tags,
  };

  // Create HistoryStore wrapper
  const repository = createSimpleHistoryStore({
    objects: stores.objects,
    blobs: stores.blobs,
    trees: stores.trees,
    commits: stores.commits,
    tags: stores.tags,
    refs,
  });

  // Create mock WorktreeStore
  const worktree = createMockWorktreeStore();

  // Create WorkingCopy
  const workingCopy = new MemoryWorkingCopy({
    repository,
    worktree,
    staging,
  });

  return { workingCopy, store };
}

/**
 * Create a GitStore from a factory function.
 * Use this for multi-backend testing.
 *
 * @deprecated Use factories that return WorkingCopyTestContext instead.
 *
 * @param factory The factory function to use (defaults to memory)
 * @returns Test context with store and optional cleanup
 */
export async function createTestStoreFromFactory(
  factory: GitStoreFactory = defaultFactory,
): Promise<GitStoreTestContext> {
  return factory();
}

/**
 * Create a WorkingCopy from a factory function.
 * Use this for multi-backend testing.
 *
 * @param factory The factory function to use (defaults to memory)
 * @returns Test context with workingCopy, store (deprecated), and optional cleanup
 */
export async function createTestWorkingCopyFromFactory(
  factory: WorkingCopyFactory = defaultFactory,
): Promise<WorkingCopyTestContext> {
  return factory();
}

/**
 * Result of creating an initialized Git instance
 */
export interface InitializedGitResult {
  git: Git;
  /** The WorkingCopy instance (new architecture) */
  workingCopy: WorkingCopy;
  /**
   * @deprecated Use workingCopy instead. Provided for backward compatibility.
   */
  store: GitStore;
  initialCommitId: ObjectId;
  cleanup?: () => Promise<void>;
}

/**
 * Create an initialized Git instance with an initial commit.
 *
 * Sets up:
 * - HEAD -> refs/heads/main
 * - Initial empty commit on main
 *
 * Uses the default memory backend. For multi-backend testing,
 * use `createInitializedGitFromFactory()` instead.
 */
export async function createInitializedGit(): Promise<InitializedGitResult> {
  return createInitializedGitFromFactory(defaultFactory);
}

/**
 * Create an initialized Git instance from a factory.
 *
 * Sets up:
 * - HEAD -> refs/heads/main
 * - Initial empty commit on main
 *
 * @param factory The factory function to use
 * @returns Initialized Git with workingCopy, store (deprecated), and cleanup function
 */
export async function createInitializedGitFromFactory(
  factory: WorkingCopyFactory,
): Promise<InitializedGitResult> {
  const ctx = await factory();
  const { workingCopy, store } = ctx;
  // Use Git.wrap(store) for backward compatibility with tests that
  // manipulate refs directly via store.refs. Tests that want to use
  // the new WorkingCopy API can use Git.fromWorkingCopy() directly.
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

  return { git, workingCopy, store, initialCommitId, cleanup: ctx.cleanup };
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
  const objectId = await store.blobs.store([data]);

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
