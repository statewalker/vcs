/**
 * Status interface for detecting changes between working tree, index, and HEAD.
 *
 * Provides Git-like status detection with three-way comparison:
 * - HEAD tree (last commit)
 * - Index (staging area)
 * - Working tree (filesystem)
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/StatusCommand.java
 */

import type { ObjectId } from "@webrun-vcs/core";

/**
 * File status categories.
 */
export const FileStatus = {
  /** File is unchanged */
  UNMODIFIED: "unmodified",
  /** File added to index, not in HEAD */
  ADDED: "added",
  /** File modified in working tree or index */
  MODIFIED: "modified",
  /** File deleted from working tree or index */
  DELETED: "deleted",
  /** File renamed (detected by content similarity) */
  RENAMED: "renamed",
  /** File copied (detected by content similarity) */
  COPIED: "copied",
  /** File not tracked */
  UNTRACKED: "untracked",
  /** File ignored by .gitignore */
  IGNORED: "ignored",
  /** File has merge conflict */
  CONFLICTED: "conflicted",
} as const;

export type FileStatusValue = (typeof FileStatus)[keyof typeof FileStatus];

/**
 * Detailed status for a single file.
 */
export interface FileStatusEntry {
  /** File path relative to repository root */
  path: string;

  /** Status in staging area (index vs HEAD) */
  indexStatus: FileStatusValue;

  /** Status in working tree (worktree vs index) */
  workTreeStatus: FileStatusValue;

  /** Original path if renamed/copied */
  originalPath?: string;

  /** Similarity percentage for rename/copy detection (0-100) */
  similarity?: number;

  /** Conflict stage info if conflicted */
  conflictStages?: ConflictStages;
}

/**
 * Conflict stages for merge conflicts.
 */
export interface ConflictStages {
  /** Stage 1: Common ancestor */
  base?: ObjectId;
  /** Stage 2: Our version */
  ours?: ObjectId;
  /** Stage 3: Their version */
  theirs?: ObjectId;
}

/**
 * Repository status summary.
 */
export interface RepositoryStatus {
  /** Current branch name (undefined if detached HEAD) */
  branch?: string;

  /** HEAD commit ID */
  head?: ObjectId;

  /** Upstream branch (if tracking configured) */
  upstream?: string;

  /** Commits ahead of upstream */
  ahead?: number;

  /** Commits behind upstream */
  behind?: number;

  /** All file status entries (only non-unmodified files) */
  files: FileStatusEntry[];

  /** Is the working tree clean? (no changes) */
  isClean: boolean;

  /** Does the index have changes staged for commit? */
  hasStaged: boolean;

  /** Does the working tree have unstaged changes? */
  hasUnstaged: boolean;

  /** Are there untracked files? */
  hasUntracked: boolean;

  /** Are there conflicts? */
  hasConflicts: boolean;
}

/**
 * Options for status calculation.
 */
export interface StatusOptions {
  /** Include ignored files in result (default: false) */
  includeIgnored?: boolean;

  /** Include untracked files in result (default: true) */
  includeUntracked?: boolean;

  /** Path prefix to filter status (default: "" for all) */
  pathPrefix?: string;

  /** Enable rename detection (default: false for performance) */
  detectRenames?: boolean;

  /** Similarity threshold for rename detection (default: 50) */
  renameThreshold?: number;
}

/**
 * Status calculator interface.
 */
export interface StatusCalculator {
  /**
   * Calculate full repository status.
   *
   * @param options Status calculation options
   * @returns Repository status with all file entries
   */
  calculateStatus(options?: StatusOptions): Promise<RepositoryStatus>;

  /**
   * Get status for a specific file.
   *
   * @param path File path relative to repository root
   * @returns File status entry or undefined if unmodified
   */
  getFileStatus(path: string): Promise<FileStatusEntry | undefined>;

  /**
   * Check if a file is modified (quick check).
   *
   * Uses stat info to avoid reading file content when possible.
   *
   * @param path File path relative to repository root
   * @returns True if file might be modified
   */
  isModified(path: string): Promise<boolean>;

  /**
   * Check if file content differs from index using hash comparison.
   *
   * This provides accurate modification detection for "racily clean" files
   * where mtime is too recent to trust. Use this when isModified() returns
   * true but you need certainty about whether content actually changed.
   *
   * @param path File path relative to repository root
   * @param indexObjectId Expected object ID from index
   * @returns True if content differs, false if identical
   */
  isContentModified(path: string, indexObjectId: ObjectId): Promise<boolean>;
}
