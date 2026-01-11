import type { FileModeValue } from "../common/files/index.js";
import type { ObjectId } from "../common/id/index.js";
import type { TreeStore } from "../trees/index.js";

/**
 * Merge stage for index entries.
 *
 * During normal state, all entries are at STAGE_0 (merged).
 * During merge conflicts, entries exist at stages 1-3:
 * - Stage 1: Common ancestor (base)
 * - Stage 2: Current branch (ours)
 * - Stage 3: Branch being merged (theirs)
 *
 * Following JGit DirCacheEntry stage constants.
 */
export const MergeStage = {
  /** Normal/merged state (stage 0) */
  MERGED: 0,
  /** Base version - common ancestor (stage 1) */
  BASE: 1,
  /** Our version - current branch (stage 2) */
  OURS: 2,
  /** Their version - being merged (stage 3) */
  THEIRS: 3,
} as const;

export type MergeStageValue = (typeof MergeStage)[keyof typeof MergeStage];

/**
 * A single entry in the staging area (index).
 *
 * Represents the cached state of a file to be committed.
 * Based on JGit's DirCacheEntry structure.
 *
 * Git index entry format (62 bytes header + variable path):
 * - ctime: 8 bytes (seconds + nanoseconds)
 * - mtime: 8 bytes (seconds + nanoseconds)
 * - dev: 4 bytes
 * - ino: 4 bytes
 * - mode: 4 bytes
 * - uid: 4 bytes
 * - gid: 4 bytes
 * - size: 4 bytes
 * - objectId: 20 bytes (SHA-1)
 * - flags: 2 bytes (stage bits + name length)
 * - path: variable (null-terminated)
 */
export interface StagingEntry {
  /** Repository-relative path (UTF-8, forward slashes) */
  readonly path: string;
  /** File mode (regular, executable, symlink, gitlink) */
  readonly mode: FileModeValue | number;
  /** Object ID of staged content */
  readonly objectId: ObjectId;
  /** Merge stage (0 for normal, 1-3 for conflicts) */
  readonly stage: MergeStageValue;
  /** File size in bytes (working tree size, may differ from blob due to filters) */
  readonly size: number;
  /** Last modification time (ms since epoch) */
  readonly mtime: number;
  /** Creation time (ms since epoch, optional) */
  readonly ctime?: number;
  /** Device ID (for change detection, optional) */
  readonly dev?: number;
  /** Inode number (for change detection, optional) */
  readonly ino?: number;
  /** Assume-valid flag (skip stat checking) */
  readonly assumeValid?: boolean;
  /** Intent-to-add flag (placeholder for empty files) */
  readonly intentToAdd?: boolean;
  /** Skip-worktree flag (sparse checkout) */
  readonly skipWorktree?: boolean;
}

/**
 * Options for creating a staging entry.
 */
export interface StagingEntryOptions {
  path: string;
  mode: FileModeValue | number;
  objectId: ObjectId;
  stage?: MergeStageValue;
  size?: number;
  mtime?: number;
  ctime?: number;
  dev?: number;
  ino?: number;
  assumeValid?: boolean;
  intentToAdd?: boolean;
  skipWorktree?: boolean;
}

/**
 * Abstract staging area (index) interface.
 *
 * Manages the staging area for commits, supporting:
 * - Adding/removing/updating entries
 * - Conflict resolution (merge stages)
 * - Tree generation for commits
 * - Reading/writing persistent storage
 *
 * Design patterns from JGit's DirCache:
 * - Entries are sorted by (path, stage) for binary search
 * - Builder pattern for bulk modifications (replaces entire index)
 * - Editor pattern for targeted updates (preserves unmodified entries)
 *
 * Isomorphic design:
 * - No Node.js dependencies
 * - Uses AsyncIterable for streaming
 * - Persistence through abstract read/write methods
 */
export interface StagingStore {
  // ============ Reading Operations ============

  /**
   * Get entry by path (stage 0 only - non-conflicted).
   *
   * @param path Repository-relative file path
   * @returns Entry or undefined if not found
   */
  getEntry(path: string): Promise<StagingEntry | undefined>;

  /**
   * Get entry by path and specific stage (for conflicts).
   *
   * @param path Repository-relative file path
   * @param stage Merge stage to look up
   * @returns Entry or undefined if not found
   */
  getEntryByStage(path: string, stage: MergeStageValue): Promise<StagingEntry | undefined>;

  /**
   * Get all entries for a path (all stages - useful for conflicts).
   *
   * @param path Repository-relative file path
   * @returns Array of entries (may be empty, up to 3 for conflicts)
   */
  getEntries(path: string): Promise<StagingEntry[]>;

  /**
   * Check if path exists in index (any stage).
   *
   * @param path Repository-relative file path
   * @returns True if path exists in index
   */
  hasEntry(path: string): Promise<boolean>;

  /**
   * Get total entry count.
   *
   * Note: Conflicted files may have up to 3 entries per path.
   *
   * @returns Total number of entries
   */
  getEntryCount(): Promise<number>;

  /**
   * Iterate all entries in sorted order (path, then stage).
   *
   * Entries are yielded in Git canonical order for consistent hashing.
   * Memory-efficient for large indexes.
   *
   * @returns AsyncIterable of all entries
   */
  listEntries(): AsyncIterable<StagingEntry>;

  /**
   * Iterate entries under a directory prefix.
   *
   * @param prefix Directory path prefix (without trailing slash)
   * @returns AsyncIterable of matching entries
   */
  listEntriesUnder(prefix: string): AsyncIterable<StagingEntry>;

  /**
   * Check if staging area has conflicts (any entry with stage > 0).
   *
   * @returns True if conflicts exist
   */
  hasConflicts(): Promise<boolean>;

  /**
   * Get paths with conflicts (unique paths with stage > 0).
   *
   * @returns AsyncIterable of conflicted paths
   */
  getConflictPaths(): AsyncIterable<string>;

  // ============ Writing Operations ============

  /**
   * Create a builder for bulk modifications.
   *
   * Builder collects entries and replaces entire index on finish().
   * Use when rebuilding index from scratch or making extensive changes.
   *
   * @returns New builder instance
   */
  builder(): StagingBuilder;

  /**
   * Create an editor for targeted modifications.
   *
   * Editor applies changes to specific paths while preserving
   * unmodified entries. More efficient for small updates.
   *
   * @returns New editor instance
   */
  editor(): StagingEditor;

  /**
   * Clear all entries from staging area.
   */
  clear(): Promise<void>;

  // ============ Tree Operations ============

  /**
   * Generate tree object(s) from current staging area.
   *
   * Creates tree objects for all directories and returns root tree ID.
   * Only stage 0 entries are included (conflicts must be resolved first).
   *
   * @param treeStore Tree storage to write trees to
   * @returns Root tree ObjectId
   * @throws Error if conflicts exist (stage > 0 entries)
   */
  writeTree(treeStore: TreeStore): Promise<ObjectId>;

  /**
   * Populate staging area from a tree.
   *
   * Replaces all entries with tree contents (recursively).
   * All entries are set to stage 0.
   *
   * @param treeStore Tree storage to read from
   * @param treeId Root tree ObjectId to load
   */
  readTree(treeStore: TreeStore, treeId: ObjectId): Promise<void>;

  // ============ Persistence ============

  /**
   * Load staging area from persistent storage.
   *
   * Reads and parses the index file (e.g., .git/index).
   * Clears current entries before loading.
   */
  read(): Promise<void>;

  /**
   * Save staging area to persistent storage.
   *
   * Serializes entries to Git index format and writes to storage.
   */
  write(): Promise<void>;

  /**
   * Check if staging area needs refresh from storage.
   *
   * Compares in-memory state timestamp with storage modification time.
   *
   * @returns True if storage has been modified since last read
   */
  isOutdated(): Promise<boolean>;

  /**
   * Get last modification time of loaded data.
   *
   * @returns Timestamp (ms since epoch) when index was last read
   */
  getUpdateTime(): number;
}

/**
 * Builder for bulk staging area modifications.
 *
 * The builder collects entries and replaces the entire index
 * when finish() is called. Entries can be added in any order
 * and are automatically sorted.
 *
 * Usage:
 * ```typescript
 * const builder = staging.builder();
 * builder.add({ path: "file.txt", mode: FileMode.REGULAR_FILE, objectId: "..." });
 * await builder.addTree(treeStore, treeId, ""); // Add from tree
 * await builder.finish();
 * await staging.write(); // Persist changes
 * ```
 */
export interface StagingBuilder {
  /**
   * Add a new entry.
   *
   * Duplicate (path, stage) pairs will cause finish() to fail.
   *
   * @param entry Entry options
   */
  add(entry: StagingEntryOptions): void;

  /**
   * Keep range of entries from existing index.
   *
   * Useful for partial rebuilds - copy entries from current index.
   *
   * @param startIndex Start position in current index
   * @param count Number of entries to keep
   */
  keep(startIndex: number, count: number): void;

  /**
   * Add all entries from a tree recursively.
   *
   * Walks tree and adds all blob entries with given prefix and stage.
   *
   * @param treeStore Tree storage to read from
   * @param treeId Tree ObjectId to walk
   * @param prefix Path prefix for entries (empty string for root)
   * @param stage Merge stage for all entries (default: MERGED)
   */
  addTree(
    treeStore: TreeStore,
    treeId: ObjectId,
    prefix: string,
    stage?: MergeStageValue,
  ): Promise<void>;

  /**
   * Finalize the builder.
   *
   * Sorts entries by (path, stage), validates constraints,
   * and replaces index content.
   *
   * @throws Error on duplicate entries or invalid stage combinations
   */
  finish(): Promise<void>;
}

/**
 * Edit operation base interface.
 *
 * Edit operations are applied by the StagingEditor during finish().
 */
export interface StagingEdit {
  /** Path this edit applies to */
  readonly path: string;

  /**
   * Apply this edit to an entry.
   *
   * @param entry Current entry (undefined for new paths)
   * @returns New entry, or undefined to delete
   */
  apply(entry: StagingEntry | undefined): StagingEntry | undefined;
}

/**
 * Editor for targeted staging area modifications.
 *
 * The editor applies changes to specific paths while
 * preserving unmodified entries. Changes are batched
 * and applied when finish() is called.
 *
 * Usage:
 * ```typescript
 * const editor = staging.editor();
 * editor.add(new UpdateStagingEntry("path/to/file", objectId, mode));
 * editor.add(new DeleteStagingEntry("old/file"));
 * await editor.finish();
 * await staging.write(); // Persist changes
 * ```
 */
export interface StagingEditor {
  /**
   * Add an edit operation.
   *
   * Edits are applied in path order during finish().
   *
   * @param edit Edit operation to add
   */
  add(edit: StagingEdit): void;

  /**
   * Finalize all edits.
   *
   * Applies edits to index in path order, preserving
   * entries not affected by edits.
   */
  finish(): Promise<void>;
}
