/**
 * SimpleHistory - A simple History-like implementation for testing
 *
 * Wraps individual stores into a History-compatible interface.
 * Used for creating WorkingCopy instances in tests without a full storage backend.
 *
 * Note: This uses the legacy store interfaces (BlobStore, TreeStore, etc.)
 * and is cast to History for use with MemoryWorkingCopy.
 */

import type {
  BlobStore,
  CommitStore,
  GitObjectStore,
  ObjectId,
  RefStore,
  TagStore,
  TreeStore,
} from "@statewalker/vcs-core";

/**
 * Options for creating a SimpleHistory
 */
export interface SimpleHistoryOptions {
  /** Object store for raw Git objects */
  objects: GitObjectStore;
  /** Blob storage */
  blobs: BlobStore;
  /** Tree storage */
  trees: TreeStore;
  /** Commit storage */
  commits: CommitStore;
  /** Tag storage */
  tags: TagStore;
  /** Reference storage */
  refs: RefStore;
}

/**
 * Simple in-memory History-like implementation for testing.
 *
 * This class provides a History-compatible interface using legacy store types.
 * It should be cast to History when used with MemoryWorkingCopy.
 */
export class SimpleHistory {
  readonly objects: GitObjectStore;
  readonly blobs: BlobStore;
  readonly trees: TreeStore;
  readonly commits: CommitStore;
  readonly tags: TagStore;
  readonly refs: RefStore;

  private _initialized = false;

  constructor(options: SimpleHistoryOptions) {
    this.objects = options.objects;
    this.blobs = options.blobs;
    this.trees = options.trees;
    this.commits = options.commits;
    this.tags = options.tags;
    this.refs = options.refs;
  }

  async initialize(): Promise<void> {
    if ("initialize" in this.refs && typeof this.refs.initialize === "function") {
      await this.refs.initialize();
    }
    this._initialized = true;
  }

  async close(): Promise<void> {
    // No resources to clean up
  }

  isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Collect reachable objects for pack creation
   */
  async *collectReachableObjects(
    wants: Set<string>,
    exclude: Set<string>,
  ): AsyncIterable<ObjectId> {
    const seen = new Set<string>(exclude);
    const queue: string[] = [...wants];

    while (queue.length > 0) {
      const oid = queue.shift();
      if (!oid || seen.has(oid)) continue;
      seen.add(oid);

      yield oid;

      // If it's a commit, add its tree and parents
      if (await this.commits.has(oid)) {
        const commit = await this.commits.loadCommit(oid);
        if (!seen.has(commit.tree)) {
          queue.push(commit.tree);
        }
        for (const parent of commit.parents) {
          if (!seen.has(parent)) {
            queue.push(parent);
          }
        }
      }

      // If it's a tree, add its entries
      if (await this.trees.has(oid)) {
        for await (const entry of this.trees.loadTree(oid)) {
          if (!seen.has(entry.id)) {
            queue.push(entry.id);
          }
        }
      }

      // If it's a tag, add its target
      if (await this.tags.has(oid)) {
        const tag = await this.tags.loadTag(oid);
        if (!seen.has(tag.object)) {
          queue.push(tag.object);
        }
      }
    }
  }
}

/**
 * Create a SimpleHistory from individual stores
 */
export function createSimpleHistory(options: SimpleHistoryOptions): SimpleHistory {
  return new SimpleHistory(options);
}
