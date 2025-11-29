/**
 * Parametrized test suites for storage implementations
 *
 * These test suites verify implementations of the storage interfaces
 * defined in @webrun-vcs/storage and repository interfaces from
 * @webrun-vcs/storage-default.
 */

// Storage interface test suites
export * from "./delta-object-storage.suite.js";
export * from "./object-storage.suite.js";

// Repository interface test suites
export * from "./delta-repository.suite.js";
export * from "./metadata-repository.suite.js";
export * from "./object-repository.suite.js";
