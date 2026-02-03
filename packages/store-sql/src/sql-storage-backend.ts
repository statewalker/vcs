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
  type CommitStore,
  createHistoryWithOperations,
  DefaultSerializationApi,
  type HistoryBackendFactory,
  type HistoryWithOperations,
  type RefStore,
  type SerializationApi,
  type StorageBackend,
  type StorageOperations,
  type TagStore,
  type TreeStore,
} from "@statewalker/vcs-core";
import { SQLCommitStore } from "./commit-store.js";
import type { DatabaseClient } from "./database-client.js";
import { initializeSchema } from "./migrations/index.js";
import { SqlNativeBlobStoreImpl } from "./native/sql-native-blob-store.js";
import { SQLRefStore } from "./ref-store.js";
import { SqlDeltaApi } from "./sql-delta-api.js";
import { SQLTagStore } from "./tag-store.js";
import { SQLTreeStore } from "./tree-store.js";

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
export class SQLStorageBackend implements StorageBackend {
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
    return createHistoryWithOperations({ backend });
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
