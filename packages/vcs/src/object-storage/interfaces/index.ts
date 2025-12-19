/**
 * Object storage interfaces
 *
 * This module defines the core interfaces for Git-compatible object storage.
 * All implementations (memory, file, SQL, KV) implement these interfaces.
 */

// Store interfaces
export * from "./blob-store.js";
export * from "./commit-store.js";
export * from "./ref-store.js";
export * from "./tag-store.js";
export * from "./tree-store.js";
// Core types
export * from "./types.js";
