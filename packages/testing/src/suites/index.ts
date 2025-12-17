/**
 * Parametrized test suites for storage implementations
 *
 * These test suites verify implementations of the storage interfaces
 * defined in @webrun-vcs/storage and repository interfaces from
 * @webrun-vcs/storage-default.
 */

export * from "./commit-store.suite.js";
// Storage interface test suites
export * from "./delta-object-storage.suite.js";
// Repository interface test suites
export * from "./delta-repository.suite.js";
export * from "./metadata-repository.suite.js";
export * from "./object-repository.suite.js";
export * from "./object-storage.suite.js";
export * from "./ref-store.suite.js";
export * from "./staging-store.suite.js";
export * from "./tag-store.suite.js";
// High-level store test suites
export * from "./tree-store.suite.js";
