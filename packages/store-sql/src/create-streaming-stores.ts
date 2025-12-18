/**
 * Factory function for creating Git-compatible streaming stores
 *
 * Creates stores using the new streaming architecture that produces
 * Git-compatible object IDs.
 */

import type { GitStores } from "@webrun-vcs/vcs";
import { createStreamingStores, MemoryTempStore } from "@webrun-vcs/vcs";
import type { DatabaseClient } from "./database-client.js";
import { SqlRawStorage } from "./sql-raw-storage.js";

/**
 * Options for creating SQL-based streaming stores
 */
export interface StreamingSqlStoresOptions {
  /** Table name for storing raw objects (default: "raw_objects") */
  tableName?: string;
}

/**
 * Create Git-compatible stores backed by SQL database.
 *
 * Uses the streaming architecture with proper Git header format
 * for SHA-1 compatibility.
 *
 * @param db Database client for SQL operations
 * @param options Optional configuration
 * @returns GitStores with all typed store implementations
 */
export function createStreamingSqlStores(
  db: DatabaseClient,
  options?: StreamingSqlStoresOptions,
): GitStores {
  const tableName = options?.tableName ?? "raw_objects";

  const storage = new SqlRawStorage(db, tableName);
  const temp = new MemoryTempStore();

  return createStreamingStores({ storage, temp });
}
