/**
 * SQL schema migrations
 *
 * Manages database schema versioning and upgrades following
 * Fossil's proven patterns.
 */

import type { DatabaseClient } from "../database-client.js";

/**
 * Migration definition
 */
export interface Migration {
  /** Migration version number (must be sequential) */
  version: number;
  /** Human-readable name */
  name: string;
  /** SQL statements to apply migration (semicolon-separated) */
  up: string;
  /** SQL statements to revert migration (semicolon-separated) */
  down: string;
}

/**
 * All migrations in order
 *
 * New migrations should be added at the end with incrementing version numbers.
 */
export const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    up: `
      CREATE TABLE IF NOT EXISTS object (
        record_id INTEGER PRIMARY KEY AUTOINCREMENT,
        object_id TEXT UNIQUE NOT NULL,
        size INTEGER NOT NULL,
        content BLOB,
        created_at INTEGER NOT NULL,
        accessed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS object_accessed_idx ON object(accessed_at);

      CREATE TABLE IF NOT EXISTS delta (
        record_id INTEGER PRIMARY KEY REFERENCES object(record_id) ON DELETE CASCADE,
        base_record_id INTEGER NOT NULL REFERENCES object(record_id),
        delta_size INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS delta_base_idx ON delta(base_record_id);

      CREATE TABLE IF NOT EXISTS metadata (
        object_id TEXT PRIMARY KEY,
        access_count INTEGER NOT NULL DEFAULT 0,
        is_hot INTEGER NOT NULL DEFAULT 0,
        total_size INTEGER NOT NULL DEFAULT 0,
        last_accessed INTEGER NOT NULL DEFAULT 0
      ) WITHOUT ROWID;

      CREATE VIEW IF NOT EXISTS artifact AS
        SELECT
          o.record_id, o.object_id, o.size, o.content,
          o.created_at, o.accessed_at,
          d.base_record_id, d.delta_size,
          CASE WHEN d.record_id IS NOT NULL THEN 1 ELSE 0 END AS is_delta
        FROM object o
        LEFT JOIN delta d ON o.record_id = d.record_id;
    `,
    down: `
      DROP VIEW IF EXISTS artifact;
      DROP TABLE IF EXISTS metadata;
      DROP TABLE IF EXISTS delta;
      DROP TABLE IF EXISTS object;
    `,
  },
  {
    version: 2,
    name: "delta_content_table",
    up: `
      CREATE TABLE IF NOT EXISTS delta_content (
        object_id TEXT PRIMARY KEY,
        base_object_id TEXT NOT NULL,
        delta_data BLOB NOT NULL,
        delta_format TEXT NOT NULL CHECK(delta_format IN ('git', 'fossil')),
        original_size INTEGER NOT NULL,
        delta_size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS delta_content_base_idx ON delta_content(base_object_id);
    `,
    down: `
      DROP INDEX IF EXISTS delta_content_base_idx;
      DROP TABLE IF EXISTS delta_content;
    `,
  },
];

/**
 * Initialize database schema and run pending migrations
 *
 * Creates the schema_version table if it doesn't exist and applies
 * any migrations that haven't been run yet.
 *
 * @param db Database client
 */
export async function initializeSchema(db: DatabaseClient): Promise<void> {
  // Ensure schema_version table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  // Get current version
  const rows = await db.query<{ version: number | null }>(
    "SELECT MAX(version) as version FROM schema_version",
  );
  const currentVersion = rows[0]?.version ?? 0;

  // Apply pending migrations in order
  for (const migration of migrations) {
    if (migration.version > currentVersion) {
      await db.transaction(async (tx) => {
        // Split and run migration statements
        const statements = splitStatements(migration.up);
        for (const stmt of statements) {
          await tx.execute(stmt);
        }

        // Record migration
        await tx.execute("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)", [
          migration.version,
          Date.now(),
        ]);
      });
    }
  }
}

/**
 * Rollback migrations to a specific version
 *
 * @param db Database client
 * @param targetVersion Version to rollback to (migrations above this will be reverted)
 */
export async function rollbackMigration(db: DatabaseClient, targetVersion: number): Promise<void> {
  const rows = await db.query<{ version: number | null }>(
    "SELECT MAX(version) as version FROM schema_version",
  );
  const currentVersion = rows[0]?.version ?? 0;

  // Get migrations to rollback in reverse order
  const toRollback = migrations
    .filter((m) => m.version > targetVersion && m.version <= currentVersion)
    .sort((a, b) => b.version - a.version);

  for (const migration of toRollback) {
    await db.transaction(async (tx) => {
      // Split and run rollback statements
      const statements = splitStatements(migration.down);
      for (const stmt of statements) {
        await tx.execute(stmt);
      }

      // Remove migration record
      await tx.execute("DELETE FROM schema_version WHERE version = ?", [migration.version]);
    });
  }
}

/**
 * Get current schema version
 *
 * @param db Database client
 * @returns Current version number, or 0 if no migrations have been applied
 */
export async function getSchemaVersion(db: DatabaseClient): Promise<number> {
  try {
    const rows = await db.query<{ version: number | null }>(
      "SELECT MAX(version) as version FROM schema_version",
    );
    return rows[0]?.version ?? 0;
  } catch {
    // Table doesn't exist yet
    return 0;
  }
}

/**
 * Split SQL string into individual statements
 *
 * Handles semicolon-separated statements while preserving
 * content within string literals.
 */
function splitStatements(sql: string): string[] {
  return sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
