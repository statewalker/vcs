/**
 * Factory function for SQL-based object storage
 *
 * Creates a DefaultObjectStorage backed by SQL repositories,
 * suitable for persistent storage in browsers and Node.js.
 */

import type { ObjectId } from "@webrun-vcs/storage";
import { DefaultObjectStorage, IntermediateCache, LRUCache } from "@webrun-vcs/storage-default";
import type { DatabaseClient } from "./database-client.js";
import { SQLDeltaRepository } from "./delta-repository.js";
import { SQLMetadataRepository } from "./metadata-repository.js";
import { initializeSchema } from "./migrations/index.js";
import { SQLObjectRepository } from "./object-repository.js";

/**
 * Options for creating SQL-backed storage
 */
export interface SQLStorageOptions {
  /** Maximum in-memory cache size in bytes (default: 50MB) */
  maxCacheSize?: number;
  /** Maximum cache entries (default: 500) */
  maxCacheEntries?: number;
  /** Run migrations on initialization (default: true) */
  autoMigrate?: boolean;
}

/**
 * SQL storage instance with access to underlying components
 */
export interface SQLStorage {
  /** The DefaultObjectStorage instance */
  storage: DefaultObjectStorage;
  /** Direct access to the database client */
  db: DatabaseClient;
  /** The object repository */
  objectRepo: SQLObjectRepository;
  /** The delta repository */
  deltaRepo: SQLDeltaRepository;
  /** The metadata repository */
  metadataRepo: SQLMetadataRepository;
  /** Close the storage and database connection */
  close(): Promise<void>;
}

/**
 * Create SQL-backed object storage
 *
 * Initializes the database schema and creates all necessary repositories
 * and caches for efficient delta-compressed object storage.
 *
 * @example Browser with sql.js
 * ```typescript
 * import { createSQLStorage } from "@webrun-vcs/storage-sql";
 * import { SqlJsAdapter } from "@webrun-vcs/storage-sql/adapters/sql-js";
 *
 * const db = await SqlJsAdapter.create();
 * const { storage, close } = await createSQLStorage(db);
 *
 * // Use storage...
 * const id = await storage.store(content);
 *
 * // When done
 * await close();
 * ```
 *
 * @param db Database client to use for storage
 * @param options Configuration options
 * @returns SQL storage instance
 */
export async function createSQLStorage(
  db: DatabaseClient,
  options: SQLStorageOptions = {},
): Promise<SQLStorage> {
  const { maxCacheSize = 50 * 1024 * 1024, maxCacheEntries = 500, autoMigrate = true } = options;

  // Initialize schema and run migrations
  if (autoMigrate) {
    await initializeSchema(db);
  }

  // Create repository instances
  const objectRepo = new SQLObjectRepository(db);
  const deltaRepo = new SQLDeltaRepository(db);
  const metadataRepo = new SQLMetadataRepository(db);

  // Create caches
  const contentCache = new LRUCache<ObjectId, Uint8Array>(maxCacheSize, maxCacheEntries);
  const intermediateCache = new IntermediateCache();

  // Create storage
  const storage = new DefaultObjectStorage(
    objectRepo,
    deltaRepo,
    metadataRepo,
    contentCache,
    intermediateCache,
  );

  return {
    storage,
    db,
    objectRepo,
    deltaRepo,
    metadataRepo,
    async close() {
      await db.close();
    },
  };
}
