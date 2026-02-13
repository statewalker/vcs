/**
 * File-backed Git storage backend factory.
 *
 * Creates a History instance from a FilesApi with standard Git on-disk layout:
 * - Loose objects in `.git/objects/XX/XXXX...` (compressed with zlib)
 * - Refs in `.git/refs/`, HEAD in `.git/HEAD`
 * - All objects (including blobs) stored with Git headers for format compatibility
 */

import {
  CompressedRawStorage,
  createCommits,
  createFileRefStore,
  createGitObjectStore,
  createHistoryFromStores,
  createRefsAdapter,
  createTags,
  createTrees,
  FileRawStorage,
  type FilesApi,
  GitBlobStore,
  type GitObjectStore,
  type History,
  joinPath,
} from "@statewalker/vcs-core";

/**
 * Options for creating a file-backed Git storage backend.
 */
export interface GitFilesBackendOptions {
  /** FilesApi providing filesystem access */
  files: FilesApi;
  /** Path to .git directory relative to files root (default: ".git") */
  gitDir?: string;
  /** Whether to create the .git directory structure if it doesn't exist (default: false) */
  create?: boolean;
  /** Default branch name when creating a new repository (default: "main") */
  defaultBranch?: string;
}

/**
 * Result of creating a file-backed Git storage backend.
 */
export interface GitFilesBackendResult {
  /** History instance providing typed store access (blobs, trees, commits, tags, refs) */
  history: History;
  /** Low-level GitObjectStore for raw object access (headers, type codes) */
  objects: GitObjectStore;
}

/**
 * Create a file-backed Git storage backend.
 *
 * Wires up all storage layers from a single FilesApi:
 * 1. FileRawStorage → CompressedRawStorage → GitObjectStore (loose objects)
 * 2. GitBlobStore (blobs with Git headers in shared objects dir)
 * 3. Trees, Commits, Tags (from GitObjectStore)
 * 4. FileRefStore → Refs adapter
 * 5. Composed into History via createHistoryFromStores()
 *
 * @example
 * ```typescript
 * import { createInMemoryFilesApi } from "@statewalker/vcs-utils";
 * import { createGitFilesBackend } from "@statewalker/vcs-store-files";
 *
 * const files = createInMemoryFilesApi();
 * const { history, objects } = await createGitFilesBackend({
 *   files,
 *   create: true,
 * });
 * await history.initialize();
 *
 * const blobId = await history.blobs.store([new TextEncoder().encode("hello")]);
 * ```
 */
export async function createGitFilesBackend(
  options: GitFilesBackendOptions,
): Promise<GitFilesBackendResult> {
  const { files, gitDir = ".git", create = false, defaultBranch = "main" } = options;

  const objectsDir = joinPath(gitDir, "objects");

  if (create) {
    await createGitDirectoryStructure(files, gitDir, objectsDir, defaultBranch);
  }

  // Build storage layers.
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

  return { history, objects };
}

/**
 * Create standard .git directory structure.
 */
async function createGitDirectoryStructure(
  files: FilesApi,
  gitDir: string,
  objectsDir: string,
  defaultBranch: string,
): Promise<void> {
  await files.mkdir(gitDir);
  await files.mkdir(objectsDir);
  await files.mkdir(joinPath(objectsDir, "pack"));
  await files.mkdir(joinPath(gitDir, "refs"));
  await files.mkdir(joinPath(gitDir, "refs", "heads"));
  await files.mkdir(joinPath(gitDir, "refs", "tags"));

  const encoder = new TextEncoder();
  await files.write(joinPath(gitDir, "HEAD"), [
    encoder.encode(`ref: refs/heads/${defaultBranch}\n`),
  ]);
  await files.write(joinPath(gitDir, "config"), [
    encoder.encode(
      `[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = ${gitDir === "." ? "true" : "false"}\n`,
    ),
  ]);
}
