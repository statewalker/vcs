/**
 * Backend module - Unified storage interfaces
 *
 * Exports the StorageBackend contract and related types.
 *
 * ## New Pattern (Recommended)
 *
 * Use HistoryWithOperations factories for new code:
 * - `createHistory()` - Create HistoryWithOperations from registered backend type
 * - `createMemoryHistoryWithOperations()` - In-memory with full operations
 * - `createGitFilesHistory()` - Git-files backed with full operations
 *
 * ## Legacy Pattern (Deprecated)
 *
 * The StorageBackend interface is deprecated in favor of HistoryWithOperations.
 * Use `createHistoryWithOperations({ backend })` to wrap existing backends.
 */

// Export serialization API for backend implementations
export { DefaultSerializationApi } from "../serialization/serialization-api.impl.js";

export * from "./factory.js";
export * from "./git/index.js";
export * from "./git-files-storage-backend.js";
export * from "./history-backend-factory.js";
export * from "./memory-storage-backend.js";
export * from "./storage-backend.js";
