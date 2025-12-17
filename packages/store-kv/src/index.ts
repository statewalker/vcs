/**
 * Key-value storage backend for WebRun VCS
 *
 * Provides VCS storage implementations that work with any key-value store.
 * Includes adapters for in-memory storage (for testing) and can be extended
 * with adapters for IndexedDB, LocalStorage, LevelDB, etc.
 */

// Adapters
export * from "./adapters/index.js";
// Store implementations
export * from "./kv-commit-store.js";
export * from "./kv-ref-store.js";
export * from "./kv-staging-store.js";
// KV Store interface and utilities
export * from "./kv-store.js";
export * from "./kv-tag-store.js";
export * from "./kv-tree-store.js";
