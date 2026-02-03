/**
 * SimpleHistory - A simple History implementation for testing
 *
 * Wraps individual stores (BlobStore, TreeStore, etc.) into a History interface.
 * Used for creating WorkingCopy instances in tests without a full storage backend.
 *
 * Includes adapters that convert old store interfaces (BlobStore, TreeStore, etc.)
 * to new History interfaces (Blobs, Trees, etc.).
 */

import type {
  AncestryOptions,
  AnnotatedTag,
  BlobContent,
  BlobStore,
  Blobs,
  Commit,
  CommitStore,
  Commits,
  History,
  ObjectId,
  RefStore,
  Refs,
  Tag,
  TagStore,
  Tags,
  TreeEntry,
  TreeStore,
  Trees,
} from "@statewalker/vcs-core";
import { EMPTY_TREE_ID } from "@statewalker/vcs-core/history";

/**
 * Options for creating a SimpleHistory using new interface types
 */
export interface SimpleHistoryOptions {
  /** Blob storage */
  blobs: Blobs;
  /** Tree storage */
  trees: Trees;
  /** Commit storage */
  commits: Commits;
  /** Tag storage */
  tags: Tags;
  /** Reference storage */
  refs: Refs;
}

/**
 * Options for creating a SimpleHistory from old store interfaces
 */
export interface SimpleHistoryLegacyOptions {
  /** Blob storage (old interface) */
  blobs: BlobStore;
  /** Tree storage (old interface) */
  trees: TreeStore;
  /** Commit storage (old interface) */
  commits: CommitStore;
  /** Tag storage (old interface) */
  tags: TagStore;
  /** Reference storage (old interface) */
  refs: RefStore;
}

/**
 * Simple in-memory History implementation for testing.
 *
 * Wraps individual stores without requiring a full storage backend.
 * Does not support GC operations or collectReachableObjects.
 */
export class SimpleHistory implements History {
  readonly blobs: Blobs;
  readonly trees: Trees;
  readonly commits: Commits;
  readonly tags: Tags;
  readonly refs: Refs;

  private _initialized = false;

  constructor(options: SimpleHistoryOptions) {
    this.blobs = options.blobs;
    this.trees = options.trees;
    this.commits = options.commits;
    this.tags = options.tags;
    this.refs = options.refs;
  }

  async initialize(): Promise<void> {
    if (this.refs.initialize) {
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

  collectReachableObjects(_wants: Set<string>, _exclude: Set<string>): AsyncIterable<ObjectId> {
    // Simple implementation that doesn't support object collection
    // For full support, use createHistoryWithOperations()
    throw new Error("collectReachableObjects not supported in SimpleHistory");
  }
}

/**
 * Create a SimpleHistory from new interface stores
 */
export function createSimpleHistory(options: SimpleHistoryOptions): SimpleHistory {
  return new SimpleHistory(options);
}

/**
 * Create a SimpleHistory from old store interfaces.
 *
 * This function creates adapters that wrap the legacy store interfaces
 * (BlobStore, TreeStore, etc.) to the new History interfaces (Blobs, Trees, etc.).
 */
export function createSimpleHistoryFromLegacyStores(
  options: SimpleHistoryLegacyOptions,
): SimpleHistory {
  return new SimpleHistory({
    blobs: new BlobsAdapter(options.blobs),
    trees: new TreesAdapter(options.trees),
    commits: new CommitsAdapter(options.commits),
    tags: new TagsAdapter(options.tags),
    refs: new RefsAdapter(options.refs),
  });
}

// --- Adapter classes for legacy store interfaces ---

/**
 * Adapter that wraps old BlobStore to implement new Blobs interface
 */
class BlobsAdapter implements Blobs {
  constructor(private readonly blobStore: BlobStore) {}

  async store(content: BlobContent | Iterable<Uint8Array>): Promise<ObjectId> {
    // Convert to async iterable if needed
    if (Symbol.asyncIterator in content) {
      return this.blobStore.store(content as AsyncIterable<Uint8Array>);
    }
    // Wrap sync iterable
    return this.blobStore.store(toAsyncIterable(content as Iterable<Uint8Array>));
  }

  async load(id: ObjectId): Promise<BlobContent | undefined> {
    if (!(await this.blobStore.has(id))) {
      return undefined;
    }
    return this.blobStore.load(id);
  }

  /** Backward-compatible alias for store() */
  storeBlob(content: BlobContent | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.store(content);
  }

  /** Backward-compatible alias for load() - returns stream directly instead of Promise */
  loadBlob(id: ObjectId): AsyncIterable<Uint8Array> {
    return this.blobStore.load(id);
  }

  has(id: ObjectId): Promise<boolean> {
    return this.blobStore.has(id);
  }

  remove(id: ObjectId): Promise<boolean> {
    return this.blobStore.delete(id);
  }

  async *keys(): AsyncIterable<ObjectId> {
    yield* this.blobStore.keys();
  }

  size(id: ObjectId): Promise<number> {
    return this.blobStore.size(id);
  }
}

/**
 * Adapter that wraps old TreeStore to implement new Trees interface
 */
class TreesAdapter implements Trees {
  constructor(private readonly treeStore: TreeStore) {}

  store(tree: TreeEntry[] | AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.treeStore.storeTree(tree);
  }

  /** Backward-compatible alias for store() */
  storeTree(tree: TreeEntry[] | AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.store(tree);
  }

  async load(id: ObjectId): Promise<AsyncIterable<TreeEntry> | undefined> {
    if (id === EMPTY_TREE_ID) {
      return emptyAsyncIterable();
    }
    try {
      return this.treeStore.loadTree(id);
    } catch {
      return undefined;
    }
  }

  /** Backward-compatible alias for load() - returns stream directly instead of Promise */
  loadTree(id: ObjectId): AsyncIterable<TreeEntry> {
    return this.treeStore.loadTree(id);
  }

  async has(id: ObjectId): Promise<boolean> {
    if (id === EMPTY_TREE_ID) return true;
    try {
      // Try to load, if it works, it exists
      const tree = this.treeStore.loadTree(id);
      // Consume one item to trigger the load
      for await (const _ of tree) {
        break;
      }
      return true;
    } catch {
      return false;
    }
  }

  async remove(_id: ObjectId): Promise<boolean> {
    // TreeStore doesn't have a delete method
    return false;
  }

  async *keys(): AsyncIterable<ObjectId> {
    // TreeStore doesn't have a keys method
  }

  async getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    const entries = await this.load(treeId);
    if (!entries) return undefined;
    for await (const entry of entries) {
      if (entry.name === name) return entry;
    }
    return undefined;
  }

  getEmptyTreeId(): ObjectId {
    return EMPTY_TREE_ID;
  }
}

/**
 * Adapter that wraps old CommitStore to implement new Commits interface
 */
class CommitsAdapter implements Commits {
  constructor(private readonly commitStore: CommitStore) {}

  store(commit: Commit): Promise<ObjectId> {
    return this.commitStore.storeCommit(commit);
  }

  /** Backward-compatible alias for store() */
  storeCommit(commit: Commit): Promise<ObjectId> {
    return this.store(commit);
  }

  /** Backward-compatible alias for load() */
  loadCommit(id: ObjectId): Promise<Commit> {
    return this.commitStore.loadCommit(id);
  }

  async load(id: ObjectId): Promise<Commit | undefined> {
    try {
      return await this.commitStore.loadCommit(id);
    } catch {
      return undefined;
    }
  }

  async has(id: ObjectId): Promise<boolean> {
    try {
      await this.commitStore.loadCommit(id);
      return true;
    } catch {
      return false;
    }
  }

  async remove(_id: ObjectId): Promise<boolean> {
    // CommitStore doesn't have a delete method
    return false;
  }

  async *keys(): AsyncIterable<ObjectId> {
    // CommitStore doesn't have a keys method
  }

  getParents(commitId: ObjectId): Promise<ObjectId[]> {
    return this.commitStore.getParents(commitId);
  }

  getTree(commitId: ObjectId): Promise<ObjectId | undefined> {
    return this.commitStore.getTree(commitId);
  }

  walkAncestry(startId: ObjectId | ObjectId[], options?: AncestryOptions): AsyncIterable<ObjectId> {
    return this.commitStore.walkAncestry(startId, options);
  }

  findMergeBase(commit1: ObjectId, commit2: ObjectId): Promise<ObjectId[]> {
    return this.commitStore.findMergeBase(commit1, commit2);
  }

  isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean> {
    return this.commitStore.isAncestor(ancestor, descendant);
  }
}

/**
 * Adapter that wraps old TagStore to implement new Tags interface
 */
class TagsAdapter implements Tags {
  constructor(private readonly tagStore: TagStore) {}

  store(tag: Tag): Promise<ObjectId> {
    return this.tagStore.storeTag(tag as AnnotatedTag);
  }

  async load(id: ObjectId): Promise<Tag | undefined> {
    try {
      return await this.tagStore.loadTag(id);
    } catch {
      return undefined;
    }
  }

  async has(id: ObjectId): Promise<boolean> {
    try {
      await this.tagStore.loadTag(id);
      return true;
    } catch {
      return false;
    }
  }

  async remove(_id: ObjectId): Promise<boolean> {
    // TagStore doesn't have a delete method
    return false;
  }

  async *keys(): AsyncIterable<ObjectId> {
    // TagStore doesn't have a keys method
  }

  async getTarget(tagId: ObjectId, _peel?: boolean): Promise<ObjectId | undefined> {
    try {
      const tag = await this.tagStore.loadTag(tagId);
      return tag.object;
    } catch {
      return undefined;
    }
  }
}

/**
 * Adapter that wraps old RefStore to implement new Refs interface
 */
class RefsAdapter implements Refs {
  constructor(private readonly refStore: RefStore) {}

  async initialize(): Promise<void> {
    if ("initialize" in this.refStore && typeof this.refStore.initialize === "function") {
      await this.refStore.initialize();
    }
  }

  get(name: string): Promise<ObjectId | undefined> {
    return this.refStore.get(name);
  }

  async has(name: string): Promise<boolean> {
    const value = await this.refStore.get(name);
    return value !== undefined;
  }

  set(name: string, objectId: ObjectId): Promise<void> {
    return this.refStore.set(name, objectId);
  }

  remove(name: string): Promise<boolean> {
    return this.refStore.delete(name);
  }

  list(prefix?: string): AsyncIterable<string> {
    return this.refStore.list(prefix);
  }

  resolve(refOrId: string): Promise<{ name: string; objectId: ObjectId } | undefined> {
    return this.refStore.resolve(refOrId);
  }

  setSymbolic(name: string, target: string): Promise<void> {
    return this.refStore.setSymbolic(name, target);
  }

  getSymbolic(name: string): Promise<string | undefined> {
    return this.refStore.getSymbolic(name);
  }

  isSymbolic(name: string): Promise<boolean> {
    return this.refStore.isSymbolic(name);
  }
}

/**
 * Helper to convert sync iterable to async iterable
 */
async function* toAsyncIterable(iter: Iterable<Uint8Array>): AsyncIterable<Uint8Array> {
  for (const item of iter) {
    yield item;
  }
}

/**
 * Empty async iterable helper
 */
async function* emptyAsyncIterable(): AsyncIterable<TreeEntry> {
  // yields nothing
}
