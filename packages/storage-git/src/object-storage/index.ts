/**
 * File-backed object storage with Git-compatible format
 *
 * Creates typed stores (BlobStore, TreeStore, CommitStore, TagStore)
 * that use Git-compatible serialization and SHA-1 hashing. Objects
 * are stored as loose files in the standard Git format.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import {
  type BlobStore,
  type CommitStore,
  GitBlobStore,
  GitCommitStore,
  type GitObjectStore,
  GitObjectStoreImpl,
  GitTagStore,
  GitTreeStore,
  type TagStore,
  type TreeStore,
} from "@webrun-vcs/core";
import { FileRawStore, FileVolatileStore } from "../binary-storage/index.js";

/**
 * Collection of file-backed object stores
 */
export interface FileObjectStores {
  /** Low-level Git object store */
  objects: GitObjectStore;
  /** Blob (file content) store */
  blobs: BlobStore;
  /** Tree (directory) store */
  trees: TreeStore;
  /** Commit store */
  commits: CommitStore;
  /** Tag store */
  tags: TagStore;
}

/**
 * Options for creating file-backed object stores
 */
export interface CreateFileObjectStoresOptions {
  /** FilesApi for file operations */
  files: FilesApi;
  /** Base path for storing objects (e.g., ".git/objects") */
  objectsPath: string;
  /** Base path for volatile storage (e.g., ".git/tmp") */
  tempPath?: string;
}

/**
 * Create file-backed object stores with Git-compatible format
 *
 * Uses the git-codec implementations from the vcs package to ensure
 * objects are serialized in Git format with correct SHA-1 IDs.
 *
 * @param options Configuration options
 * @returns Collection of typed object stores
 *
 * @example
 * ```typescript
 * const stores = createFileObjectStores({
 *   files: nodeFs,
 *   objectsPath: "/repo/.git/objects",
 *   tempPath: "/repo/.git/tmp"
 * });
 *
 * // Store a blob in Git format
 * const blobId = await stores.blobs.store(content);
 *
 * // The blob can now be read by native Git:
 * // git cat-file -p <blobId>
 * ```
 */
export function createFileObjectStores(options: CreateFileObjectStoresOptions): FileObjectStores {
  const { files, objectsPath, tempPath } = options;

  const rawStore = new FileRawStore(files, objectsPath);
  const volatileStore = new FileVolatileStore(files, tempPath ?? `${objectsPath}/../tmp`);

  const objects = new GitObjectStoreImpl(volatileStore, rawStore);

  return {
    objects,
    blobs: new GitBlobStore(objects),
    trees: new GitTreeStore(objects),
    commits: new GitCommitStore(objects),
    tags: new GitTagStore(objects),
  };
}

// Re-export git-codec stores for direct usage
export {
  GitBlobStore,
  GitCommitStore,
  type GitObjectStore,
  GitObjectStoreImpl,
  GitTagStore,
  GitTreeStore,
} from "@webrun-vcs/core";
