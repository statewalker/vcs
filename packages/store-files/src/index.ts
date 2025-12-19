/**
 * @webrun-vcs/storage-git
 *
 * Git-compatible storage implementation.
 * Provides ObjectStore, TreeStore, CommitStore, and TagStore
 * implementations that read and write standard Git repository format.
 */

// Loose object handling
export * from "./attik.loose/index.js";
// Backend implementations (new delta architecture)
export * from "./backends/index.js";
// Binary storage (new architecture)
export * from "./binary-storage/index.js";
// Composite storage
export * from "./composite-object-storage.js";
// Factory function for streaming stores
export * from "./create-streaming-stores.js";
// Low-level storage implementations
export * from "./file-raw-storage.js";
export * from "./file-temp-store.js";
// Format utilities (for advanced use cases)
export * from "./format/index.js";
export * from "./git-commit-storage.js";
export * from "./git-delta-object-storage.js";
export * from "./git-file-tree-storage.js";
export * from "./git-object-storage.js";
export * from "./git-pack-storage.js";
export * from "./git-raw-objects-storage.js";
export * from "./git-ref-storage.js";
// Main storage implementations
export * from "./git-storage.js";
export * from "./git-tag-storage.js";
// Pack file handling
export * from "./pack/index.js";
// Refs handling
export * from "./refs/index.js";
// Staging area (index file)
export * from "./staging/index.js";
// Typed object utilities
export * from "./typed-object-utils.js";
// Utility functions
export * from "./utils/index.js";
