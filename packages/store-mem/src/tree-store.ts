/**
 * In-memory TreeStore implementation
 *
 * Provides a pure in-memory tree storage for testing and ephemeral operations.
 * No persistence - data is lost when the instance is garbage collected.
 *
 * Unlike file-based implementations, this does not use Git format serialization.
 * Trees are stored directly as JavaScript arrays for simplicity and performance.
 */

import type { ObjectId, TreeEntry, TreeStore } from "@statewalker/vcs-core";
import { FileMode } from "@statewalker/vcs-core";

/**
 * Well-known empty tree SHA-1 hash
 */
const EMPTY_TREE_ID = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/**
 * Compare tree entries for canonical Git sorting.
 *
 * Git sorts tree entries by name, treating directories as if they
 * had a trailing '/'. This ensures consistent hashing.
 */
function compareTreeEntries(a: TreeEntry, b: TreeEntry): number {
  const aName = a.mode === FileMode.TREE ? `${a.name}/` : a.name;
  const bName = b.mode === FileMode.TREE ? `${b.name}/` : b.name;
  return aName < bName ? -1 : aName > bName ? 1 : 0;
}

/**
 * Simple hash function for generating deterministic object IDs.
 *
 * This is not cryptographically secure, but provides consistent
 * content-addressable IDs for in-memory use.
 */
function computeTreeHash(entries: TreeEntry[]): ObjectId {
  // Build a string representation of the tree
  const content = entries.map((e) => `${e.mode.toString(8)} ${e.name}\0${e.id}`).join("");

  // Simple hash (FNV-1a inspired)
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  // Convert to hex and pad to 40 characters
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `tree${hex}${"0".repeat(28)}`;
}

/**
 * In-memory TreeStore implementation.
 */
export class MemoryTreeStore implements TreeStore {
  private trees = new Map<ObjectId, TreeEntry[]>();

  /**
   * Store a tree from a stream of entries.
   *
   * Entries are consumed, sorted canonically, and stored.
   */
  async storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    // Collect entries
    const entryArray: TreeEntry[] = [];

    if (Symbol.asyncIterator in entries) {
      for await (const entry of entries as AsyncIterable<TreeEntry>) {
        entryArray.push({ ...entry });
      }
    } else {
      for (const entry of entries as Iterable<TreeEntry>) {
        entryArray.push({ ...entry });
      }
    }

    // Empty tree has well-known hash
    if (entryArray.length === 0) {
      return EMPTY_TREE_ID;
    }

    // Sort entries canonically
    entryArray.sort(compareTreeEntries);

    // Compute hash
    const id = computeTreeHash(entryArray);

    // Store (deduplication by content)
    if (!this.trees.has(id)) {
      this.trees.set(id, entryArray);
    }

    return id;
  }

  /**
   * Load tree entries as a stream.
   *
   * Entries are yielded in canonical sorted order.
   */
  async *loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    // Empty tree
    if (id === EMPTY_TREE_ID) {
      return;
    }

    const entries = this.trees.get(id);
    if (!entries) {
      throw new Error(`Tree ${id} not found`);
    }

    for (const entry of entries) {
      yield { ...entry };
    }
  }

  /**
   * Get a specific entry from a tree.
   */
  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    // Empty tree
    if (treeId === EMPTY_TREE_ID) {
      return undefined;
    }

    const entries = this.trees.get(treeId);
    if (!entries) {
      throw new Error(`Tree ${treeId} not found`);
    }

    // Binary search would be more efficient for large trees,
    // but linear search is fine for typical use cases
    const found = entries.find((e) => e.name === name);
    return found ? { ...found } : undefined;
  }

  /**
   * Check if tree exists.
   */
  async hasTree(id: ObjectId): Promise<boolean> {
    // Empty tree always exists
    if (id === EMPTY_TREE_ID) {
      return true;
    }

    return this.trees.has(id);
  }

  /**
   * Get the empty tree ObjectId.
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}
