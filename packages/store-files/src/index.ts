/**
 * File-backed storage backend for StateWalker VCS
 *
 * Provides high-level factories for creating Git-compatible file-backed storage:
 * - `createGitFilesBackend()` — basic History from a FilesApi
 * - `createGitFilesHistoryFromFiles()` — full HistoryWithOperations with delta support
 * - `gc()` — garbage collection for unreachable objects
 */

export * from "./create-git-files-backend.js";
export * from "./create-git-files-history-with-ops.js";
export * from "./gc.js";
