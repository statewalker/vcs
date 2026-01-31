/**
 * WorktreeStore - Legacy worktree interface
 *
 * @deprecated Use the Worktree interface from worktree.ts instead.
 * This file is kept for backward compatibility during migration.
 * Types are now defined in types.ts and re-exported here.
 */

import type { ObjectId } from "../../common/id/index.js";

// Re-export shared types from types.ts for backward compatibility
export type { WorktreeEntry, WorktreeStoreOptions } from "./types.js";

import type { WorktreeEntry, WorktreeStoreOptions } from "./types.js";

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
