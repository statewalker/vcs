/**
 * Factory function for creating Git-compatible streaming stores
 *
 * Creates stores using the new streaming architecture that produces
 * Git-compatible object IDs.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type { GitStores } from "@webrun-vcs/vcs";
import {
  CompressingRawStorage,
  createStreamingStores,
  HybridTempStore,
  MemoryTempStore,
} from "@webrun-vcs/vcs";
import { FileRawStorage } from "./file-raw-storage.js";
import { FileTempStore } from "./file-temp-store.js";

/**
 * Options for creating file-based streaming stores
 */
export interface StreamingFileStoresOptions {
  /** Threshold for spilling to file-based temp storage (default: 1MB) */
  spillThreshold?: number;
}

/**
 * Create Git-compatible stores backed by file system.
 *
 * Uses the streaming architecture with proper Git header format
 * for SHA-1 compatibility. Objects are stored in the standard
 * Git loose object format.
 *
 * @param files FilesApi instance for all file system operations
 * @param objectsDir Path to objects directory (usually .git/objects)
 * @param options Optional configuration
 * @returns GitStores with all typed store implementations
 */
export function createStreamingFileStores(
  files: FilesApi,
  objectsDir: string,
  options?: StreamingFileStoresOptions,
): GitStores {
  const tempDir = `${objectsDir}/../tmp`;
  const spillThreshold = options?.spillThreshold ?? 1024 * 1024;

  // FileRawStorage stores raw bytes; wrap with compression for Git compatibility
  const rawStorage = new FileRawStorage(files, objectsDir);
  const storage = new CompressingRawStorage(rawStorage);

  // Use hybrid temp store: small objects in memory, large spill to files
  const smallStore = new MemoryTempStore();
  const largeStore = new FileTempStore(files, tempDir);
  const temp = new HybridTempStore(smallStore, largeStore, spillThreshold);

  return createStreamingStores({ storage, temp });
}
