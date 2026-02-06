/**
 * SQL Storage Backend
 *
 * StorageBackend implementation using SQL database.
 * Provides all three APIs (StructuredStores, DeltaApi, SerializationApi)
 * with transaction support for atomic operations.
 *
 * ## New Pattern (Recommended)
 *
 * Use the factory pattern for new code:
 * - `SQLHistoryFactory` - Implements HistoryBackendFactory interface
 * - Returns HistoryWithOperations directly
 *
 * ## Legacy Pattern (Deprecated)
 *
 * The `SQLStorageBackend` class is deprecated.
 * Use `SQLHistoryFactory` instead.
 */

import {
  type BackendCapabilities,
  type BaseBackendConfig,
  type BlobStore,
  type Blobs,
  type CommitStore,
  type Commits,
  DefaultSerializationApi,
  type HistoryBackendFactory,
  type HistoryWithOperations,
  HistoryWithOperationsImpl,
  type RefStore,
  type Refs,
  type SerializationApi,
  type StorageOperations,
  type TagStore,
  type Tags,
  type TreeStore,
  type Trees,
} from "@statewalker/vcs-core";
import { SQLCommitStore } from "./commit-store.js";
import type { DatabaseClient } from "./database-client.js";
import { initializeSchema } from "./migrations/index.js";
import { SqlNativeBlobStoreImpl } from "./native/sql-native-blob-store.js";
import { SQLRefStore } from "./ref-store.js";
import { SqlDeltaApi } from "./sql-delta-api.js";
import { SQLTagStore } from "./tag-store.js";
import { SQLTreeStore } from "./tree-store.js";

// ============================================================================
// Legacy Store Adapters
// These wrap SQL stores (using legacy interfaces) to provide new interfaces.
// This is temporary until SQL stores are migrated to implement new interfaces directly.
// ============================================================================

/**
 * Adapter that wraps BlobStore to provide Blobs interface
 * @internal
 */
class BlobsAdapter implements Blobs {
  constructor(private readonly legacyStore: BlobStore) {}

  store(
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.store(content);
  }

  load(
    id: import("@statewalker/vcs-core").ObjectId,
  ): Promise<AsyncIterable<Uint8Array> | undefined> {
    return this.legacyStore.load(id);
  }

  has(id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  size(id: import("@statewalker/vcs-core").ObjectId): Promise<number> {
    return this.legacyStore.size(id);
  }

  remove(id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return this.legacyStore.delete(id);
  }

  keys(): AsyncIterable<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps TreeStore to provide Trees interface
 * @internal
 */
class TreesAdapter implements Trees {
  constructor(private readonly legacyStore: TreeStore) {}

  store(
    tree: import("@statewalker/vcs-core").Tree,
  ): Promise<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.storeTree(tree as Iterable<import("@statewalker/vcs-core").TreeEntry>);
  }

  async load(
    id: import("@statewalker/vcs-core").ObjectId,
  ): Promise<AsyncIterable<import("@statewalker/vcs-core").TreeEntry> | undefined> {
    try {
      const exists = await this.legacyStore.has(id);
      if (!exists) {
        return undefined;
      }
      return this.legacyStore.loadTree(id);
    } catch {
      return undefined;
    }
  }

  has(id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  getEntry(
    treeId: import("@statewalker/vcs-core").ObjectId,
    name: string,
  ): Promise<import("@statewalker/vcs-core").TreeEntry | undefined> {
    return this.legacyStore.getEntry(treeId, name);
  }

  getEmptyTreeId(): import("@statewalker/vcs-core").ObjectId {
    return this.legacyStore.getEmptyTreeId();
  }

  remove(_id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return Promise.resolve(false);
  }

  keys(): AsyncIterable<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps CommitStore to provide Commits interface
 * @internal
 */
class CommitsAdapter implements Commits {
  constructor(private readonly legacyStore: CommitStore) {}

  store(
    commit: import("@statewalker/vcs-core").Commit,
  ): Promise<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.storeCommit(commit);
  }

  async load(
    id: import("@statewalker/vcs-core").ObjectId,
  ): Promise<import("@statewalker/vcs-core").Commit | undefined> {
    try {
      return await this.legacyStore.loadCommit(id);
    } catch {
      return undefined;
    }
  }

  has(id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  getParents(
    commitId: import("@statewalker/vcs-core").ObjectId,
  ): Promise<import("@statewalker/vcs-core").ObjectId[]> {
    return this.legacyStore.getParents(commitId);
  }

  async getTree(
    commitId: import("@statewalker/vcs-core").ObjectId,
  ): Promise<import("@statewalker/vcs-core").ObjectId | undefined> {
    try {
      return await this.legacyStore.getTree(commitId);
    } catch {
      return undefined;
    }
  }

  walkAncestry(
    startId: import("@statewalker/vcs-core").ObjectId | import("@statewalker/vcs-core").ObjectId[],
    options?: import("@statewalker/vcs-core").WalkOptions,
  ): AsyncIterable<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.walkAncestry(startId, options);
  }

  findMergeBase(
    commit1: import("@statewalker/vcs-core").ObjectId,
    commit2: import("@statewalker/vcs-core").ObjectId,
  ): Promise<import("@statewalker/vcs-core").ObjectId[]> {
    return this.legacyStore.findMergeBase(commit1, commit2);
  }

  isAncestor(
    ancestor: import("@statewalker/vcs-core").ObjectId,
    descendant: import("@statewalker/vcs-core").ObjectId,
  ): Promise<boolean> {
    return this.legacyStore.isAncestor(ancestor, descendant);
  }

  remove(_id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return Promise.resolve(false);
  }

  keys(): AsyncIterable<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps TagStore to provide Tags interface
 * @internal
 */
class TagsAdapter implements Tags {
  constructor(private readonly legacyStore: TagStore) {}

  store(
    tag: import("@statewalker/vcs-core").Tag,
  ): Promise<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.storeTag(tag);
  }

  async load(
    id: import("@statewalker/vcs-core").ObjectId,
  ): Promise<import("@statewalker/vcs-core").Tag | undefined> {
    try {
      return await this.legacyStore.loadTag(id);
    } catch {
      return undefined;
    }
  }

  has(id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return this.legacyStore.has(id);
  }

  getTarget(
    tagId: import("@statewalker/vcs-core").ObjectId,
    peel?: boolean,
  ): Promise<import("@statewalker/vcs-core").ObjectId | undefined> {
    return this.legacyStore.getTarget(tagId, peel);
  }

  remove(_id: import("@statewalker/vcs-core").ObjectId): Promise<boolean> {
    return Promise.resolve(false);
  }

  keys(): AsyncIterable<import("@statewalker/vcs-core").ObjectId> {
    return this.legacyStore.keys();
  }
}

/**
 * Adapter that wraps RefStore to provide Refs interface
 * @internal
 */
class RefsAdapter implements Refs {
  constructor(private readonly legacyStore: RefStore) {}

  get(name: string): Promise<import("@statewalker/vcs-core").RefValue | undefined> {
    return this.legacyStore.get(name);
  }

  resolve(name: string): Promise<import("@statewalker/vcs-core").Ref | undefined> {
    return this.legacyStore.resolve(name);
  }

  has(name: string): Promise<boolean> {
    return this.legacyStore.has(name);
  }

  list(prefix?: string): AsyncIterable<import("@statewalker/vcs-core").RefEntry> {
    return this.legacyStore.list(prefix);
  }

  set(name: string, objectId: import("@statewalker/vcs-core").ObjectId): Promise<void> {
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
    expected: import("@statewalker/vcs-core").ObjectId | undefined,
    newValue: import("@statewalker/vcs-core").ObjectId,
  ): Promise<import("@statewalker/vcs-core").RefUpdateResult> {
    return this.legacyStore.compareAndSwap(name, expected, newValue);
  }

  initialize(): Promise<void> {
    return this.legacyStore.initialize?.() ?? Promise.resolve();
  }

  optimize(): Promise<void> {
    return this.legacyStore.optimize?.() ?? Promise.resolve();
  }

  getReflog(name: string): Promise<import("@statewalker/vcs-core").ReflogReader | undefined> {
    return this.legacyStore.getReflog?.(name) ?? Promise.resolve(undefined);
  }

  packRefs(refNames: string[], options?: { all?: boolean; deleteLoose?: boolean }): Promise<void> {
    return this.legacyStore.packRefs?.(refNames, options) ?? Promise.resolve();
  }
}

/**
 * Configuration for SQLStorageBackend
 */
export interface SQLStorageBackendConfig extends BaseBackendConfig {
  /** Database client for SQL operations */
  db: DatabaseClient;
  /** Run migrations on initialization (default: true) */
  autoMigrate?: boolean;
}

/**
 * SQL Storage Backend
 *
 * Full StorageBackend implementation using SQL database.
 * Supports:
 * - Atomic transactions for batch operations
 * - Native delta tracking with depth management
 * - Rich query capabilities via SQL
 *
 * @deprecated Use `SQLHistoryFactory` instead.
 * The new pattern returns HistoryWithOperations directly, providing unified
 * access to typed stores and storage operations.
 *
 * Migration:
 * ```typescript
 * // Old pattern (deprecated)
 * const backend = new SQLStorageBackend({ db });
 * const history = createHistoryWithOperations({ backend });
 *
 * // New pattern (recommended)
 * const factory = new SQLHistoryFactory();
 * const history = await factory.createHistory({ db });
 * ```
 */
export class SQLStorageBackend {
  readonly blobs: BlobStore;
  readonly trees: TreeStore;
  readonly commits: CommitStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
  readonly delta: SqlDeltaApi;
  readonly serialization: SerializationApi;
  readonly capabilities: BackendCapabilities = {
    nativeBlobDeltas: true,
    randomAccess: true,
    atomicBatch: true,
    nativeGitFormat: false,
  };

  private readonly db: DatabaseClient;
  private readonly autoMigrate: boolean;
  private initialized = false;

  constructor(config: SQLStorageBackendConfig) {
    this.db = config.db;
    this.autoMigrate = config.autoMigrate ?? true;

    // Create stores
    this.blobs = new SqlNativeBlobStoreImpl(this.db);
    this.trees = new SQLTreeStore(this.db);
    this.commits = new SQLCommitStore(this.db);
    this.tags = new SQLTagStore(this.db);
    this.refs = new SQLRefStore(this.db);

    // Create delta API
    this.delta = new SqlDeltaApi(this.db);

    // Create serialization API
    this.serialization = new DefaultSerializationApi({
      blobs: this.blobs,
      trees: this.trees,
      commits: this.commits,
      tags: this.tags,
      refs: this.refs,
      blobDeltaApi: this.delta.blobs,
    });
  }

  /**
   * Initialize the backend
   *
   * Creates database tables if needed via migrations.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (this.autoMigrate) {
      await initializeSchema(this.db);
    }

    this.initialized = true;
  }

  /**
   * Close the backend
   *
   * Releases database connection.
   */
  async close(): Promise<void> {
    if (!this.initialized) return;

    await this.db.close();
    this.initialized = false;
  }

  /**
   * Check if backend is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get direct access to the database client
   *
   * Use for advanced operations like custom queries
   * or running multiple operations in a transaction.
   */
  getDatabase(): DatabaseClient {
    return this.db;
  }

  /**
   * Get storage operations (delta and serialization APIs)
   *
   * Returns a StorageOperations interface without the typed stores.
   * This is the preferred way to access delta and serialization APIs
   * going forward, as it separates concerns from the History interface.
   *
   * @returns StorageOperations implementation
   */
  getOperations(): StorageOperations {
    return {
      delta: this.delta,
      serialization: this.serialization,
      capabilities: this.capabilities,
      initialize: () => this.initialize(),
      close: () => this.close(),
    };
  }
}

/**
 * SQLHistoryFactory - Factory for creating SQL-backed HistoryWithOperations
 *
 * Implements the HistoryBackendFactory interface to create HistoryWithOperations
 * instances directly from SQL storage configuration.
 *
 * @example
 * ```typescript
 * import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
 *
 * const factory = new SQLHistoryFactory();
 * const db = await SqlJsAdapter.create();
 * const history = await factory.createHistory({ db });
 * await history.initialize();
 *
 * // Use history for normal operations
 * const commit = await history.commits.load(commitId);
 *
 * // Use delta API for storage optimization
 * history.delta.startBatch();
 * await history.delta.blobs.deltifyBlob(blobId, baseId, delta);
 * await history.delta.endBatch();
 *
 * await history.close();
 * ```
 */
export class SQLHistoryFactory implements HistoryBackendFactory<SQLStorageBackendConfig> {
  /**
   * Create a full HistoryWithOperations instance
   *
   * Returns an uninitialized instance. Call initialize() before use.
   *
   * @param config SQL storage backend configuration with database client
   * @returns HistoryWithOperations instance (not yet initialized)
   */
  async createHistory(config: SQLStorageBackendConfig): Promise<HistoryWithOperations> {
    const backend = new SQLStorageBackend(config);

    // Wrap legacy stores with adapters to provide new interfaces
    const blobs = new BlobsAdapter(backend.blobs);
    const trees = new TreesAdapter(backend.trees);
    const commits = new CommitsAdapter(backend.commits);
    const tags = new TagsAdapter(backend.tags);
    const refs = new RefsAdapter(backend.refs);

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
   * Create only storage operations (delta and serialization APIs)
   *
   * Use this when you only need delta compression or SQL query operations
   * without the full History interface.
   *
   * @param config SQL storage backend configuration
   * @returns StorageOperations instance (not yet initialized)
   */
  async createOperations(config: SQLStorageBackendConfig): Promise<StorageOperations> {
    const backend = new SQLStorageBackend(config);
    return backend.getOperations();
  }
}
