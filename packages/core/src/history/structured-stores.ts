/**
 * StructuredStores - Aggregate interface for typed object stores
 *
 * Bundles all five Git object stores into a single interface.
 * This is the "API 1: Structured Stores" from the unified architecture.
 *
 * Provides typed access to parsed Git objects:
 * - BlobStore: File content (streaming)
 * - TreeStore: Directory structure (streaming)
 * - CommitStore: Version snapshots
 * - TagStore: Annotated tags
 * - RefStore: Branches, HEAD, remotes
 *
 * @example
 * ```typescript
 * // Access stores through the aggregate
 * const blob = stores.blobs.load(blobId);
 * const tree = stores.trees.loadTree(treeId);
 * const commit = await stores.commits.loadCommit(commitId);
 *
 * // Store new objects
 * const newBlobId = await stores.blobs.store(content);
 * const newTreeId = await stores.trees.storeTree(entries);
 * const newCommitId = await stores.commits.storeCommit(commitData);
 * ```
 */

import type { BlobStore } from "./blobs/blob-store.js";
import type { CommitStore } from "./commits/commit-store.js";
import type { RefStore } from "./refs/ref-store.js";
import type { TagStore } from "./tags/tag-store.js";
import type { TreeStore } from "./trees/tree-store.js";

/**
 * Aggregate interface for all structured stores
 *
 * Part of StorageBackend.structured in the three-API architecture:
 * 1. **StructuredStores** (this) - Typed access to parsed objects
 * 2. DeltaApi - Blob delta operations for storage optimization
 * 3. SerializationApi - Git-compatible wire format I/O
 *
 * Each store handles one Git object type:
 * - blobs: Raw file content (streaming for large files)
 * - trees: Directory listings (sorted entries)
 * - commits: Version snapshots with ancestry
 * - tags: Annotated tag objects
 * - refs: Named references (branches, HEAD, remotes)
 */
export interface StructuredStores {
  /**
   * Blob storage - file content
   *
   * Streaming API for memory-efficient handling of large files.
   * Content is stored and retrieved as opaque byte streams.
   */
  readonly blobs: BlobStore;

  /**
   * Tree storage - directory structure
   *
   * Streaming API for memory-efficient handling of large directories.
   * Entries are sorted canonically for Git compatibility.
   */
  readonly trees: TreeStore;

  /**
   * Commit storage - version snapshots
   *
   * Non-streaming API (commits are small).
   * Includes ancestry traversal helpers.
   */
  readonly commits: CommitStore;

  /**
   * Tag storage - annotated tags
   *
   * Non-streaming API (tags are small).
   * Only handles annotated tags; lightweight tags are refs.
   */
  readonly tags: TagStore;

  /**
   * Ref storage - named references
   *
   * Manages branches, HEAD, and remote tracking refs.
   * Supports both direct and symbolic references.
   */
  readonly refs: RefStore;
}

// Re-export individual store types for convenience
export type { BlobStore } from "./blobs/blob-store.js";
export type { AncestryOptions, Commit, CommitStore } from "./commits/commit-store.js";
export type { RefStore, RefUpdateResult } from "./refs/ref-store.js";
export type { AnnotatedTag, TagStore } from "./tags/tag-store.js";
export type { TreeEntry } from "./trees/tree-entry.js";
export type { TreeStore } from "./trees/tree-store.js";
