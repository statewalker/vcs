/**
 * Git infrastructure setup — extracted from controllers/index.ts.
 *
 * Provides two modes:
 * - In-memory (existing): MemoryHistory + MemoryWorktree
 * - File-backed: FilesApi-based History + FileWorktree
 */

import { Git } from "@statewalker/vcs-commands";
import type { FilesApi, History, SerializationApi, Worktree } from "@statewalker/vcs-core";
import {
  CompressedRawStorage,
  createCommits,
  createFileRefStore,
  createGitObjectStore,
  createHistoryFromStores,
  createMemoryHistory,
  createRefsAdapter,
  createSimpleStaging,
  createTags,
  createTrees,
  DefaultSerializationApi,
  FileRawStorage,
  FileWorktree,
  GitBlobStore,
  joinPath,
  MemoryCheckout,
  MemoryWorkingCopy,
  MemoryWorktree,
} from "@statewalker/vcs-core";

import type { AppContext } from "./index.js";
import { setGit, setHistory, setSerializationApi, setWorkingCopy, setWorktree } from "./index.js";

function createSerializationApi(history: History): SerializationApi {
  return new DefaultSerializationApi({ history });
}

/**
 * Initialize in-memory Git infrastructure (existing behavior).
 */
export async function initializeGitInMemory(ctx: AppContext): Promise<void> {
  const history = createMemoryHistory();
  await history.initialize();
  await history.refs.setSymbolic("HEAD", "refs/heads/main");
  setHistory(ctx, history);

  const staging = createSimpleStaging();
  const checkout = new MemoryCheckout({
    staging,
    initialHead: { type: "symbolic", target: "refs/heads/main" },
  });

  const worktree = new MemoryWorktree({
    blobs: history.blobs,
    trees: history.trees,
  });
  setWorktree(ctx, worktree);

  const workingCopy = new MemoryWorkingCopy({
    history,
    checkout,
    worktree,
  });
  setWorkingCopy(ctx, workingCopy);

  const git = Git.fromWorkingCopy(workingCopy);
  setGit(ctx, git);

  const serialization = createSerializationApi(history);
  setSerializationApi(ctx, serialization);
}

/**
 * Initialize Git infrastructure from a FilesApi (file-backed storage).
 *
 * All objects (including blobs) go through a single GitObjectStore, matching
 * real Git's on-disk format where every object has a "type size\0" header.
 *
 * @param ctx Application context to populate
 * @param files FilesApi providing filesystem access
 * @returns Object with the storage label for UI display
 */
export async function initializeGitFromFiles(ctx: AppContext, files: FilesApi): Promise<void> {
  const gitDir = ".git";
  const objectsDir = joinPath(gitDir, "objects");

  // Detect whether .git already exists
  const gitDirExists = await files.exists(gitDir);

  if (!gitDirExists) {
    // Create .git structure
    await files.mkdir(gitDir);
    await files.mkdir(objectsDir);
    await files.mkdir(joinPath(objectsDir, "pack"));
    await files.mkdir(joinPath(gitDir, "refs"));
    await files.mkdir(joinPath(gitDir, "refs", "heads"));
    await files.mkdir(joinPath(gitDir, "refs", "tags"));

    const encoder = new TextEncoder();
    await files.write(joinPath(gitDir, "HEAD"), [encoder.encode("ref: refs/heads/main\n")]);
    await files.write(joinPath(gitDir, "config"), [
      encoder.encode("[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n"),
    ]);
  }

  // Build History from file components.
  // All objects (including blobs) go through the same GitObjectStore so they
  // are stored with Git headers ("type size\0content") in the shared
  // .git/objects directory — matching real Git's on-disk format.
  const looseStorage = new FileRawStorage(files, objectsDir);
  const compressedStorage = new CompressedRawStorage(looseStorage);
  const objects = createGitObjectStore(compressedStorage);
  const refStore = createFileRefStore(files, gitDir);

  const blobs = new GitBlobStore(objects);
  const trees = createTrees(objects);
  const commits = createCommits(objects);
  const tags = createTags(objects);
  const refs = createRefsAdapter(refStore);

  const history = createHistoryFromStores({ blobs, trees, commits, tags, refs });
  await history.initialize();
  setHistory(ctx, history);

  // Create file-backed worktree
  const worktree: Worktree = new FileWorktree({
    files,
    rootPath: "/",
    blobs: history.blobs,
    trees: history.trees,
    gitDir,
  });
  setWorktree(ctx, worktree as MemoryWorktree);

  // Create staging + checkout (in-memory — lightweight state)
  const staging = createSimpleStaging();
  const checkout = new MemoryCheckout({
    staging,
    initialHead: { type: "symbolic", target: "refs/heads/main" },
  });

  // Create WorkingCopy
  const workingCopy = new MemoryWorkingCopy({
    history,
    checkout,
    worktree,
  });
  setWorkingCopy(ctx, workingCopy);

  // Create Git porcelain API
  const git = Git.fromWorkingCopy(workingCopy);
  setGit(ctx, git);

  // Create SerializationApi
  const serialization = createSerializationApi(history);
  setSerializationApi(ctx, serialization);
}
