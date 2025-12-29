/**
 * Factory function for creating Git-compatible streaming stores
 *
 * @deprecated Use createFileObjectStores from './object-storage/index.js' instead.
 * This file is kept for backwards compatibility.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type { GitStores } from "@webrun-vcs/core";
import { createFileObjectStores } from "./object-storage/index.js";

/**
 * Options for creating file-based streaming stores
 * @deprecated Use CreateFileObjectStoresOptions instead
 */
export interface StreamingFileStoresOptions {
  /** Threshold for spilling to file-based temp storage (default: 1MB) */
  spillThreshold?: number;
}

/**
 * Create Git-compatible stores backed by file system.
 *
 * @deprecated Use createFileObjectStores from './object-storage/index.js' instead.
 *
 * @param files FilesApi instance for all file system operations
 * @param objectsDir Path to objects directory (usually .git/objects)
 * @param _options Optional configuration (ignored in new implementation)
 * @returns GitStores with all typed store implementations
 */
export function createStreamingFileStores(
  files: FilesApi,
  objectsDir: string,
  _options?: StreamingFileStoresOptions,
): GitStores {
  const stores = createFileObjectStores({
    files,
    objectsPath: objectsDir,
    tempPath: `${objectsDir}/../tmp`,
  });

  // Return GitStores-compatible interface
  return {
    objects: stores.objects,
    commits: stores.commits,
    trees: stores.trees,
    blobs: stores.blobs,
    tags: stores.tags,
  };
}

// Re-export new types for migration
export type { FileObjectStores } from "./object-storage/index.js";
export { createFileObjectStores } from "./object-storage/index.js";
