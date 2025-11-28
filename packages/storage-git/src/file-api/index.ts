/**
 * File system abstraction for Git storage
 *
 * Provides platform-agnostic file operations enabling both
 * production use (Node.js) and fast testing (in-memory).
 */

export * from "./types.js";
export * from "./memory-file-api.js";
export * from "./node-file-api.js";
