/**
 * StorageBackend - Unified interface for VCS storage
 *
 * The unified storage contract that all backends must implement.
 * Provides two perspectives on the same underlying data:
 *
 * 1. **DeltaApi** - Blob delta operations for storage optimization
 * 2. **SerializationApi** - Git-compatible wire format I/O
 *
 * For typed access to Git objects, use the History interface instead:
 * ```typescript
 * import { createHistoryFromBackend } from "@statewalker/vcs-core";
 * const history = createHistoryFromBackend({ backend });
 * const commit = await history.commits.load(commitId);
 * ```
 *
 * Each backend implements all APIs optimally for its storage type:
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
 * // Use History for typed object access
 * const history = createHistoryFromBackend({ backend });
 * const commit = await history.commits.load(commitId);
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

import type { BlobStore } from "../history/blobs/blob-store.js";
import type { CommitStore } from "../history/commits/commit-store.js";
import type { RefStore } from "../history/refs/ref-store.js";
import type { TagStore } from "../history/tags/tag-store.js";
import type { TreeStore } from "../history/trees/tree-store.js";
import type { SerializationApi } from "../serialization/serialization-api.js";
import type { DeltaApi } from "../storage/delta/delta-api.js";

// Re-export SerializationApi types for convenience
// Note: PackEntry and PackHeader are not re-exported to avoid conflicts
// with backend/git/pack types. Import from serialization-api directly if needed.
// Re-export serialization-specific types with qualified names to avoid ambiguity
export type {
  PackBuilder,
  PackBuildStats,
  PackEntry as SerializationPackEntry,
  PackHeader as SerializationPackHeader,
  PackImportResult,
  PackOptions,
  PackReaderApi,
  ParsedObjectMeta,
  SerializationApi,
} from "../serialization/serialization-api.js";

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
 * @deprecated Use StorageOperations instead. This interface bundles typed stores
 * with storage operations, creating redundancy with the History interface.
 * StorageOperations provides only delta and serialization APIs without the stores.
 * This interface will be removed in a future version.
 *
 * Migration path:
 * - For delta/serialization operations: Use StorageOperations via backend.getOperations()
 * - For typed object access: Use History interface (blobs, trees, commits, tags, refs)
 * - For combined access: Use HistoryWithOperations instead of HistoryWithBackend
 *
 * All storage implementations must provide the core APIs.
 * This enables consistent behavior across different storage types.
 */
export interface StorageBackend {
  /**
   * Blob (file content) storage
   *
   * Access via History interface is recommended:
   * ```typescript
   * const history = createHistoryFromBackend({ backend });
   * const blob = await history.blobs.load(blobId);
   * ```
   */
  readonly blobs: BlobStore;

  /**
   * Tree (directory structure) storage
   */
  readonly trees: TreeStore;

  /**
   * Commit (version snapshot) storage
   */
  readonly commits: CommitStore;

  /**
   * Tag (annotated tag) storage
   */
  readonly tags: TagStore;

  /**
   * Reference (branch/tag pointer) storage
   */
  readonly refs: RefStore;

  /**
   * Delta/raw content manipulation
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
 * Storage operations for optimization and transport
 *
 * This interface provides low-level storage operations that are NOT part
 * of the main History interface:
 * - Delta compression for storage optimization
 * - Serialization for pack file I/O and Git interoperability
 *
 * Unlike StorageBackend, this does not include typed stores (blobs, trees, etc.)
 * which are provided by the History interface instead.
 *
 * @example
 * ```typescript
 * // Use delta API for storage optimization
 * operations.delta.startBatch();
 * await operations.delta.blobs.deltifyBlob(blobId, baseId, deltaStream);
 * await operations.delta.endBatch();
 *
 * // Use serialization API for Git interop
 * const pack = operations.serialization.createPack(objectIds);
 * await operations.serialization.importPack(receivedPackStream);
 * ```
 */
export interface StorageOperations {
  /**
   * Delta/raw content manipulation
   *
   * Only blobs have delta support in internal storage.
   * Used for GC, repacking, and storage optimization.
   */
  readonly delta: DeltaApi;

  /**
   * Git-compatible serialization
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
   * Initialize the storage operations
   *
   * Must be called before using any API.
   * Creates storage structures if needed and configured.
   *
   * @throws Error if initialization fails
   */
  initialize(): Promise<void>;

  /**
   * Close the storage operations
   *
   * Releases resources, flushes pending writes.
   * Should not be used after close().
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
