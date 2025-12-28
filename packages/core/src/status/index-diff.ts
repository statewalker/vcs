/**
 * IndexDiff - Three-way diff between HEAD, index, and working tree.
 *
 * Provides detailed diff results for status calculation.
 * Based on JGit's IndexDiff class.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/IndexDiff.java
 */

import type { StageStateValue } from "./status-calculator.js";

/**
 * Three-way diff result between HEAD, index, and working tree.
 *
 * Each set contains file paths relative to the repository root.
 */
export interface IndexDiff {
  /** Files added to index (in index, not in HEAD) */
  readonly added: Set<string>;

  /** Files changed in index (different content from HEAD) */
  readonly changed: Set<string>;

  /** Files removed from index (in HEAD, not in index) */
  readonly removed: Set<string>;

  /** Files missing from working tree (in index, not on disk) */
  readonly missing: Set<string>;

  /** Files modified in working tree (different from index) */
  readonly modified: Set<string>;

  /** Files not tracked by git */
  readonly untracked: Set<string>;

  /** Untracked directories (optimization to skip traversal) */
  readonly untrackedFolders: Set<string>;

  /** Files with merge conflicts (multi-stage entries in index) */
  readonly conflicting: Set<string>;

  /** Detailed conflict stage states by path */
  readonly conflictingStageStates: Map<string, StageStateValue>;

  /** Ignored files not in index */
  readonly ignoredNotInIndex: Set<string>;

  /** Files that assume unchanged flag is set */
  readonly assumeUnchanged: Set<string>;
}

/**
 * Options for IndexDiff calculation.
 */
export interface IndexDiffOptions {
  /** Include ignored files in the diff (default: false) */
  includeIgnored?: boolean;

  /** Include untracked files in the diff (default: true) */
  includeUntracked?: boolean;

  /** Path filter - only consider files under this prefix */
  pathPrefix?: string;

  /** Respect assume-unchanged flag (default: true) */
  respectAssumeUnchanged?: boolean;
}

/**
 * Create an empty IndexDiff result.
 */
export function createEmptyIndexDiff(): IndexDiff {
  return {
    added: new Set(),
    changed: new Set(),
    removed: new Set(),
    missing: new Set(),
    modified: new Set(),
    untracked: new Set(),
    untrackedFolders: new Set(),
    conflicting: new Set(),
    conflictingStageStates: new Map(),
    ignoredNotInIndex: new Set(),
    assumeUnchanged: new Set(),
  };
}

/**
 * IndexDiff calculator interface.
 *
 * Implementations walk HEAD tree, index, and working tree simultaneously
 * to compute the three-way diff.
 */
export interface IndexDiffCalculator {
  /**
   * Calculate diff between HEAD, index, and working tree.
   *
   * @param options Calculation options
   * @returns The complete IndexDiff result
   */
  calculate(options?: IndexDiffOptions): Promise<IndexDiff>;
}
