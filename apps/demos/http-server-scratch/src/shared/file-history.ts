/**
 * File-based History factory for the HTTP server demo.
 *
 * Creates a History instance backed by the filesystem with Git-compatible
 * loose object storage.
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
 * Extended History type that also exposes the GitObjectStore for low-level operations.
 *
 * This is needed for the HTTP server demo to access raw object data for
 * pack file building during push operations.
 */
export interface FileHistory extends History {
  /** Low-level object store for raw object access */
  readonly objects: GitObjectStore;
}

/**
 * Options for creating a file-based History
 */
export interface CreateFileHistoryOptions {
  /** FilesApi for filesystem operations */
  files: FilesApi;
  /** Path to .git directory (relative to files root). Use "." for bare repos */
  gitDir: string;
  /** Whether to create the repository if it doesn't exist */
  create?: boolean;
  /** Default branch name (only used when creating) */
  defaultBranch?: string;
}

/**
 * Create a file-based History instance.
 *
 * This creates a History backed by Git-compatible loose object storage
 * with compressed objects in the standard .git/objects layout.
 *
 * @param options Configuration options
 * @returns FileHistory instance with both History API and objects access
 *
 * @example
 * ```typescript
 * const files = createNodeFilesApi({ rootDir: "/path/to/repo" });
 * const history = await createFileHistory({
 *   files,
 *   gitDir: ".git",
 *   create: true,
 *   defaultBranch: "main",
 * });
 *
 * // Use History API
 * const blobId = await history.blobs.store([content]);
 *
 * // Use objects API for low-level access
 * const header = await history.objects.getHeader(id);
 * ```
 */
export async function createFileHistory(options: CreateFileHistoryOptions): Promise<FileHistory> {
  const { files, gitDir, create = false, defaultBranch = "main" } = options;

  const objectsDir = joinPath(gitDir, "objects");

  // Create compressed file storage for objects.
  // All objects (including blobs) go through the same GitObjectStore so they
  // are stored with Git headers in the shared .git/objects directory.
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

  // Initialize if creating
  if (create) {
    await files.mkdir(gitDir);
    await files.mkdir(objectsDir);
    await files.mkdir(joinPath(objectsDir, "pack"));
    await files.mkdir(joinPath(gitDir, "refs"));
    await files.mkdir(joinPath(gitDir, "refs", "heads"));
    await files.mkdir(joinPath(gitDir, "refs", "tags"));

    // Write HEAD
    const headContent = `ref: refs/heads/${defaultBranch}\n`;
    await files.write(joinPath(gitDir, "HEAD"), [new TextEncoder().encode(headContent)]);

    // Write basic config for bare repos
    const configContent = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = ${gitDir === "." ? "true" : "false"}
`;
    await files.write(joinPath(gitDir, "config"), [new TextEncoder().encode(configContent)]);
  }

  await history.initialize();

  // Return extended History with objects access
  return {
    ...history,
    objects,
  };
}

/**
 * Get HEAD commit ID from a History instance.
 *
 * Resolves HEAD -> branch -> commit ID.
 *
 * @param history History instance
 * @returns Commit ID or undefined if repository is empty
 */
export async function getHead(history: History): Promise<string | undefined> {
  const resolved = await history.refs.resolve("HEAD");
  return resolved?.objectId;
}
