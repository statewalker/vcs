/**
 * Factory function for creating Git-compatible streaming stores
 *
 * @deprecated Use createSqlObjectStores from './object-storage/index.js' instead.
 * This file is kept for backwards compatibility.
 */

import type { GitStores } from "@statewalker/vcs-core";
import type { DatabaseClient } from "./database-client.js";
import { createSqlObjectStores } from "./object-storage/index.js";

/**
 * Options for creating SQL-based streaming stores
 * @deprecated Use CreateSqlObjectStoresOptions instead
 */
export interface StreamingSqlStoresOptions {
  /** Table name for storing raw objects (default: "raw_objects") */
  tableName?: string;
}

/**
 * Create Git-compatible stores backed by SQL database.
 *
 * @deprecated Use createSqlObjectStores from './object-storage/index.js' instead.
 *
 * @param db Database client for SQL operations
 * @param options Optional configuration
 * @returns GitStores with all typed store implementations
 */
export function createStreamingSqlStores(
  db: DatabaseClient,
  options?: StreamingSqlStoresOptions,
): GitStores {
  const stores = createSqlObjectStores({
    db,
    tableName: options?.tableName,
  });

  // Return GitStores-compatible interface
  return {
    objects: stores.objects,
    commits: stores.commits,
    trees: stores.trees,
    blobs: stores.blobs,
    tags: stores.tags,
  };
}

// Re-export new types for migration
export type { SqlObjectStores } from "./object-storage/index.js";
export { createSqlObjectStores } from "./object-storage/index.js";
