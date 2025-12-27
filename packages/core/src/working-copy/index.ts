/**
 * WorkingCopy implementations
 *
 * Provides file-based implementations of the WorkingCopy interface
 * for managing local checkout state in Git repositories.
 */

// State readers
export * from "./merge-state-reader.js";
export * from "./rebase-state-reader.js";
// Stash
export * from "./stash-store.files.js";
export * from "./stash-store.memory.js";
// File-based implementation
export * from "./working-copy.files.js";
// Memory implementation
export * from "./working-copy.memory.js";
// Config
export * from "./working-copy-config.files.js";
export * from "./working-copy-factory.files.js";
