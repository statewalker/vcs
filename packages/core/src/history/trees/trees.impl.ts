/**
 * Trees implementation using GitObjectStore
 *
 * This implementation wraps GitObjectStore for tree storage,
 * ensuring Git-compatible format and SHA-1 computation.
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import type { TreeEntry } from "./tree-entry.js";
import { decodeTreeEntries, EMPTY_TREE_ID, encodeTreeEntries } from "./tree-format.js";
import type { Tree, Trees } from "./trees.js";

/**
 * Storage-agnostic Trees implementation using GitObjectStore
 *
 * Stores trees in Git binary format for compatibility with
 * transport layer and SHA-1 computation.
 */
export class TreesImpl implements Trees {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store a tree
   *
   * Entries are collected, sorted canonically, and stored.
   *
   * @param tree Tree entries (any order)
   * @returns ObjectId of the stored tree
   */
  async store(tree: Tree): Promise<ObjectId> {
    return this.objects.store("tree", encodeTreeEntries(toIterable(tree)));
  }

  /**
   * Load tree entries
   *
   * Returns entries in canonical sorted order (as stored in Git).
   *
   * @param id Tree object ID
   * @returns AsyncIterable of tree entries in sorted order, or undefined if not found
   */
  async load(id: ObjectId): Promise<AsyncIterable<TreeEntry> | undefined> {
    // Handle empty tree specially - no need to look it up in storage
    if (id === EMPTY_TREE_ID) {
      return emptyAsyncIterable();
    }

    if (!(await this.objects.has(id))) {
      return undefined;
    }

    const [header, content] = await this.objects.loadWithHeader(id);
    if (header.type !== "tree") {
      // Not a tree, close the stream and return undefined
      await content?.return?.(void 0);
      return undefined;
    }

    return decodeTreeEntries(content);
  }

  /**
   * Check if tree exists
   *
   * The empty tree is always considered to exist.
   *
   * @param id Tree object ID
   * @returns True if tree exists
   */
  async has(id: ObjectId): Promise<boolean> {
    if (id === EMPTY_TREE_ID) {
      return true;
    }
    return this.objects.has(id);
  }

  /**
   * Remove a tree
   *
   * @param id Tree object ID
   * @returns True if tree was removed, false if it didn't exist
   */
  async remove(id: ObjectId): Promise<boolean> {
    if (id === EMPTY_TREE_ID) {
      // Can't remove the empty tree - it's virtual
      return false;
    }
    return this.objects.remove(id);
  }

  /**
   * Iterate over all stored tree IDs
   *
   * @returns AsyncIterable of all tree object IDs
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
   * Get a single entry from a tree by name
   *
   * @param treeId Tree object ID
   * @param name Entry name to look up
   * @returns Entry if found, undefined otherwise
   */
  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    const entries = await this.load(treeId);
    if (!entries) {
      return undefined;
    }

    for await (const entry of entries) {
      if (entry.name === name) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Get the well-known empty tree ID
   *
   * @returns SHA-1 of the empty tree (4b825dc...)
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}

/**
 * Helper function to convert Tree type to async iterable
 */
function toIterable(tree: Tree): AsyncIterable<TreeEntry> | Iterable<TreeEntry> {
  // Arrays are iterable
  if (Array.isArray(tree)) {
    return tree;
  }
  // Check for async iterable
  if (Symbol.asyncIterator in tree) {
    return tree as AsyncIterable<TreeEntry>;
  }
  // Sync iterable
  return tree as Iterable<TreeEntry>;
}

/**
 * Empty async iterable helper
 */
async function* emptyAsyncIterable(): AsyncIterable<TreeEntry> {
  // yields nothing
}

/**
 * Create a Trees instance backed by GitObjectStore
 *
 * @param objects GitObjectStore implementation to use for persistence
 * @returns Trees instance
 */
export function createTrees(objects: GitObjectStore): Trees {
  return new TreesImpl(objects);
}
