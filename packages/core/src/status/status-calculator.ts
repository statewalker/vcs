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

import type { ObjectId } from "../id/index.js";

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
 * Detailed conflict stage state.
 *
 * Describes the type of conflict based on the presence of entries
 * in base (stage 1), ours (stage 2), and theirs (stage 3).
 *
 * Based on JGit IndexDiff.StageState.
 */
export const StageState = {
  /** Deleted in both ours and theirs */
  BOTH_DELETED: "both-deleted",
  /** Added only in ours (not in base or theirs) */
  ADDED_BY_US: "added-by-us",
  /** Deleted in theirs, exists in base and ours */
  DELETED_BY_THEM: "deleted-by-them",
  /** Added only in theirs (not in base or ours) */
  ADDED_BY_THEM: "added-by-them",
  /** Deleted in ours, exists in base and theirs */
  DELETED_BY_US: "deleted-by-us",
  /** Added in both with different content */
  BOTH_ADDED: "both-added",
  /** Modified in both with different content */
  BOTH_MODIFIED: "both-modified",
} as const;

export type StageStateValue = (typeof StageState)[keyof typeof StageState];

/**
 * Determine StageState from presence of stage entries.
 *
 * Uses a bitmask approach like JGit's StageState.fromMask():
 * - Bit 0 (1): base exists (stage 1)
 * - Bit 1 (2): ours exists (stage 2)
 * - Bit 2 (4): theirs exists (stage 3)
 *
 * @param hasBase Whether base stage (1) exists
 * @param hasOurs Whether ours stage (2) exists
 * @param hasTheirs Whether theirs stage (3) exists
 * @returns The StageState value
 */
export function getStageState(
  hasBase: boolean,
  hasOurs: boolean,
  hasTheirs: boolean,
): StageStateValue {
  const mask = (hasBase ? 1 : 0) | (hasOurs ? 2 : 0) | (hasTheirs ? 4 : 0);

  switch (mask) {
    case 0b001: // base only
      return StageState.BOTH_DELETED;
    case 0b010: // ours only
      return StageState.ADDED_BY_US;
    case 0b011: // base + ours
      return StageState.DELETED_BY_THEM;
    case 0b100: // theirs only
      return StageState.ADDED_BY_THEM;
    case 0b101: // base + theirs
      return StageState.DELETED_BY_US;
    case 0b110: // ours + theirs
      return StageState.BOTH_ADDED;
    case 0b111: // all three
      return StageState.BOTH_MODIFIED;
    default:
      // 0b000 means no stages present, which shouldn't happen for conflicts
      throw new Error(`Invalid stage mask: ${mask}`);
  }
}

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

  /** Conflict type if conflicted */
  stageState?: StageStateValue;
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
