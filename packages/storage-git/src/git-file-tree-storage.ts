/**
 * Git file tree storage implementation
 *
 * Manages tree objects (directory snapshots) using Git's tree format.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TreeFormatter.java
 */

import type { ObjectId, TreeEntry, TreeStore } from "@webrun-vcs/core";
import { ObjectType } from "@webrun-vcs/core";
import { EMPTY_TREE_ID, findTreeEntry, parseTree, serializeTree } from "./format/tree-format.js";
import type { LooseObjectStorage } from "./git-delta-object-storage.js";
import { loadTypedObject, storeTypedObject } from "./typed-object-utils.js";

/**
 * Git file tree storage implementation
 *
 * Implements TreeStore using Git's tree object format.
 */
export class GitFileTreeStorage implements TreeStore {
  private readonly rawStorage: LooseObjectStorage;

  constructor(rawStorage: LooseObjectStorage) {
    this.rawStorage = rawStorage;
  }

  /**
   * Store a tree from a stream of entries
   *
   * Entries are consumed, sorted canonically, serialized, and stored.
   */
  async storeTree(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    // Collect entries
    const entryArray: TreeEntry[] = [];

    if (Symbol.asyncIterator in entries) {
      for await (const entry of entries as AsyncIterable<TreeEntry>) {
        entryArray.push(entry);
      }
    } else {
      for (const entry of entries as Iterable<TreeEntry>) {
        entryArray.push(entry);
      }
    }

    // Empty tree has a well-known hash
    if (entryArray.length === 0) {
      return EMPTY_TREE_ID;
    }

    // Serialize (includes sorting)
    const content = serializeTree(entryArray);

    // Store as tree object
    return storeTypedObject(this.rawStorage, ObjectType.TREE, content);
  }

  /**
   * Load tree entries as a stream
   *
   * Entries are yielded in canonical sorted order.
   */
  async *loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    // Handle empty tree
    if (id === EMPTY_TREE_ID) {
      return;
    }

    const obj = await loadTypedObject(this.rawStorage, id);

    if (obj.type !== ObjectType.TREE) {
      throw new Error(`Expected tree object, got type ${obj.type}`);
    }

    yield* parseTree(obj.content);
  }

  /**
   * Get a specific entry from a tree
   */
  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    // Handle empty tree
    if (treeId === EMPTY_TREE_ID) {
      return undefined;
    }

    const obj = await loadTypedObject(this.rawStorage, treeId);

    if (obj.type !== ObjectType.TREE) {
      throw new Error(`Expected tree object, got type ${obj.type}`);
    }

    return findTreeEntry(obj.content, name);
  }

  /**
   * Check if tree exists
   */
  async hasTree(id: ObjectId): Promise<boolean> {
    // Empty tree always exists
    if (id === EMPTY_TREE_ID) {
      return true;
    }

    return this.rawStorage.has(id);
  }

  /**
   * Get the empty tree ObjectId
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}
