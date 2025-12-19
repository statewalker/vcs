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
// Binary storage (new architecture)
export * from "./binary-storage/index.js";
// High-level store implementations
export * from "./commit-store.js";
// Factory functions
export * from "./create-sql-storage.js";
export * from "./create-streaming-stores.js";
// Database client interface
export * from "./database-client.js";
// Repository implementations
export * from "./delta-repository.js";
export * from "./metadata-repository.js";
// Migrations
export * from "./migrations/index.js";
// Native SQL stores with query capabilities
export * from "./native/index.js";
export * from "./object-repository.js";
// Object storage (new architecture)
export * from "./object-storage/index.js";
export * from "./ref-store.js";
// Low-level storage
export * from "./sql-raw-storage.js";
export * from "./staging-store.js";
// Synchronization utilities
export * from "./sync.js";
export * from "./tag-store.js";
export * from "./tree-store.js";
