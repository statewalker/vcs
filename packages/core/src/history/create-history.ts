/**
 * Factory functions for creating History instances
 *
 * This module provides various ways to create History instances:
 * - createHistoryFromStores(): Compose from explicit store instances
 * - createMemoryHistory(): In-memory implementation for testing
 * - createHistoryFromBackend(): From StorageBackend (production use)
 */

import type { StorageBackend } from "../backend/storage-backend.js";
import { MemoryRawStorage } from "../storage/raw/memory-raw-storage.js";
import type { RawStorage } from "../storage/raw/raw-storage.js";
import { createBlobs } from "./blobs/blobs.impl.js";
import type { Blobs } from "./blobs/blobs.js";
import { createCommits } from "./commits/commits.impl.js";
import type { Commits } from "./commits/commits.js";
import { HistoryImpl, HistoryWithBackendImpl, HistoryWithOperationsImpl } from "./history.impl.js";
import type { History, HistoryWithBackend, HistoryWithOperations } from "./history.js";
import { createGitObjectStore } from "./objects/index.js";
import type { GitObjectStore } from "./objects/object-store.js";
import type { RefStore } from "./refs/ref-store.js";
import { createMemoryRefs, createRefsAdapter } from "./refs/refs.impl.js";
import type { Refs } from "./refs/refs.js";
import { createTags } from "./tags/tags.impl.js";
import type { Tags } from "./tags/tags.js";
import { createTrees } from "./trees/trees.impl.js";
import type { Trees } from "./trees/trees.js";

/**
 * Configuration for creating History with explicit stores
 */
export interface HistoryStoresConfig {
  /** Blob (file content) storage */
  blobs: Blobs;
  /** Tree (directory structure) storage */
  trees: Trees;
  /** Commit (version snapshot) storage */
  commits: Commits;
  /** Tag (annotated tag) storage */
  tags: Tags;
  /** Reference (branch/tag pointer) storage */
  refs: Refs;
}

/**
 * Configuration for creating History from low-level components
 */
export interface HistoryComponentsConfig {
  /**
   * Raw storage for blobs
   *
   * Blobs are stored directly in RawStorage without Git headers
   * for efficiency with large files.
   */
  blobStorage: RawStorage;

  /**
   * Git object store for structured types
   *
   * Trees, commits, and tags are stored as Git objects with
   * headers for transport compatibility.
   */
  objects: GitObjectStore;

  /**
   * Refs configuration
   *
   * Either use in-memory refs (for testing) or adapt an existing
   * RefStore implementation.
   */
  refs: { type: "memory" } | { type: "adapter"; refStore: RefStore };
}

/**
 * Configuration for creating History from a storage backend
 */
export interface HistoryBackendConfig {
  /** Storage backend providing all components */
  backend: StorageBackend;
}

/**
 * Create History from explicit store instances
 *
 * Use this when you have already-constructed store instances and want
 * to compose them into a History facade.
 *
 * @param config Store instances to compose
 * @returns History instance
 *
 * @example
 * ```typescript
 * const history = createHistoryFromStores({
 *   blobs: myBlobsImpl,
 *   trees: myTreesImpl,
 *   commits: myCommitsImpl,
 *   tags: myTagsImpl,
 *   refs: myRefsImpl,
 * });
 * ```
 */
export function createHistoryFromStores(config: HistoryStoresConfig): History {
  return new HistoryImpl(config.blobs, config.trees, config.commits, config.tags, config.refs);
}

/**
 * Create History from component configurations
 *
 * Builds store instances from lower-level components.
 * Use this when you have raw storage and want to construct stores.
 *
 * @param config Component configuration
 * @returns History instance
 *
 * @example
 * ```typescript
 * const history = createHistoryFromComponents({
 *   blobStorage: new MemoryRawStorage(),
 *   objects: createGitObjectStore(new MemoryRawStorage()),
 *   refs: { type: "memory" },
 * });
 * ```
 */
export function createHistoryFromComponents(config: HistoryComponentsConfig): History {
  const blobs = createBlobs(config.blobStorage);
  const trees = createTrees(config.objects);
  const commits = createCommits(config.objects);
  const tags = createTags(config.objects);

  let refs: Refs;
  if (config.refs.type === "memory") {
    refs = createMemoryRefs();
  } else {
    refs = createRefsAdapter(config.refs.refStore);
  }

  return new HistoryImpl(blobs, trees, commits, tags, refs);
}

/**
 * Create History from a storage backend (new API)
 *
 * This is the recommended factory for production use.
 * Returns HistoryWithOperations with flattened delta/serialization APIs.
 *
 * @param config Backend configuration
 * @returns HistoryWithOperations instance
 *
 * @example
 * ```typescript
 * const backend = await createGitFilesBackend({ path: ".git" });
 * const history = createHistoryWithOperations({ backend });
 *
 * // Use history for normal operations
 * const commit = await history.commits.load(commitId);
 *
 * // Use delta API for GC
 * history.delta.startBatch();
 * await history.delta.blobs.deltifyBlob(blobId, baseId, delta);
 * await history.delta.endBatch();
 *
 * // Use serialization for transport
 * const pack = history.serialization.createPack(objectIds);
 * ```
 */
export function createHistoryWithOperations(config: HistoryBackendConfig): HistoryWithOperations {
  const { backend } = config;

  // Create adapters from old store interfaces to new interfaces
  const blobs = new BlobsAdapter(backend.blobs);
  const trees = new TreesAdapter(backend.trees);
  const commits = new CommitsAdapter(backend.commits);
  const tags = new TagsAdapter(backend.tags);
  const refs = createRefsAdapter(backend.refs);

  return new HistoryWithOperationsImpl(
    blobs,
    trees,
    commits,
    tags,
    refs,
    backend.delta,
    backend.serialization,
    backend.capabilities,
    () => backend.initialize(),
    () => backend.close(),
  );
}

/**
 * Create History from a storage backend (legacy API)
 *
 * @deprecated Use createHistoryWithOperations instead for a cleaner API without
 * the redundant backend property. This function will be removed in a future version.
 *
 * This is the primary factory for production use.
 * The backend provides all necessary components through its store properties.
 *
 * Note: This creates adapters from old store interfaces (BlobStore, TreeStore, etc.)
 * to new interfaces (Blobs, Trees, etc.).
 *
 * @param config Backend configuration
 * @returns HistoryWithBackend instance with backend access
 *
 * @example
 * ```typescript
 * const backend = await createGitFilesBackend({ path: ".git" });
 * const history = createHistoryFromBackend({ backend });
 *
 * // Use history for normal operations
 * const commit = await history.commits.load(commitId);
 *
 * // Use backend for advanced operations
 * const pack = history.backend.serialization.createPack(objectIds);
 * ```
 */
export function createHistoryFromBackend(config: HistoryBackendConfig): HistoryWithBackend {
  const { backend } = config;

  // Create adapters from old store interfaces to new interfaces
  const blobs = new BlobsAdapter(backend.blobs);
  const trees = new TreesAdapter(backend.trees);
  const commits = new CommitsAdapter(backend.commits);
  const tags = new TagsAdapter(backend.tags);
  const refs = createRefsAdapter(backend.refs);

  return new HistoryWithBackendImpl(blobs, trees, commits, tags, refs, backend);
}

/**
 * Create in-memory History for testing
 *
 * Creates a completely in-memory History instance that can be used for
 * unit tests, integration tests, or any scenario where persistence
 * is not needed.
 *
 * @returns History instance with in-memory storage
 *
 * @example
 * ```typescript
 * const history = createMemoryHistory();
 * await history.initialize();
 *
 * const id = await history.blobs.store([new TextEncoder().encode("test")]);
 * const content = await history.blobs.load(id);
 *
 * await history.close();
 * ```
 */
export function createMemoryHistory(): History {
  const blobStorage = new MemoryRawStorage();
  const objectStorage = new MemoryRawStorage();
  const objects = createGitObjectStore(objectStorage);

  return createHistoryFromComponents({
    blobStorage,
    objects,
    refs: { type: "memory" },
  });
}

// --- Internal adapter functions for migration period ---

import type { ObjectId } from "../common/id/index.js";
import type { BlobStore } from "./blobs/blob-store.js";
import type { BlobContent } from "./blobs/blobs.js";
import type { AncestryOptions, Commit, CommitStore } from "./commits/commit-store.js";
import type { AnnotatedTag, TagStore } from "./tags/tag-store.js";
import type { Tag } from "./tags/tags.js";
import type { TreeEntry } from "./trees/tree-entry.js";
import { EMPTY_TREE_ID } from "./trees/tree-format.js";
import type { TreeStore } from "./trees/tree-store.js";

/**
 * Adapter that wraps old BlobStore to implement new Blobs interface
 *
 * @internal - For migration period only
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
 *
 * @internal - For migration period only
 */
class TreesAdapter implements Trees {
  constructor(private readonly treeStore: TreeStore) {}

  store(tree: TreeEntry[] | AsyncIterable<TreeEntry> | Iterable<TreeEntry>): Promise<ObjectId> {
    return this.treeStore.storeTree(tree);
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
    // This will be available after C5 migration
    return false;
  }

  async *keys(): AsyncIterable<ObjectId> {
    // TreeStore doesn't have a keys method
    // This will be available after C5 migration
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
 *
 * @internal - For migration period only
 */
class CommitsAdapter implements Commits {
  constructor(private readonly commitStore: CommitStore) {}

  store(commit: Commit): Promise<ObjectId> {
    return this.commitStore.storeCommit(commit);
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
 *
 * @internal - For migration period only
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
