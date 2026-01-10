/**
 * Factory function for creating Git-compatible repositories
 *
 * Creates a Repository instance with all necessary stores configured
 * for either file-based or memory-based storage.
 */

import { CompressedRawStore } from "../binary/raw-store.compressed.js";
import { createFileRawStore } from "../binary/raw-store.files.js";
import { createFileVolatileStore } from "../binary/volatile-store.files.js";
import { GitBlobStore } from "../blob/blob-store.impl.js";
import { GitCommitStore } from "../commits/commit-store.impl.js";
import { GCController } from "../delta/gc-controller.js";
import { RawStoreWithDelta } from "../delta/raw-store-with-delta.js";
import { createInMemoryFilesApi, type FilesApi, joinPath } from "../files/index.js";
import type { ObjectId } from "../id/object-id.js";
import { GitObjectStoreImpl } from "../objects/object-store.impl.js";
import { PackDeltaStore } from "../pack/pack-delta-store.js";
import { createFileRefStore, type FileRefStore } from "../refs/ref-store.files.js";
import type { MemoryRefStore } from "../refs/ref-store.memory.js";
import { createRefsStructure, writeSymbolicRef } from "../refs/ref-writer.js";
import type { Repository, RepositoryConfig } from "../repository.js";
import { GitTagStore } from "../tags/tag-store.impl.js";
import { GitTreeStore } from "../trees/tree-store.impl.js";

/**
 * Options for creating a repository
 */
export interface CreateRepositoryOptions {
  /**
   * Whether to create the repository if it doesn't exist.
   * Defaults to true.
   */
  create?: boolean;

  /**
   * Default branch name (used when creating new repository).
   * Defaults to "main".
   */
  defaultBranch?: string;

  /**
   * Whether this is a bare repository.
   * Bare repositories have no working tree.
   */
  bare?: boolean;

  /**
   * Repository name (optional metadata).
   */
  name?: string;
}

/**
 * Git-compatible Repository implementation
 *
 * Composes all stores and provides lifecycle management.
 */
class GitRepository implements Repository {
  readonly config: RepositoryConfig;
  readonly gc: GCController;

  constructor(
    readonly objects: GitObjectStoreImpl,
    readonly commits: GitCommitStore,
    readonly trees: GitTreeStore,
    readonly blobs: GitBlobStore,
    readonly tags: GitTagStore,
    readonly refs: FileRefStore | MemoryRefStore,
    private readonly _isInitialized: boolean,
    config: RepositoryConfig,
    readonly deltaStorage: RawStoreWithDelta,
  ) {
    this.config = config;
    this.gc = new GCController(deltaStorage);
  }

  async initialize(): Promise<void> {
    if (this.refs.initialize) {
      await this.refs.initialize();
    }
  }

  async close(): Promise<void> {
    // No cleanup needed for current implementations
  }

  async isInitialized(): Promise<boolean> {
    return this._isInitialized;
  }

  /**
   * Get HEAD commit ID
   */
  async getHead(): Promise<ObjectId | undefined> {
    const ref = await this.refs.resolve("HEAD");
    return ref?.objectId;
  }

  /**
   * Get current branch name
   */
  async getCurrentBranch(): Promise<string | undefined> {
    const headRef = await this.refs.get("HEAD");
    if (headRef && "target" in headRef) {
      // Symbolic ref - extract branch name
      const target = headRef.target;
      if (target.startsWith("refs/heads/")) {
        return target.substring("refs/heads/".length);
      }
      return target;
    }
    return undefined;
  }
}

/**
 * Create a Git-compatible repository
 *
 * Creates a Repository with all necessary stores. Works with both
 * file-based storage (createNodeFilesApi) and in-memory storage (createInMemoryFilesApi).
 *
 * @param files FilesApi instance (defaults to in-memory storage)
 * @param gitDir Path to .git directory (relative to files root)
 * @param options Repository creation options
 * @returns Configured Repository instance
 *
 * @example
 * ```typescript
 * // In-memory repository
 * const repo = await createGitRepository();
 *
 * // File-based repository
 * import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";
 * import * as fs from "node:fs/promises";
 *
 * const files = createNodeFilesApi({ fs, rootDir: "/path/to/project" });
 * const repo = await createGitRepository(files, ".git");
 * ```
 */
export async function createGitRepository(
  files: FilesApi = createInMemoryFilesApi(),
  gitDir = ".git",
  options: CreateRepositoryOptions = {},
): Promise<GitRepository> {
  const { create = true, defaultBranch = "main", bare = false, name } = options;

  const objectsDir = joinPath(gitDir, "objects");
  const packDir = joinPath(objectsDir, "pack");

  // Loose object storage with Git-compatible compression
  const fileStore = createFileRawStore(files, objectsDir);
  const compressedStore = new CompressedRawStore(fileStore);

  // Pack-based delta storage for reading pack files
  const packDeltaStore = new PackDeltaStore({
    files,
    basePath: packDir,
  });

  // Combined raw store: loose objects + pack file support
  const rawStore = new RawStoreWithDelta({
    objects: compressedStore,
    deltas: packDeltaStore,
  });

  const volatileStore = createFileVolatileStore(files, joinPath(gitDir, "tmp"));
  const refStore = createFileRefStore(files, gitDir);

  // Create object store
  const objectStore = new GitObjectStoreImpl(volatileStore, rawStore);

  // Create typed stores
  const commits = new GitCommitStore(objectStore);
  const trees = new GitTreeStore(objectStore);
  const blobs = new GitBlobStore(objectStore);
  const tags = new GitTagStore(objectStore);

  // Check if repository exists
  let isInitialized = false;
  try {
    const headRef = await refStore.get("HEAD");
    isInitialized = headRef !== undefined;
  } catch {
    isInitialized = false;
  }

  // Initialize if needed
  if (create && !isInitialized) {
    // Create Git directory structure
    await files.mkdir(gitDir);
    await files.mkdir(objectsDir);
    await files.mkdir(joinPath(objectsDir, "pack"));
    await files.mkdir(joinPath(objectsDir, "info"));
    await createRefsStructure(files, gitDir);

    // Create HEAD pointing to default branch
    await writeSymbolicRef(files, gitDir, "HEAD", `refs/heads/${defaultBranch}`);

    // Create config file (basic Git config)
    const config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = ${bare}
`;
    await files.write(joinPath(gitDir, "config"), [new TextEncoder().encode(config)]);

    isInitialized = true;
  }

  const config: RepositoryConfig = {
    name,
    bare,
  };

  return new GitRepository(
    objectStore,
    commits,
    trees,
    blobs,
    tags,
    refStore,
    isInitialized,
    config,
    rawStore,
  );
}

/**
 * Check if FilesApi is memory-based
 *
 * This is a heuristic check - memory-based FilesApi doesn't persist
 * to disk and starts empty.
 */
async function _isMemoryFilesApi(files: FilesApi): Promise<boolean> {
  // Check if the root exists - memory-based starts with no directories
  try {
    const stats = await files.stats("/");
    // If root doesn't exist or we can't access it, assume memory-based
    if (!stats) {
      return true;
    }
    // Memory-based FilesApi typically has the root but nothing in it initially
    // However, this is not a reliable check. For now, we'll try to create
    // a test file and see if it persists.
    // Actually, let's use a simpler approach: check the internal type name
    return false; // Default to file-based for safety
  } catch {
    return true;
  }
}

export type { GitRepository };
