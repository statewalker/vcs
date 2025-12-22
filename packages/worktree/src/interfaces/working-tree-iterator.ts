import type { FileModeValue, ObjectId } from "@webrun-vcs/core";

/**
 * Represents a file or directory in the working tree.
 */
export interface WorkingTreeEntry {
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
 * Options for working tree iteration.
 */
export interface WorkingTreeIteratorOptions {
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
 * Iterates over working tree files.
 *
 * Provides a platform-agnostic way to walk the filesystem
 * and compute content hashes for version control operations.
 */
export interface WorkingTreeIterator {
  /**
   * Iterate all entries in working tree.
   *
   * Entries are yielded in sorted order (by path) for consistent results.
   * Directories are traversed recursively.
   *
   * @param options Iteration options
   * @returns AsyncIterable of working tree entries
   */
  walk(options?: WorkingTreeIteratorOptions): AsyncIterable<WorkingTreeEntry>;

  /**
   * Get specific entry by path.
   *
   * @param path Relative path from repository root
   * @returns Entry or undefined if not found
   */
  getEntry(path: string): Promise<WorkingTreeEntry | undefined>;

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
