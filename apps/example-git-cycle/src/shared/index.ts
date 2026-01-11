/**
 * Shared utilities for the Git cycle example
 *
 * This module provides common functionality used across all example steps:
 * - Storage initialization and setup
 * - Helper functions for common operations
 * - Console output formatting
 *
 * @see packages/storage-git/src/git-storage.ts - GitStorage class
 * @see packages/storage/src/types.ts - Core type definitions
 */

import {
  createGitRepository,
  createInMemoryFilesApi,
  FileMode,
  type FilesApi,
  type GitRepository,
  type ObjectId,
  type PersonIdent,
} from "@statewalker/vcs-core";
import { setCompression } from "@statewalker/vcs-utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";

// ============================================================================
// Compression Setup
// ============================================================================

/**
 * Initialize compression provider
 *
 * This MUST be called before any storage operations.
 * The compression module uses a global provider pattern to allow
 * different implementations (Node.js, browser WASM, etc.)
 *
 * @see packages/compression/src/index.ts - setCompression()
 * @see packages/compression/src/compression-node.ts - Node.js implementation
 */
let compressionInitialized = false;

export function initCompression(): void {
  if (!compressionInitialized) {
    setCompression(createNodeCompression());
    compressionInitialized = true;
  }
}

// ============================================================================
// Storage Factory
// ============================================================================

/**
 * Shared file system instance (in-memory for this example)
 *
 * For real file system usage, use createNodeFilesApi:
 * ```ts
 * import * as fs from "node:fs/promises";
 * import { createNodeFilesApi } from "@statewalker/vcs-core";
 * const files = createNodeFilesApi({ fs, rootDir: "/" });
 * ```
 */
let sharedFiles: FilesApi | null = null;

export function getFilesApi(): FilesApi {
  if (!sharedFiles) {
    sharedFiles = createInMemoryFilesApi();
  }
  return sharedFiles;
}

/**
 * Default git directory path
 */
export const GIT_DIR = "/demo-repo/.git";

/**
 * Shared repository instance
 *
 * Uses the high-level Repository interface from @statewalker/vcs-core.
 */
let sharedRepository: GitRepository | null = null;

/**
 * Get or create the shared repository instance
 *
 * Uses createGitRepository factory function which returns the
 * high-level Repository interface with typed stores.
 *
 * @see packages/storage-git/src/git-repository.ts - createGitRepository()
 */
export async function getStorage(): Promise<GitRepository> {
  initCompression();

  if (!sharedRepository) {
    const files = getFilesApi();
    sharedRepository = (await createGitRepository(files, GIT_DIR, {
      create: true,
      defaultBranch: "main",
    })) as GitRepository;
  }
  return sharedRepository;
}

/**
 * Close the shared repository
 */
export async function closeStorage(): Promise<void> {
  if (sharedRepository) {
    await sharedRepository.close();
    sharedRepository = null;
  }
}

/**
 * Reset repository (for fresh start in examples)
 */
export function resetStorage(): void {
  sharedRepository = null;
  sharedFiles = null;
}

// ============================================================================
// Author/Committer Helpers
// ============================================================================

/**
 * Base timestamp for commits (consistent across examples)
 */
export const BASE_TIMESTAMP = 1700000000; // 2023-11-14T22:13:20.000Z

/**
 * Create a PersonIdent for commits
 *
 * PersonIdent follows the Git format: "Name <email> timestamp timezone"
 *
 * @see packages/storage/src/types.ts - PersonIdent interface
 * @see packages/storage-git/src/format/person-ident.ts - Serialization
 *
 * @param name - Display name
 * @param email - Email address
 * @param hoursOffset - Hours after BASE_TIMESTAMP (for consistent examples)
 */
export function createAuthor(
  name = "Demo User",
  email = "demo@example.com",
  hoursOffset = 0,
): PersonIdent {
  return {
    name,
    email,
    timestamp: BASE_TIMESTAMP + hoursOffset * 3600,
    tzOffset: "+0000",
  };
}

// ============================================================================
// Blob Helpers
// ============================================================================

/**
 * Store text content as a blob using the high-level BlobStore
 *
 * Blobs are content-addressable: identical content produces identical IDs.
 * Content is hashed (SHA-1) to produce the ObjectId.
 *
 * Uses the typed BlobStore interface: repository.blobs.store()
 *
 * @see packages/core/src/stores/blob-store.ts - BlobStore interface
 * @see packages/storage-git/src/git-repository.ts - GitBlobStoreAdapter
 *
 * @param repository - Git repository instance
 * @param content - Text content to store
 * @returns ObjectId (SHA-1 hash as hex string)
 */
export async function storeBlob(repository: GitRepository, content: string): Promise<ObjectId> {
  const bytes = new TextEncoder().encode(content);
  return repository.blobs.store([bytes]);
}

/**
 * Read blob content as text using the high-level BlobStore
 *
 * Content is loaded as an AsyncIterable of chunks for memory efficiency.
 * For small files, chunks are combined into a single string.
 *
 * Uses the typed BlobStore interface: repository.blobs.load()
 *
 * @see packages/core/src/stores/blob-store.ts - BlobStore interface
 *
 * @param repository - Git repository instance
 * @param id - Blob ObjectId
 * @returns Text content
 */
export async function readBlob(repository: GitRepository, id: ObjectId): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of repository.blobs.load(id)) {
    chunks.push(chunk);
  }
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

// ============================================================================
// Tree Helpers
// ============================================================================

/**
 * List all files in a tree recursively
 *
 * Trees are directory snapshots containing entries with mode, name, and id.
 * Subdirectories (mode=TREE) are traversed recursively.
 *
 * Uses the typed TreeStore interface: repository.trees.loadTree()
 *
 * @see packages/core/src/stores/tree-store.ts - TreeStore interface
 *
 * @param repository - Git repository instance
 * @param treeId - Tree ObjectId
 * @param prefix - Path prefix for nested files
 * @returns Map of path -> ObjectId
 */
export async function listFilesRecursive(
  repository: GitRepository,
  treeId: ObjectId,
  prefix = "",
): Promise<Map<string, ObjectId>> {
  const files = new Map<string, ObjectId>();

  for await (const entry of repository.trees.loadTree(treeId)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.mode === FileMode.TREE) {
      const subFiles = await listFilesRecursive(repository, entry.id, path);
      for (const [subPath, subId] of subFiles) {
        files.set(subPath, subId);
      }
    } else {
      files.set(path, entry.id);
    }
  }

  return files;
}

// ============================================================================
// Console Output Helpers
// ============================================================================

/**
 * Format ObjectId for display (abbreviated)
 */
export function shortId(id: ObjectId): string {
  return id.substring(0, 7);
}

/**
 * Print a major section header
 */
export function printSection(title: string): void {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${title}`);
  console.log("=".repeat(70));
}

/**
 * Print a step header
 */
export function printStep(step: number, title: string): void {
  console.log(`\n--- Step ${step}: ${title} ---`);
}

/**
 * Print a subsection header
 */
export function printSubsection(title: string): void {
  console.log(`\n  >> ${title}`);
}

/**
 * Print an info line
 */
export function printInfo(label: string, value: string | number | boolean): void {
  console.log(`  ${label}: ${value}`);
}

/**
 * Print a code block
 */
export function printCode(code: string, indent = 4): void {
  const lines = code.split("\n");
  const prefix = " ".repeat(indent);
  for (const line of lines) {
    console.log(`${prefix}${line}`);
  }
}

// ============================================================================
// File Mode Helpers
// ============================================================================

/**
 * Get string representation of file mode
 *
 * @see packages/storage/src/types.ts - FileMode constants
 */
export function getModeString(mode: number): string {
  switch (mode) {
    case FileMode.TREE:
      return "040000";
    case FileMode.REGULAR_FILE:
      return "100644";
    case FileMode.EXECUTABLE_FILE:
      return "100755";
    case FileMode.SYMLINK:
      return "120000";
    case FileMode.GITLINK:
      return "160000";
    default:
      return mode.toString(8).padStart(6, "0");
  }
}

/**
 * Get type name for file mode
 */
export function getModeType(mode: number): string {
  switch (mode) {
    case FileMode.TREE:
      return "tree";
    case FileMode.REGULAR_FILE:
    case FileMode.EXECUTABLE_FILE:
      return "blob";
    case FileMode.SYMLINK:
      return "link";
    case FileMode.GITLINK:
      return "submodule";
    default:
      return "unknown";
  }
}

// Re-export commonly used types
export type {
  Commit,
  GitRepository,
  ObjectId,
  PersonIdent,
  Repository,
  TreeEntry,
} from "@statewalker/vcs-core";
export { FileMode, ObjectType } from "@statewalker/vcs-core";
