import type { ObjectId } from "@webrun-vcs/vcs";

import type { MergeFailureReason } from "../errors/merge-errors.js";

/**
 * Status of a merge operation.
 *
 * Based on JGit's MergeResult.MergeStatus.
 */
export enum MergeStatus {
  /** Merge is a fast-forward (only HEAD moved) */
  FAST_FORWARD = "fast-forward",
  /** Fast-forward merge with squash (HEAD not moved, changes staged) */
  FAST_FORWARD_SQUASHED = "fast-forward-squashed",
  /** Merge was a no-op - already up to date */
  ALREADY_UP_TO_DATE = "already-up-to-date",
  /** Merge completed successfully (merge commit created) */
  MERGED = "merged",
  /** Merge completed but not committed (--no-commit) */
  MERGED_NOT_COMMITTED = "merged-not-committed",
  /** Merge was squashed (not committed, HEAD not updated) */
  MERGED_SQUASHED = "merged-squashed",
  /** Merge has conflicts that need to be resolved */
  CONFLICTING = "conflicting",
  /** Merge failed (preconditions not met) */
  FAILED = "failed",
  /** Merge aborted (e.g., FF_ONLY when not possible) */
  ABORTED = "aborted",
}

/**
 * Fast-forward merge mode.
 *
 * Based on JGit's MergeCommand.FastForwardMode.
 */
export enum FastForwardMode {
  /** Allow fast-forward when possible (default) */
  FF = "ff",
  /** Never fast-forward, always create merge commit */
  NO_FF = "no-ff",
  /** Only allow fast-forward, abort if not possible */
  FF_ONLY = "ff-only",
}

/**
 * Result of a merge operation.
 *
 * Based on JGit's MergeResult.
 */
export interface MergeResult {
  /** Status of the merge operation */
  readonly status: MergeStatus;
  /** New HEAD commit after merge (if successful) */
  readonly newHead?: ObjectId;
  /** Merge base commit (common ancestor) */
  readonly mergeBase?: ObjectId;
  /** Commits that were merged */
  readonly mergedCommits: ObjectId[];
  /** Paths with conflicts (for CONFLICTING status) */
  readonly conflicts?: string[];
  /** Paths that failed (for FAILED status) */
  readonly failingPaths?: Map<string, MergeFailureReason>;
  /** Informational message */
  readonly message?: string;
}

/**
 * Check if merge status represents a successful merge.
 */
export function isMergeSuccessful(status: MergeStatus): boolean {
  return (
    status === MergeStatus.FAST_FORWARD ||
    status === MergeStatus.FAST_FORWARD_SQUASHED ||
    status === MergeStatus.ALREADY_UP_TO_DATE ||
    status === MergeStatus.MERGED ||
    status === MergeStatus.MERGED_NOT_COMMITTED ||
    status === MergeStatus.MERGED_SQUASHED
  );
}
