/**
 * Git tree store implementation
 *
 * Wraps GitObjectStore with tree serialization/deserialization.
 */

import type { ObjectId } from "../id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import type { TreeEntry } from "./tree-entry.js";
import { decodeTreeEntries, EMPTY_TREE_ID, encodeTreeEntries } from "./tree-format.js";
import type { TreeStore } from "./tree-store.js";

/**
 * Git tree store implementation
 *
 * Handles tree entry serialization (sorting, binary format)
 * and delegates storage to GitObjectStore.
 */
export class GitTreeStore implements TreeStore {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store tree from entry stream
   *
   * Entries are collected, sorted canonically, and serialized.
   */
  async storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.objects.store("tree", encodeTreeEntries(entries));
  }

  /**
   * Load tree entries as stream
   */
  async *loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
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
   */
  hasTree(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }

  /**
   * Get well-known empty tree ID
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}
