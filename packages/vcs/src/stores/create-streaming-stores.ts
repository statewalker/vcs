/**
 * Factory for creating streaming Git-compatible stores
 *
 * Creates a complete set of typed stores backed by a single GitObjectStore.
 */

import type { GitObjectStore } from "../interfaces/git-object-store.js";
import type { GitStores } from "../interfaces/git-stores.js";
import type { RawStorage } from "../interfaces/raw-storage.js";
import type { TempStore } from "../interfaces/temp-store.js";
import { StreamingGitObjectStore } from "./streaming-git-object-store.js";
import { StreamingBlobStore } from "./streaming-blob-store.js";
import { StreamingCommitStore } from "./streaming-commit-store.js";
import { StreamingTagStore } from "./streaming-tag-store.js";
import { StreamingTreeStore } from "./streaming-tree-store.js";

/**
 * Options for creating streaming stores
 */
export interface CreateStreamingStoresOptions {
  /** Temporary storage for buffering unknown-size content */
  temp: TempStore;
  /** Raw storage backend */
  storage: RawStorage;
}

/**
 * Extended GitStores with access to underlying GitObjectStore
 */
export interface StreamingStores extends GitStores {
  /** The underlying Git object store */
  readonly objects: GitObjectStore;
}

/**
 * Create a complete set of streaming Git-compatible stores
 *
 * All stores share the same underlying GitObjectStore, ensuring
 * consistent object IDs across all object types.
 *
 * @param options Configuration options
 * @returns Complete set of typed stores
 */
export function createStreamingStores(options: CreateStreamingStoresOptions): StreamingStores {
  const objects = new StreamingGitObjectStore(options.temp, options.storage);

  return {
    objects,
    commits: new StreamingCommitStore(objects),
    trees: new StreamingTreeStore(objects),
    blobs: new StreamingBlobStore(objects),
    tags: new StreamingTagStore(objects),
  };
}
