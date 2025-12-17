/**
 * SQL-based storage for webrun-vcs
 *
 * Provides persistent object storage using SQL databases (primarily SQLite).
 * Implements the repository pattern with delta compression support.
 *
 * @example Basic usage with sql.js
 * ```typescript
 * import { createSQLStorage } from "@webrun-vcs/storage-sql";
 * import { SqlJsAdapter } from "@webrun-vcs/storage-sql/adapters/sql-js";
 *
 * // Create in-memory SQLite database
 * const db = await SqlJsAdapter.create();
 * const { storage, close } = await createSQLStorage(db);
 *
 * // Store content
 * async function* chunks() {
 *   yield new TextEncoder().encode("Hello, World!");
 * }
 * const id = await storage.store(chunks());
 *
 * // Load content
 * for await (const chunk of storage.load(id)) {
 *   console.log(new TextDecoder().decode(chunk));
 * }
 *
 * // Don't forget to close when done
 * await close();
 * ```
 */

// Backend implementations
export * from "./backends/index.js";
// High-level store implementations
export * from "./commit-store.js";
// Factory function
export * from "./create-sql-storage.js";

// Database client interface
export * from "./database-client.js";

// Repository implementations
export * from "./delta-repository.js";
export * from "./metadata-repository.js";
// Migrations
export * from "./migrations/index.js";
export * from "./object-repository.js";
export * from "./ref-store.js";
export * from "./staging-store.js";
export * from "./tag-store.js";
export * from "./tree-store.js";
