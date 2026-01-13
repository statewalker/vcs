/**
 * StorageBackend - Unified interface for VCS storage
 *
 * The unified storage contract that all backends must implement.
 * Provides three perspectives on the same underlying data:
 *
 * 1. **StructuredStores** - Typed access to parsed Git objects
 * 2. **DeltaApi** - Blob delta operations for storage optimization
 * 3. **SerializationApi** - Git-compatible wire format I/O
 *
 * Each backend implements all three APIs optimally for its storage type:
 * - Git Files: Direct file access, pack files for delta/serialization
 * - SQL: Tables with indexed fields, transactions for atomicity
 * - Memory: In-memory maps, fast for testing
 * - KV: Key-value storage with custom encoding
 *
 * @example
 * ```typescript
 * // Create backend
 * const backend = createStorageBackend("git-files", { path: ".git" });
 * await backend.initialize();
 *
 * // Use structured stores for application logic
 * const commit = await backend.structured.commits.loadCommit(commitId);
 * const tree = backend.structured.trees.loadTree(commit.tree);
 *
 * // Use delta API for storage optimization
 * backend.delta.startBatch();
 * await backend.delta.blobs.deltifyBlob(blobId, baseId, deltaStream);
 * await backend.delta.endBatch();
 *
 * // Use serialization API for Git interop
 * const pack = backend.serialization.createPack(objectIds);
 * await backend.serialization.importPack(receivedPackStream);
 *
 * // Cleanup
 * await backend.close();
 * ```
 */

import type { StructuredStores } from "../history/structured-stores.js";
import type { DeltaApi } from "../storage/delta/delta-api.js";

/**
 * Serialization API placeholder
 *
 * Full implementation will be added in a later task.
 * For now, defines the interface shape.
 */
export type SerializationApi = {};

/**
 * Backend capability flags
 *
 * Describes what a backend can do natively vs. requiring emulation.
 * Used for optimization decisions and feature detection.
 */
export interface BackendCapabilities {
  /**
   * Can store blob deltas natively
   *
   * If true, blob deltas are stored as deltas.
   * If false, deltifyBlob() resolves to full content before storing.
   */
  nativeBlobDeltas: boolean;

  /**
   * Supports random access reads
   *
   * If true, can efficiently read arbitrary byte ranges.
   * Required for efficient delta computation.
   */
  randomAccess: boolean;

  /**
   * Supports atomic batch operations
   *
   * If true, batch operations (startBatch/endBatch) are truly atomic.
   * If false, partial commits may occur on failure.
   */
  atomicBatch: boolean;

  /**
   * Already stores data in Git format
   *
   * If true, serialization is essentially a no-op (just read files).
   * If false, objects must be serialized/deserialized on I/O.
   */
  nativeGitFormat: boolean;
}

/**
 * Backend configuration options
 *
 * Different backends accept different options.
 * Common options defined here, backend-specific via extension.
 */
export interface BackendConfig {
  /** Path for file-based backends */
  path?: string;
  /** Connection string for SQL backends */
  connectionString?: string;
  /** Whether to create storage if it doesn't exist */
  create?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
}

/**
 * StorageBackend - The unified storage contract
 *
 * All storage implementations must provide all three APIs.
 * This enables consistent behavior across different storage types.
 */
export interface StorageBackend {
  /**
   * API 1: Structured access to typed objects
   *
   * Provides BlobStore, TreeStore, CommitStore, TagStore, RefStore.
   * This is the primary application-facing API.
   */
  readonly structured: StructuredStores;

  /**
   * API 2: Delta/raw content manipulation
   *
   * Only blobs have delta support in internal storage.
   * Used for GC, repacking, and storage optimization.
   */
  readonly delta: DeltaApi;

  /**
   * API 3: Git-compatible serialization
   *
   * For pack file creation/parsing and loose object I/O.
   * Used for transport (fetch/push) and Git interoperability.
   */
  readonly serialization: SerializationApi;

  /**
   * Backend capabilities
   *
   * Describes what this backend supports natively.
   * Used for optimization and feature detection.
   */
  readonly capabilities: BackendCapabilities;

  /**
   * Initialize the backend
   *
   * Must be called before using any API.
   * Creates storage structures if needed and configured.
   *
   * @throws Error if initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Close the backend
   *
   * Releases resources, flushes pending writes.
   * Backend should not be used after close().
   */
  close(): Promise<void>;
}

/**
 * Supported backend types
 */
export type BackendType = "git-files" | "sql" | "kv" | "memory";

/**
 * Factory function signature for creating backends
 *
 * Each backend type has its own implementation.
 * The factory selects the appropriate one.
 */
export type BackendFactory = (type: BackendType, config: BackendConfig) => StorageBackend;
