import type { FileModeValue } from "../common/files/index.js";
import type { ObjectId } from "../common/id/index.js";

/**
 * Represents a file or directory in the worktree (Part 2 of Three-Part Architecture).
 */
export interface WorktreeEntry {
  /** Relative path from repository root */
  path: string;
  /** Entry name (last path component) */
  name: string;
  /** File mode (regular, executable, symlink, directory) */
  mode: FileModeValue | number;
  /** File size in bytes (0 for directories) */
  size: number;
  /** Last modified time (milliseconds since epoch) */
  mtime: number;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Whether file is ignored by .gitignore */
  isIgnored: boolean;
}

/**
 * Options for worktree iteration.
 */
export interface WorktreeStoreOptions {
  /** Include ignored files (default: false) */
  includeIgnored?: boolean;
  /** Include directories in output (default: false) */
  includeDirectories?: boolean;
  /** Path prefix to filter (default: "" for all) */
  pathPrefix?: string;
  /** Custom ignore patterns (in addition to .gitignore) */
  ignorePatterns?: string[];
}

/**
 * WorktreeStore interface - user's checked-out files (Part 2 of Three-Part Architecture)
 *
 * Provides a platform-agnostic way to walk the filesystem
 * and compute content hashes for version control operations.
 *
 * Implementations may use different backends:
 * - Node.js filesystem
 * - Browser OPFS
 * - In-memory for testing
 */
export interface WorktreeStore {
  /**
   * Iterate all entries in worktree.
   *
   * Entries are yielded in sorted order (by path) for consistent results.
   * Directories are traversed recursively.
   *
   * @param options Iteration options
   * @returns AsyncIterable of worktree entries
   */
  walk(options?: WorktreeStoreOptions): AsyncIterable<WorktreeEntry>;

  /**
   * Get specific entry by path.
   *
   * @param path Relative path from repository root
   * @returns Entry or undefined if not found
   */
  getEntry(path: string): Promise<WorktreeEntry | undefined>;

  /**
   * Compute content hash for a file (without storing).
   *
   * Uses Git blob format: "blob <size>\0<content>"
   *
   * @param path Relative path from repository root
   * @returns Object ID (SHA-1 or SHA-256 hash)
   */
  computeHash(path: string): Promise<ObjectId>;

  /**
   * Read file content as stream.
   *
   * @param path Relative path from repository root
   * @returns AsyncIterable of content chunks
   */
  readContent(path: string): AsyncIterable<Uint8Array>;
}
