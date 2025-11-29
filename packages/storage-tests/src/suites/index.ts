/**
 * Parametrized test suites for storage implementations
 *
 * These test suites verify implementations of the storage interfaces
 * defined in @webrun-vcs/storage. Repository-specific test suites
 * have been moved to @webrun-vcs/storage-default.
 */

export * from "./delta-object-storage.suite.js";
export * from "./object-storage.suite.js";
