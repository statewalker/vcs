/**
 * Backend module - Unified storage interfaces
 *
 * Exports the StorageBackend contract and related types.
 */

// Export serialization API for backend implementations
export { DefaultSerializationApi } from "../serialization/serialization-api.impl.js";

export * from "./factory.js";
export * from "./git/index.js";
export * from "./git-files-storage-backend.js";
export * from "./memory-storage-backend.js";
export * from "./storage-backend.js";
