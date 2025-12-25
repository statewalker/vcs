/**
 * Tree storage interface
 */

import type { ObjectId } from "../id/index.js";
import type { TreeEntry } from "./tree-entry.js";

/**
 * File tree storage interface (streaming-first design)
 *
 * Manages tree objects (directory snapshots) with streaming support
 * for memory efficiency with large directories. Trees are stored as
 * Git-compatible tree objects.
 *
 * Git tree format (per entry):
 * - Mode: ASCII octal digits (e.g., "100644", "40000")
 * - Name: UTF-8 encoded, terminated by null byte
 * - Hash: Raw 20 bytes (SHA-1)
 *
 * Entries are canonically sorted by Git rules for consistent hashing.
 */
export interface TreeStore {
  /**
   * Store a tree from a stream of entries
   *
   * Entries are consumed, sorted canonically, and stored.
   * Entries can be provided in any order - they will be sorted before storage.
   *
   * Accepts both sync and async iterables for flexibility:
   * - Use Iterable<TreeEntry> when entries are already in memory (e.g., array)
   * - Use AsyncIterable<TreeEntry> when entries come from async sources
   *
   * @param entries Iterable or AsyncIterable of tree entries (any order)
   * @returns ObjectId of the stored tree
   */
  storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId>;

  /**
   * Load tree entries as a stream
   *
   * Entries are yielded in canonical sorted order (as stored in Git).
   * This is memory-efficient for large trees - entries are parsed on demand.
   *
   * @param id ObjectId of the tree
   * @returns AsyncIterable of tree entries in sorted order
   * @throws Error if tree not found or invalid format
   */
  loadTree(id: ObjectId): AsyncIterable<TreeEntry>;

  /**
   * Get a specific entry from a tree by name
   *
   * @param treeId ObjectId of the tree
   * @param name Entry name to find
   * @returns Tree entry or undefined if not found
   */
  getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined>;

  /**
   * Check if tree exists
   *
   * @param id ObjectId of the tree
   * @returns True if tree exists
   */
  hasTree(id: ObjectId): Promise<boolean>;

  /**
   * Get the empty tree ObjectId
   *
   * Git has well-known empty tree hashes:
   * - SHA-1: 4b825dc642cb6eb9a060e54bf8d69288fbee4904
   * - SHA-256: 6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321
   *
   * This is a pure function - no storage operation needed.
   *
   * @returns ObjectId of the empty tree
   */
  getEmptyTreeId(): ObjectId;
}
