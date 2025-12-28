/**
 * WorkingCopy implementations
 *
 * Provides file-based implementations of the WorkingCopy interface
 * for managing local checkout state in Git repositories.
 */

// Checkout utilities
export * from "./checkout-utils.js";
// State readers
export * from "./cherry-pick-state-reader.js";
export * from "./merge-state-reader.js";
export * from "./rebase-state-reader.js";
// Repository state
export * from "./repository-state.js";
export * from "./repository-state-detector.js";
export * from "./revert-state-reader.js";
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
