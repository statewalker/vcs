/**
 * File-based BinStore implementation
 *
 * Composite storage that combines FileRawStore and FileDeltaStore.
 */

import { type FilesApi, joinPath } from "@statewalker/webrun-files";
import type { BinStore, DeltaStore, RawStore } from "@webrun-vcs/core";
import { FileDeltaStore } from "./file-delta-store.js";
import { FileRawStore } from "./file-raw-store.js";

// Re-export BinStore for backwards compatibility
export type { BinStore };

/**
 * File-based composite binary storage
 *
 * Provides both raw and delta-compressed storage using the filesystem.
 */
export class FileBinStore implements BinStore {
  readonly name = "files";
  readonly raw: RawStore;
  readonly delta: DeltaStore;

  private readonly _rawStore: FileRawStore;
  private readonly _deltaStore: FileDeltaStore;

  /**
   * Create file-based binary store
   *
   * @param files FilesApi for file operations
   * @param basePath Base directory for storing objects
   */
  constructor(files: FilesApi, basePath: string) {
    this._rawStore = new FileRawStore(files, joinPath(basePath, "objects"));
    this._deltaStore = new FileDeltaStore(files, joinPath(basePath, "deltas"));
    this.raw = this._rawStore;
    this.delta = this._deltaStore;
  }

  /**
   * Flush pending writes
   *
   * For file-based storage, writes are typically synchronous with the filesystem,
   * but this could be used to sync any pending operations.
   */
  async flush(): Promise<void> {
    // No-op: file writes are typically synchronous
  }

  /**
   * Close backend and release resources
   */
  async close(): Promise<void> {
    // No-op: no persistent connections to close
  }

  /**
   * Refresh backend state
   *
   * For file-based storage, this could be used to clear any caches.
   */
  async refresh(): Promise<void> {
    // No-op: file storage has no caches to refresh
  }
}

/**
 * Create a new file-based binary store
 */
export function createFileBinStore(files: FilesApi, basePath: string): FileBinStore {
  return new FileBinStore(files, basePath);
}
