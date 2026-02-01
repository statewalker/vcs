/**
 * SQL Storage Backend
 *
 * StorageBackend implementation using SQL database.
 * Provides all three APIs (StructuredStores, DeltaApi, SerializationApi)
 * with transaction support for atomic operations.
 */

import {
  type BackendCapabilities,
  type BlobStore,
  type CommitStore,
  DefaultSerializationApi,
  type RefStore,
  type SerializationApi,
  type StorageBackend,
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
export interface SQLStorageBackendConfig {
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
 * @example
 * ```typescript
 * import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
 *
 * const db = await SqlJsAdapter.create();
 * const backend = new SQLStorageBackend({ db });
 * await backend.initialize();
 *
 * // Use stores for application logic
 * const commit = await backend.commits.loadCommit(commitId);
 *
 * // Use delta API for storage optimization
 * backend.delta.startBatch();
 * await backend.delta.blobs.deltifyBlob(blobId, baseId, deltaStream);
 * await backend.delta.endBatch();
 *
 * await backend.close();
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
}
