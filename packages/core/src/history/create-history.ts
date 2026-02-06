/**
 * Factory functions for creating History instances
 *
 * Recommended patterns (from history-backend-factory.ts):
 * - createHistory(type, config): Create from registered backend type
 * - createGitFilesHistory(config): Git-files backed storage
 * - createMemoryHistoryWithOperations(): In-memory with operations
 *
 * Additional patterns in this module:
 * - createHistoryFromStores(): Compose from explicit store instances
 * - createMemoryHistory(): Basic in-memory (without operations)
 */

import {
  GitFilesStorageBackend,
  type GitFilesStorageBackendConfig,
} from "../backend/git-files-storage-backend.js";
import type {
  GitFilesBackendConfig,
  MemoryBackendConfig,
} from "../backend/history-backend-factory.js";
import { MemoryDeltaApi } from "../backend/memory-storage-backend.js";
import type { BackendCapabilities, StorageOperations } from "../backend/storage-backend.js";
import type { ObjectId } from "../common/id/index.js";
import { DefaultSerializationApi } from "../serialization/serialization-api.impl.js";
import { MemoryRawStorage } from "../storage/raw/memory-raw-storage.js";
import type { RawStorage } from "../storage/raw/raw-storage.js";
import type { BlobStore } from "./blobs/blob-store.js";
import { createBlobs } from "./blobs/blobs.impl.js";
import type { BlobContent, Blobs } from "./blobs/blobs.js";
import type { CommitStore, Commit as LegacyCommit } from "./commits/commit-store.js";
import { createCommits } from "./commits/commits.impl.js";
import type { Commit, Commits, WalkOptions } from "./commits/commits.js";
import { HistoryImpl, HistoryWithOperationsImpl } from "./history.impl.js";
import type { History, HistoryWithOperations } from "./history.js";
import { createGitObjectStore } from "./objects/index.js";
import type { GitObjectStore } from "./objects/object-store.js";
import type { RefStore } from "./refs/ref-store.js";
import { createMemoryRefs, createRefsAdapter } from "./refs/refs.impl.js";
import type { RefEntry, Refs, RefValue } from "./refs/refs.js";
import type { AnnotatedTag as LegacyTag, TagStore } from "./tags/tag-store.js";
import { createTags } from "./tags/tags.impl.js";
import type { Tag, Tags } from "./tags/tags.js";
import type { TreeEntry } from "./trees/tree-entry.js";
import type { TreeStore } from "./trees/tree-store.js";
import { createTrees } from "./trees/trees.impl.js";
import type { Tree, Trees } from "./trees/trees.js";

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
 * Interface for backend objects providing stores and operations
 *
 * Uses the new unified interfaces (Blobs, Trees, Commits, Tags, Refs).
 * External consumers should use the new factory functions instead:
 * - `createGitFilesHistory()` for Git-files backend
 * - `createMemoryHistoryWithOperations()` for in-memory backend
 *
 * @internal This interface is kept for internal use during the migration period.
 */
interface BackendWithStores extends StorageOperations {
  readonly blobs: Blobs;
  readonly trees: Trees;
  readonly commits: Commits;
  readonly tags: Tags;
  readonly refs: Refs;
}

/**
 * Interface for backends using legacy store interfaces
 *
 * @deprecated This is for backward compatibility with SQLStorageBackend.
 * New backends should implement BackendWithStores instead.
 *
 * @internal
 */
interface LegacyBackendWithStores extends StorageOperations {
  readonly blobs: BlobStore;
  readonly trees: TreeStore;
  readonly commits: CommitStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
}

/**
 * Union type for backend configurations
 *
 * Allows both new and legacy interfaces during migration.
 *
 * @internal
 */
type AnyBackendWithStores = BackendWithStores | LegacyBackendWithStores;

/**
 * Type guard to check if backend uses new interfaces
 */
function isNewBackend(backend: AnyBackendWithStores): backend is BackendWithStores {
  // New Blobs has load() returning Promise, old BlobStore.load() returns AsyncIterable directly
  // Check for the remove method which only exists on new interfaces
  return "remove" in backend.blobs;
}

// ============================================================================
// Legacy Store Adapters
// These wrap old store interfaces to provide new interface methods
// ============================================================================

/**
 * Adapter that wraps BlobStore to provide Blobs interface
 */
class BlobsAdapter implements Blobs {
  constructor(private readonly legacyStore: BlobStore) {}

  store(content: BlobContent | Iterable<Uint8Array>): Promise<ObjectId> {
    return this.legacyStore.store(content);
  }

  async load(id: ObjectId): Promise<BlobContent | undefined> {
    try {
      // Old interface returns AsyncIterable directly, new interface wraps in Promise
      const stream = this.legacyStore.load(id);
      // Verify the blob exists by trying to read the first chunk
      const reader = stream[Symbol.asyncIterator]();
      const first = await reader.next();
      if (first.done) {
        // Empty blob - return empty async iterable
        return (async function* () {})();
      }
      // Return an async iterable that yields the first chunk and then the rest
      const firstChunk = first.value;
      const restReader = reader;
      return (async function* () {
        yield firstChunk;
        let result = await restReader.next();
        while (!result.done) {
          yield result.value;
          result = await restReader.next();
        }
      })();
    } catch {
      return undefined;
    }
  }

  has(id: ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  size(id: ObjectId): Promise<number> {
    return this.legacyStore.size(id);
  }

  remove(id: ObjectId): Promise<boolean> {
    return this.legacyStore.delete(id);
  }

  keys(): AsyncIterable<ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps TreeStore to provide Trees interface
 */
class TreesAdapter implements Trees {
  constructor(private readonly legacyStore: TreeStore) {}

  store(tree: Tree): Promise<ObjectId> {
    return this.legacyStore.storeTree(tree as Iterable<TreeEntry>);
  }

  async load(id: ObjectId): Promise<AsyncIterable<TreeEntry> | undefined> {
    try {
      // Verify tree exists by checking has()
      const exists = await this.legacyStore.has(id);
      if (!exists) {
        return undefined;
      }
      // Return the async iterable from the legacy store
      return this.legacyStore.loadTree(id);
    } catch {
      return undefined;
    }
  }

  has(id: ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  getEntry(treeId: ObjectId, name: string): Promise<TreeEntry | undefined> {
    return this.legacyStore.getEntry(treeId, name);
  }

  getEmptyTreeId(): ObjectId {
    return this.legacyStore.getEmptyTreeId();
  }

  remove(_id: ObjectId): Promise<boolean> {
    // TreeStore doesn't have delete, but it's rarely used
    return Promise.resolve(false);
  }

  keys(): AsyncIterable<ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps CommitStore to provide Commits interface
 */
class CommitsAdapter implements Commits {
  constructor(private readonly legacyStore: CommitStore) {}

  store(commit: Commit): Promise<ObjectId> {
    return this.legacyStore.storeCommit(commit as LegacyCommit);
  }

  async load(id: ObjectId): Promise<Commit | undefined> {
    try {
      return await this.legacyStore.loadCommit(id);
    } catch {
      return undefined;
    }
  }

  has(id: ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  getParents(commitId: ObjectId): Promise<ObjectId[]> {
    return this.legacyStore.getParents(commitId);
  }

  async getTree(commitId: ObjectId): Promise<ObjectId | undefined> {
    try {
      return await this.legacyStore.getTree(commitId);
    } catch {
      return undefined;
    }
  }

  walkAncestry(startId: ObjectId | ObjectId[], options?: WalkOptions): AsyncIterable<ObjectId> {
    return this.legacyStore.walkAncestry(startId, options);
  }

  findMergeBase(commit1: ObjectId, commit2: ObjectId): Promise<ObjectId[]> {
    return this.legacyStore.findMergeBase(commit1, commit2);
  }

  isAncestor(ancestor: ObjectId, descendant: ObjectId): Promise<boolean> {
    return this.legacyStore.isAncestor(ancestor, descendant);
  }

  remove(_id: ObjectId): Promise<boolean> {
    // CommitStore doesn't have delete
    return Promise.resolve(false);
  }

  keys(): AsyncIterable<ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps TagStore to provide Tags interface
 */
class TagsAdapter implements Tags {
  constructor(private readonly legacyStore: TagStore) {}

  store(tag: Tag): Promise<ObjectId> {
    return this.legacyStore.storeTag(tag as LegacyTag);
  }

  async load(id: ObjectId): Promise<Tag | undefined> {
    try {
      return await this.legacyStore.loadTag(id);
    } catch {
      return undefined;
    }
  }

  has(id: ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  getTarget(tagId: ObjectId, peel?: boolean): Promise<ObjectId | undefined> {
    return this.legacyStore.getTarget(tagId, peel);
  }

  remove(_id: ObjectId): Promise<boolean> {
    // TagStore doesn't have delete
    return Promise.resolve(false);
  }

  keys(): AsyncIterable<ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps RefStore to provide Refs interface
 */
class LegacyRefsAdapter implements Refs {
  constructor(private readonly legacyStore: RefStore) {}

  get(name: string): Promise<RefValue | undefined> {
    return this.legacyStore.get(name);
  }

  resolve(name: string): Promise<import("./refs/ref-types.js").Ref | undefined> {
    return this.legacyStore.resolve(name);
  }

  has(name: string): Promise<boolean> {
    return this.legacyStore.has(name);
  }

  list(prefix?: string): AsyncIterable<RefEntry> {
    return this.legacyStore.list(prefix);
  }

  set(name: string, objectId: ObjectId): Promise<void> {
    return this.legacyStore.set(name, objectId);
  }

  setSymbolic(name: string, target: string): Promise<void> {
    return this.legacyStore.setSymbolic(name, target);
  }

  remove(name: string): Promise<boolean> {
    return this.legacyStore.delete(name);
  }

  compareAndSwap(
    name: string,
    expected: ObjectId | undefined,
    newValue: ObjectId,
  ): Promise<import("./refs/refs.js").RefUpdateResult> {
    return this.legacyStore.compareAndSwap(name, expected, newValue);
  }

  initialize(): Promise<void> {
    return this.legacyStore.initialize?.() ?? Promise.resolve();
  }

  optimize(): Promise<void> {
    return this.legacyStore.optimize?.() ?? Promise.resolve();
  }

  getReflog(name: string): Promise<import("./refs/reflog-types.js").ReflogReader | undefined> {
    return this.legacyStore.getReflog?.(name) ?? Promise.resolve(undefined);
  }

  packRefs(refNames: string[], options?: { all?: boolean; deleteLoose?: boolean }): Promise<void> {
    return this.legacyStore.packRefs?.(refNames, options) ?? Promise.resolve();
  }
}

/**
 * Configuration for creating History from a storage backend
 *
 * @deprecated Use the new factory pattern instead:
 * - `createHistory(type, config)` for registered backend types
 * - `createGitFilesHistory(config)` for Git-files backend
 * - `createMemoryHistoryWithOperations()` for in-memory backend
 *
 * @internal This interface is kept for internal use during the migration period.
 */
export interface HistoryBackendConfig {
  /** Storage backend providing all components */
  backend: AnyBackendWithStores;
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
 * Create History from a storage backend
 *
 * Returns HistoryWithOperations with flattened delta/serialization APIs.
 *
 * @deprecated Use the new factory pattern instead:
 * - `createHistory(type, config)` for registered backend types
 * - `createGitFilesHistory(config)` for Git-files backend
 * - `createMemoryHistoryWithOperations()` for in-memory backend
 *
 * Migration example:
 * ```typescript
 * // Old pattern (deprecated)
 * const backend = await createStorageBackend("git-files", { path: ".git" });
 * const history = createHistoryWithOperations({ backend });
 *
 * // New pattern (recommended)
 * const history = await createHistory("git-files", { path: ".git" });
 * // OR for specific backends:
 * const history = createGitFilesHistory(stores);
 * const history = createMemoryHistoryWithOperations();
 * ```
 *
 * @param config Backend configuration
 * @returns HistoryWithOperations instance
 *
 * @internal This function is kept for internal use during the migration period.
 * External consumers should use the new factory functions.
 */
export function createHistoryWithOperations(config: HistoryBackendConfig): HistoryWithOperations {
  const { backend } = config;

  // Detect if backend uses new or legacy interfaces
  // New interfaces have 'remove' method, legacy have 'delete'
  let blobs: Blobs;
  let trees: Trees;
  let commits: Commits;
  let tags: Tags;
  let refs: Refs;

  if (isNewBackend(backend)) {
    // New interfaces - use directly
    blobs = backend.blobs;
    trees = backend.trees;
    commits = backend.commits;
    tags = backend.tags;
    refs = backend.refs;
  } else {
    // Legacy interfaces - wrap with adapters
    blobs = new BlobsAdapter(backend.blobs);
    trees = new TreesAdapter(backend.trees);
    commits = new CommitsAdapter(backend.commits);
    tags = new TagsAdapter(backend.tags);
    refs = new LegacyRefsAdapter(backend.refs);
  }

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

/**
 * Create in-memory History with full operations support
 *
 * Returns HistoryWithOperations backed by in-memory storage,
 * suitable for testing and ephemeral operations that need
 * delta compression or serialization APIs.
 *
 * @param config Optional configuration
 * @returns HistoryWithOperations instance with in-memory storage
 *
 * @example
 * ```typescript
 * const history = createMemoryHistoryWithOperations();
 * await history.initialize();
 *
 * // Use history for normal operations
 * const id = await history.blobs.store([new TextEncoder().encode("test")]);
 *
 * // Use delta API for storage optimization
 * history.delta.startBatch();
 * await history.delta.blobs.deltifyBlob(targetId, baseId, delta);
 * await history.delta.endBatch();
 *
 * // Use serialization for pack files
 * const pack = history.serialization.createPack(objectIds);
 *
 * await history.close();
 * ```
 */
export function createMemoryHistoryWithOperations(
  _config: MemoryBackendConfig = {},
): HistoryWithOperations {
  // Create memory storage for blobs (separate from object storage)
  const blobStorage = new MemoryRawStorage();
  // Create memory object storage for trees, commits, tags
  const objectStorage = new MemoryRawStorage();
  const objects = createGitObjectStore(objectStorage);

  // Create typed stores using new interfaces
  const blobs = createBlobs(blobStorage);
  const trees = createTrees(objects);
  const commits = createCommits(objects);
  const tags = createTags(objects);
  const refs = createMemoryRefs();

  // Create base History for serialization API
  const history = new HistoryImpl(blobs, trees, commits, tags, refs);

  // Create delta API (memory backend doesn't track deltas by default)
  const delta = new MemoryDeltaApi(blobs, undefined);

  // Create serialization API using the History interface
  const serialization = new DefaultSerializationApi({ history });

  // Memory backend capabilities
  const capabilities: BackendCapabilities = {
    nativeBlobDeltas: false,
    randomAccess: true,
    atomicBatch: false,
    nativeGitFormat: false,
  };

  // Create HistoryWithOperations directly (no adapters needed)
  return new HistoryWithOperationsImpl(
    blobs,
    trees,
    commits,
    tags,
    refs,
    delta,
    serialization,
    capabilities,
    async () => {
      // No initialization needed for memory storage
    },
    async () => {
      // No cleanup needed for memory storage
    },
  );
}

/**
 * Create Git-files backed History with full operations support
 *
 * Factory function that creates HistoryWithOperations directly from
 * GitFilesStorageBackend configuration. This is the recommended way
 * to create production Git-compatible storage.
 *
 * Note: This requires the stores (blobs, trees, commits, tags, refs, packDeltaStore)
 * to be provided. For file-system-based stores, use @statewalker/vcs-store-fs
 * which provides createGitFilesBackend() that sets up all components.
 *
 * @param config GitFilesStorageBackend configuration with all stores
 * @returns HistoryWithOperations instance
 *
 * @example
 * ```typescript
 * // With pre-created stores (typical for Node.js environments)
 * const history = createGitFilesHistory({
 *   blobs: myBlobStore,
 *   trees: myTreeStore,
 *   commits: myCommitStore,
 *   tags: myTagStore,
 *   refs: myRefStore,
 *   packDeltaStore: myPackDeltaStore,
 * });
 * await history.initialize();
 *
 * // Use history for normal operations
 * const commit = await history.commits.load(commitId);
 *
 * // Use delta API for GC
 * history.delta.startBatch();
 * await history.delta.blobs.deltifyBlob(blobId, baseId, delta);
 * await history.delta.endBatch();
 * ```
 */
export function createGitFilesHistory(config: GitFilesStorageBackendConfig): HistoryWithOperations {
  const backend = new GitFilesStorageBackend(config);

  // Use new interfaces directly from backend (no adapters needed)
  const { blobs, trees, commits, tags, refs } = backend;

  // Create base History for serialization API
  const history = new HistoryImpl(blobs, trees, commits, tags, refs);
  const serialization = new DefaultSerializationApi({ history, blobDeltaApi: backend.delta.blobs });

  return new HistoryWithOperationsImpl(
    blobs,
    trees,
    commits,
    tags,
    refs,
    backend.delta,
    serialization,
    backend.capabilities,
    () => backend.initialize(),
    () => backend.close(),
  );
}

/**
 * Configuration for simplified Git-files history creation
 *
 * Used with registerGitFilesHistoryFactory() to enable
 * createHistory("git-files", config) pattern.
 */
export interface GitFilesHistoryConfig extends GitFilesBackendConfig {
  // Inherits path, create, readOnly from GitFilesBackendConfig
}
