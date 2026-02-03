/**
 * SQL Backend Factory Registration
 *
 * Registers the SQL storage backend with the core factory.
 *
 * ## New Pattern (Recommended)
 *
 * Use `registerSqlHistoryFactory()` for new code. It registers a factory
 * that returns HistoryWithOperations directly.
 *
 * ## Legacy Pattern (Deprecated)
 *
 * The `registerSqlBackend()` function is deprecated.
 * Use `registerSqlHistoryFactory()` instead.
 */

import type { BackendConfig } from "@statewalker/vcs-core";
import {
  createHistoryWithOperations,
  registerBackendFactory,
  registerHistoryBackendFactory,
} from "@statewalker/vcs-core";
import type { DatabaseClient } from "./database-client.js";
import { SQLStorageBackend, type SQLStorageBackendConfig } from "./sql-storage-backend.js";

/**
 * Extended configuration for SQL backend
 */
export interface SQLBackendConfig extends BackendConfig {
  /**
   * Database client to use for SQL operations.
   *
   * If not provided, connectionString is used to create a client.
   * For sql.js, use SqlJsAdapter.create() to create a client.
   */
  db?: DatabaseClient;
}

/**
 * Factory function for SQL backend
 *
 * Creates an SQLStorageBackend instance.
 * Note: The backend is NOT initialized - call initialize() before use.
 */
async function createSqlBackend(config: BackendConfig): Promise<SQLStorageBackend> {
  const sqlConfig = config as SQLBackendConfig;

  if (!sqlConfig.db) {
    throw new Error(
      "SQL backend requires a database client. " +
        "Provide 'db' in config, e.g., { db: await SqlJsAdapter.create() }",
    );
  }

  return new SQLStorageBackend({
    db: sqlConfig.db,
    autoMigrate: true,
  });
}

/**
 * Register the SQL backend with the core factory
 *
 * Call this function to enable creating SQL backends via createStorageBackend("sql", config).
 *
 * @deprecated Use `registerSqlHistoryFactory()` instead.
 * The new pattern registers factories that return HistoryWithOperations directly.
 *
 * @example
 * ```typescript
 * import { registerSqlBackend } from "@statewalker/vcs-store-sql";
 * import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
 * import { createStorageBackend } from "@statewalker/vcs-core";
 *
 * // Register the SQL backend
 * registerSqlBackend();
 *
 * // Create a backend
 * const db = await SqlJsAdapter.create();
 * const backend = await createStorageBackend("sql", { db });
 * await backend.initialize();
 * ```
 */
export function registerSqlBackend(): void {
  registerBackendFactory("sql", createSqlBackend);
}

/**
 * Register the SQL backend with the new HistoryBackendFactory pattern
 *
 * Call this function to enable creating SQL-backed HistoryWithOperations
 * via createHistory("sql", config).
 *
 * @example
 * ```typescript
 * import { registerSqlHistoryFactory } from "@statewalker/vcs-store-sql";
 * import { SqlJsAdapter } from "@statewalker/vcs-store-sql/adapters/sql-js";
 * import { createHistory } from "@statewalker/vcs-core";
 *
 * // Register the SQL history factory
 * registerSqlHistoryFactory();
 *
 * // Create history with operations
 * const db = await SqlJsAdapter.create();
 * const history = await createHistory("sql", { db });
 * await history.initialize();
 *
 * // Use history for normal operations
 * const commit = await history.commits.load(commitId);
 *
 * await history.close();
 * ```
 */
export function registerSqlHistoryFactory(): void {
  registerHistoryBackendFactory("sql", async (config) => {
    const sqlConfig = config as SQLStorageBackendConfig;

    if (!sqlConfig.db) {
      throw new Error(
        "SQL backend requires a database client. " +
          "Provide 'db' in config, e.g., { db: await SqlJsAdapter.create() }",
      );
    }

    const backend = new SQLStorageBackend({
      db: sqlConfig.db,
      autoMigrate: true,
    });
    return createHistoryWithOperations({ backend });
  });
}
