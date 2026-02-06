/**
 * Git tree store implementation
 *
 * Wraps GitObjectStore with tree serialization/deserialization.
 * Implements both TreeStore (legacy) and Trees (new) interfaces for compatibility.
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import type { TreeEntry } from "./tree-entry.js";
import { decodeTreeEntries, EMPTY_TREE_ID, encodeTreeEntries } from "./tree-format.js";
import type { TreeStore } from "./tree-store.js";
import type { Trees } from "./trees.js";

/**
 * Git tree store implementation
 *
 * Handles tree entry serialization (sorting, binary format)
 * and delegates storage to GitObjectStore.
 *
 * Implements both TreeStore (legacy) and Trees (new) interfaces.
 */
export class GitTreeStore implements TreeStore, Trees {
  constructor(private readonly objects: GitObjectStore) {}

  // ============ New Trees Interface ============

  /**
   * Store tree entries (new interface)
   */
  async store(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.objects.store("tree", encodeTreeEntries(entries));
  }

  /**
   * Load tree entries (new interface)
   *
   * Returns undefined if tree doesn't exist.
   */
  async load(id: ObjectId): Promise<AsyncIterable<TreeEntry> | undefined> {
    // Handle empty tree specially
    if (id === EMPTY_TREE_ID) {
      return (async function* () {})();
    }

    if (!(await this.objects.has(id))) {
      return undefined;
    }

    // Return a new async iterable that wraps the loadTree method
    const self = this;
    return (async function* () {
      yield* self.loadTree(id);
    })();
  }

  /**
   * Remove tree (new interface)
   */
  async remove(id: ObjectId): Promise<boolean> {
    // Git objects are content-addressed and generally immutable
    // This is implemented for interface compliance but shouldn't be used in practice
    return this.objects.remove(id);
  }

  // ============ Legacy TreeStore Interface ============

  /**
   * Store tree from entry stream (legacy)
   *
   * Entries are collected, sorted canonically, and serialized.
   */
  async storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.store(entries);
  }

  /**
   * Load tree entries as stream (legacy)
   *
   * Handles the well-known empty tree ID specially since it doesn't need
   * to be stored - it's a virtual constant representing an empty directory.
   */
  async *loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    // Handle empty tree specially - no need to look it up in storage
    if (id === EMPTY_TREE_ID) {
      return;
    }

    const [header, content] = await this.objects.loadWithHeader(id);
    try {
      if (header.type !== "tree") {
        throw new Error(`Object ${id} is not a tree (found type: ${header.type})`);
      }
      yield* decodeTreeEntries(content);
    } catch (err) {
      content?.return?.(void 0);
      throw err;
    }
  }

  // ============ Common Methods ============

  /**
   * Get specific entry from tree
   */
  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    for await (const entry of this.loadTree(treeId)) {
      if (entry.name === name) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Check if tree exists
   *
   * The empty tree is always considered to exist.
   */
  has(id: ObjectId): Promise<boolean> {
    if (id === EMPTY_TREE_ID) {
      return Promise.resolve(true);
    }
    return this.objects.has(id);
  }

  /**
   * Enumerate all tree object IDs
   */
  async *keys(): AsyncIterable<ObjectId> {
    for await (const id of this.objects.list()) {
      try {
        const header = await this.objects.getHeader(id);
        if (header.type === "tree") {
          yield id;
        }
      } catch {
        // Skip invalid objects
      }
    }
  }

  /**
   * Get well-known empty tree ID
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}
