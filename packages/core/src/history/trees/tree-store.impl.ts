/**
 * Git tree store implementation
 *
 * Wraps GitObjectStore with tree serialization/deserialization.
 */

import type { ObjectId } from "../../common/id/index.js";
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
