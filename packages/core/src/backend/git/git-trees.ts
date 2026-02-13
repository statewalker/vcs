/**
 * Git tree store implementation
 *
 * Wraps GitObjectStore with tree serialization/deserialization.
 *
 * @module
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../../history/objects/object-store.js";
import type { TreeEntry } from "../../history/trees/tree-entry.js";
import {
  decodeTreeEntries,
  EMPTY_TREE_ID,
  encodeTreeEntries,
} from "../../history/trees/tree-format.js";
import type { Trees } from "../../history/trees/trees.js";

/**
 * Create an empty async iterable that yields no values.
 * Using an explicit object to prevent bundler from optimizing away.
 */
function emptyAsyncIterable<T>(): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      return {
        next(): Promise<IteratorResult<T>> {
          return Promise.resolve({ done: true, value: undefined as unknown as T });
        },
      };
    },
  };
}

/**
 * Git tree store implementation
 *
 * Wraps GitObjectStore to provide tree-specific operations.
 * Implements the Trees interface for use with History.
 */
export class GitTrees implements Trees {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store tree entries
   *
   * @param entries Tree entries to store
   * @returns ObjectId (SHA-1 hash)
   */
  store(entries: AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.objects.store("tree", encodeTreeEntries(entries));
  }

  /**
   * Load tree entries
   *
   * Returns undefined if tree doesn't exist.
   *
   * @param id Tree object ID
   * @returns Streaming tree entries if found, undefined otherwise
   */
  async load(id: ObjectId): Promise<AsyncIterable<TreeEntry> | undefined> {
    // Handle empty tree specially - return an empty async iterable
    // Note: Using explicit object with Symbol.asyncIterator to prevent bundler optimization
    if (id === EMPTY_TREE_ID) {
      return emptyAsyncIterable<TreeEntry>();
    }

    // Check if tree exists AND is the correct type
    if (!(await this.has(id))) {
      return undefined;
    }

    // Return a new async iterable that wraps the load method
    return this.createTreeIterable(id);
  }

  private createTreeIterable(id: ObjectId): AsyncIterable<TreeEntry> {
    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<TreeEntry> {
        const generator = self.loadTreeInternal(id);
        return generator[Symbol.asyncIterator]();
      },
    };
  }

  /**
   * Remove tree from storage
   *
   * @param id Tree object ID
   * @returns True if removed, false if didn't exist
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  /**
   * Load tree entries as stream (internal implementation)
   */
  private async *loadTreeInternal(id: ObjectId): AsyncIterable<TreeEntry> {
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
   *
   * @param treeId Tree object ID
   * @param name Entry name to find
   * @returns TreeEntry if found, undefined otherwise
   */
  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    for await (const entry of this.loadTreeInternal(treeId)) {
      if (entry.name === name) {
        return entry;
      }
    }
    return undefined;
  }

  /**
   * Check if tree exists and is actually a tree object
   *
   * The empty tree is always considered to exist.
   *
   * @param id Tree object ID
   * @returns True if tree exists and is a tree type
   */
  async has(id: ObjectId): Promise<boolean> {
    if (id === EMPTY_TREE_ID) {
      return true;
    }
    if (!(await this.objects.has(id))) {
      return false;
    }
    try {
      const header = await this.objects.getHeader(id);
      return header.type === "tree";
    } catch {
      return false;
    }
  }

  /**
   * Iterate over all tree object IDs
   *
   * @returns AsyncIterable of tree ObjectIds
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
   *
   * @returns The SHA-1 hash of an empty tree
   */
  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}

/**
 * Create a GitTrees instance
 *
 * @param objects GitObjectStore to wrap
 * @returns GitTrees instance
 */
export function createGitTrees(objects: GitObjectStore): Trees {
  return new GitTrees(objects);
}
