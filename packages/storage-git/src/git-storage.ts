/**
 * Main Git storage implementation
 *
 * Provides a unified interface for Git-compatible object storage,
 * combining all storage types (objects, trees, commits, tags) with refs.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/Repository.java
 */

import type { CompressionProvider } from "@webrun-vcs/common";
import type {
  CommitStorage,
  FileTreeStorage,
  ObjectId,
  ObjectStorage,
  TagStorage,
} from "@webrun-vcs/storage";
import type { FileApi } from "./file-api/index.js";
import { GitCommitStorage } from "./git-commit-storage.js";
import { GitFileTreeStorage } from "./git-file-tree-storage.js";
import { GitObjectStorage } from "./git-object-storage.js";
import { GitTagStorage } from "./git-tag-storage.js";
import {
  createRefDirectory,
  createRefsStructure,
  type RefDirectory,
  writeSymbolicRef,
} from "./refs/index.js";

/**
 * Options for creating a Git storage
 */
export interface GitStorageOptions {
  /** Whether to create directories if they don't exist */
  create?: boolean;
  /** Whether this is a bare repository */
  bare?: boolean;
  /** Default branch name (default: "main") */
  defaultBranch?: string;
}

/**
 * Combined Git storage providing all storage interfaces
 */
export interface GitStorageApi {
  /** Raw object storage */
  objects: ObjectStorage & GitObjectStorage;
  /** File tree storage */
  trees: FileTreeStorage;
  /** Commit storage */
  commits: CommitStorage;
  /** Tag storage */
  tags: TagStorage;
  /** Reference directory */
  refs: RefDirectory;
  /** Path to git directory */
  gitDir: string;
  /** Close all resources */
  close(): Promise<void>;
}

/**
 * Git storage implementation
 *
 * Provides complete Git-compatible storage with:
 * - Object storage (blobs, trees, commits, tags)
 * - Pack file support for reading
 * - Loose object storage for writing
 * - Reference management (branches, tags, HEAD)
 */
export class GitStorage implements GitStorageApi {
  readonly objects: GitObjectStorage;
  readonly trees: GitFileTreeStorage;
  readonly commits: GitCommitStorage;
  readonly tags: GitTagStorage;
  readonly refs: RefDirectory;
  readonly gitDir: string;

  private constructor(files: FileApi, compression: CompressionProvider, gitDir: string) {
    this.gitDir = gitDir;
    this.objects = new GitObjectStorage(files, compression, gitDir);
    this.trees = new GitFileTreeStorage(this.objects);
    this.commits = new GitCommitStorage(this.objects);
    this.tags = new GitTagStorage(this.objects);
    this.refs = createRefDirectory(files, gitDir);
  }

  /**
   * Open an existing Git repository
   *
   * @param files File system API
   * @param compression Compression provider
   * @param gitDir Path to .git directory
   */
  static async open(
    files: FileApi,
    compression: CompressionProvider,
    gitDir: string,
  ): Promise<GitStorage> {
    // Verify it's a valid git repository
    const headPath = files.join(gitDir, "HEAD");
    if (!(await files.exists(headPath))) {
      throw new Error(`Not a valid git repository: ${gitDir} (HEAD not found)`);
    }

    return new GitStorage(files, compression, gitDir);
  }

  /**
   * Create or open a Git repository
   *
   * @param files File system API
   * @param compression Compression provider
   * @param gitDir Path to .git directory
   * @param options Creation options
   */
  static async init(
    files: FileApi,
    compression: CompressionProvider,
    gitDir: string,
    options: GitStorageOptions = {},
  ): Promise<GitStorage> {
    const { create = true, defaultBranch = "main" } = options;

    const headPath = files.join(gitDir, "HEAD");
    const exists = await files.exists(headPath);

    if (exists) {
      // Open existing repository
      return GitStorage.open(files, compression, gitDir);
    }

    if (!create) {
      throw new Error(`Not a valid git repository: ${gitDir}`);
    }

    // Create new repository structure
    await files.mkdir(gitDir);
    await files.mkdir(files.join(gitDir, "objects"));
    await files.mkdir(files.join(gitDir, "objects", "pack"));
    await createRefsStructure(files, gitDir);

    // Create HEAD pointing to default branch
    await writeSymbolicRef(files, gitDir, "HEAD", `refs/heads/${defaultBranch}`);

    // Write config (minimal)
    const config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = ${options.bare ?? false}
`;
    await files.writeFile(files.join(gitDir, "config"), new TextEncoder().encode(config));

    return new GitStorage(files, compression, gitDir);
  }

  /**
   * Close all resources
   */
  async close(): Promise<void> {
    await this.objects.close();
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
    return this.refs.getCurrentBranch();
  }

  /**
   * Refresh pack files (call after gc or fetch)
   */
  async refresh(): Promise<void> {
    await this.objects.refresh();
  }
}

/**
 * Create a Git storage instance
 *
 * @param files File system API
 * @param compression Compression provider
 * @param gitDir Path to .git directory
 * @param options Creation/open options
 */
export async function createGitStorage(
  files: FileApi,
  compression: CompressionProvider,
  gitDir: string,
  options: GitStorageOptions = {},
): Promise<GitStorage> {
  if (options.create) {
    return GitStorage.init(files, compression, gitDir, options);
  }
  return GitStorage.open(files, compression, gitDir);
}
