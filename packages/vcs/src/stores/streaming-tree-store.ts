/**
 * Streaming tree store adapter
 *
 * Wraps GitObjectStore with tree serialization/deserialization.
 */

import { asAsyncIterable } from "../format/stream-utils.js";
import {
  computeTreeSize,
  decodeTreeEntries,
  EMPTY_TREE_ID,
  encodeTreeEntries,
} from "../format/tree-format.js";
import type { GitObjectStore } from "../interfaces/git-object-store.js";
import type { TreeEntry, TreeStore } from "../interfaces/tree-store.js";
import type { ObjectId } from "../interfaces/types.js";

/**
 * Streaming tree store implementation
 *
 * Handles tree entry serialization (sorting, binary format)
 * and delegates storage to GitObjectStore.
 */
export class StreamingTreeStore implements TreeStore {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store tree from entry stream
   *
   * Entries are collected, sorted canonically, and serialized.
   */
  async storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    const collected: TreeEntry[] = [];
    for await (const entry of asAsyncIterable(entries)) {
      collected.push(entry);
    }

    const size = await computeTreeSize(collected);
    return this.objects.storeWithSize("tree", size, encodeTreeEntries(collected));
  }

  /**
   * Load tree entries as stream
   */
  loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    return decodeTreeEntries(this.objects.load(id));
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
