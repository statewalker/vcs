/**
 * Git file tree storage implementation
 *
 * Manages tree objects (directory snapshots) using Git's tree format.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TreeFormatter.java
 */

import type { FileTreeStorage, ObjectId, TreeEntry } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";
import { EMPTY_TREE_ID, findTreeEntry, parseTree, serializeTree } from "./format/tree-format.js";
import type { GitObjectStorage } from "./git-object-storage.js";

/**
 * Git file tree storage implementation
 *
 * Implements FileTreeStorage using Git's tree object format.
 */
export class GitFileTreeStorage implements FileTreeStorage {
  private readonly objectStorage: GitObjectStorage;

  constructor(objectStorage: GitObjectStorage) {
    this.objectStorage = objectStorage;
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
    return this.objectStorage.storeTyped(ObjectType.TREE, content);
  }

  /**
   * Load tree entries as a stream
   *
   * Entries are yielded in canonical sorted order.
   */
  loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    return this.loadTreeGenerator(id);
  }

  private async *loadTreeGenerator(id: ObjectId): AsyncGenerator<TreeEntry> {
    // Handle empty tree
    if (id === EMPTY_TREE_ID) {
      return;
    }

    const obj = await this.objectStorage.loadTyped(id);

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

    const obj = await this.objectStorage.loadTyped(treeId);

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

    return (await this.objectStorage.getInfo(id)) !== null;
  }

  /**
   * Get the empty tree ObjectId
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}
