/**
 * Main Git storage implementation
 *
 * Provides a unified interface for Git-compatible object storage,
 * combining all storage types (objects, trees, commits, tags) with refs.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/Repository.java
 */

import { type FilesApi, joinPath } from "@statewalker/webrun-files";
import {
  type CommitStore,
  type DeltaObjectStore,
  isSymbolicRef,
  type ObjectId,
  type RefStore,
  type TagStore,
  type TreeStore,
} from "@webrun-vcs/vcs";
import { GitCommitStorage } from "./git-commit-storage.js";
import { GitDeltaObjectStorage } from "./git-delta-object-storage.js";
import { GitFileTreeStorage } from "./git-file-tree-storage.js";
import { GitObjectStorage } from "./git-object-storage.js";
import { GitRawObjectStorage } from "./git-raw-objects-storage.js";
import { GitRefStorage } from "./git-ref-storage.js";
import { GitTagStorage } from "./git-tag-storage.js";
import { R_HEADS } from "./refs/ref-types.js";

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
  /** Raw object storage with delta support (stores/loads raw bytes, combines loose + pack) */
  rawStorage: DeltaObjectStore;
  /** Object storage (blob-centric interface) */
  objects: GitObjectStorage;
  /** File tree storage */
  trees: TreeStore;
  /** Commit storage */
  commits: CommitStore;
  /** Tag storage */
  tags: TagStore;
  /** Reference storage */
  refs: RefStore;
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
 * - Delta support (deltify, undeltify, repack)
 * - Loose object storage for writing
 * - Pack file storage for reading
 * - Reference management (branches, tags, HEAD)
 *
 * All typed storages use the rawStorage internally for storing
 * Git objects with proper headers.
 */
export class GitStorage implements GitStorageApi {
  readonly rawStorage: GitDeltaObjectStorage;
  readonly objects: GitObjectStorage;
  readonly trees: GitFileTreeStorage;
  readonly commits: GitCommitStorage;
  readonly tags: GitTagStorage;
  readonly refs: GitRefStorage;
  readonly gitDir: string;

  private constructor(files: FilesApi, gitDir: string) {
    this.gitDir = gitDir;
    // --------------------------------------------
    // Delta object storage combines loose + pack with delta support
    const looseStorage = new GitRawObjectStorage(files, gitDir);
    this.rawStorage = new GitDeltaObjectStorage(files, gitDir, looseStorage);
    // Refs storage
    this.refs = new GitRefStorage(files, gitDir);
    // --------------------------------------------
    // All typed storages use rawStorage internally
    this.objects = new GitObjectStorage(this.rawStorage);
    this.trees = new GitFileTreeStorage(this.rawStorage);
    this.commits = new GitCommitStorage(this.rawStorage);
    this.tags = new GitTagStorage(this.rawStorage);
  }

  /**
   * Open an existing Git repository
   *
   * @param files File system API
   * @param gitDir Path to .git directory
   */
  static async open(files: FilesApi, gitDir: string): Promise<GitStorage> {
    // Verify it's a valid git repository
    const headPath = joinPath(gitDir, "HEAD");
    const headStats = await files.stats(headPath);
    if (!headStats) {
      throw new Error(`Not a valid git repository: ${gitDir} (HEAD not found)`);
    }

    return new GitStorage(files, gitDir);
  }

  /**
   * Create or open a Git repository
   *
   * @param files File system API
   * @param gitDir Path to .git directory
   * @param options Creation options
   */
  static async init(
    files: FilesApi,
    gitDir: string,
    options: GitStorageOptions = {},
  ): Promise<GitStorage> {
    const { create = true, defaultBranch = "main" } = options;

    const headPath = joinPath(gitDir, "HEAD");
    const headStats = await files.stats(headPath);

    if (headStats) {
      // Open existing repository
      return GitStorage.open(files, gitDir);
    }

    if (!create) {
      throw new Error(`Not a valid git repository: ${gitDir}`);
    }

    // Create new repository structure
    await files.mkdir(gitDir);
    await files.mkdir(joinPath(gitDir, "objects"));
    await files.mkdir(joinPath(gitDir, "objects", "pack"));

    // Create refs structure and HEAD
    const refs = new GitRefStorage(files, gitDir);
    await refs.initialize();
    await refs.setSymbolic("HEAD", `refs/heads/${defaultBranch}`);

    // Write config (minimal)
    const config = `[core]
\trepositoryformatversion = 0
\tfilemode = true
\tbare = ${options.bare ?? false}
`;
    await files.write(joinPath(gitDir, "config"), [new TextEncoder().encode(config)]);

    return new GitStorage(files, gitDir);
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
    const head = await this.refs.get("HEAD");
    if (head === undefined) return undefined;

    if (isSymbolicRef(head)) {
      const target = head.target;
      if (target.startsWith(R_HEADS)) {
        return target.substring(R_HEADS.length);
      }
      return target;
    }

    // Detached HEAD
    return undefined;
  }

  /**
   * Refresh pack files (call after gc or fetch)
   *
   * Re-scans the objects/pack directory for new pack files.
   */
  async refresh(): Promise<void> {
    await this.rawStorage.refresh();
  }
}

/**
 * Create a Git storage instance
 *
 * @param files File system API
 * @param gitDir Path to .git directory
 * @param options Creation/open options
 */
export async function createGitStorage(
  files: FilesApi,
  gitDir: string,
  options: GitStorageOptions = {},
): Promise<GitStorage> {
  if (options.create) {
    return GitStorage.init(files, gitDir, options);
  }
  return GitStorage.open(files, gitDir);
}
