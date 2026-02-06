/**
 * Git Files Storage Backend
 *
 * StorageBackend implementation that uses native Git file structures:
 * - Loose objects in objects/XX/XXXX... files
 * - Pack files in objects/pack/*.pack with .idx index files
 * - Delta compression using Git's OFS_DELTA/REF_DELTA formats
 *
 * This is the primary backend for file-based repositories.
 *
 * ## New Pattern (Recommended)
 *
 * Use the factory pattern for new code:
 * - `createGitFilesHistory()` - Creates HistoryWithOperations directly
 * - `GitFilesHistoryFactory` - Implements HistoryBackendFactory interface
 *
 * ## Legacy Pattern (Deprecated)
 *
 * The `GitFilesStorageBackend` class is deprecated.
 * Use `createGitFilesHistory()` or `GitFilesHistoryFactory` instead.
 */

import type { ObjectId } from "../common/id/object-id.js";
import type { BlobStore } from "../history/blobs/blob-store.js";
import type { CommitStore } from "../history/commits/commit-store.js";
import type { HistoryWithOperations } from "../history/history.js";
import type { RefStore } from "../history/refs/ref-store.js";
import type { TagStore } from "../history/tags/tag-store.js";
import type { TreeStore } from "../history/trees/tree-store.js";
import { DefaultSerializationApi } from "../serialization/serialization-api.impl.js";
import type { SerializationApi } from "../serialization/serialization-api.js";
import type {
  BlobDeltaApi,
  BlobDeltaChainInfo,
  StreamingDeltaResult,
} from "../storage/delta/blob-delta-api.js";
import type { DeltaApi, StorageDeltaRelationship } from "../storage/delta/delta-api.js";
import type { PackDeltaStore } from "./git/pack/index.js";
import type { BaseBackendConfig, HistoryBackendFactory } from "./history-backend-factory.js";
import type { BackendCapabilities, StorageOperations } from "./storage-backend.js";

/**
 * Configuration for GitFilesStorageBackend
 */
export interface GitFilesStorageBackendConfig extends BaseBackendConfig {
  /** Blob store implementation */
  blobs: BlobStore;
  /** Tree store implementation */
  trees: TreeStore;
  /** Commit store implementation */
  commits: CommitStore;
  /** Tag store implementation */
  tags: TagStore;
  /** Ref store implementation */
  refs: RefStore;
  /** Pack-based delta store for native Git delta operations */
  packDeltaStore: PackDeltaStore;
}

/**
 * BlobDeltaApi implementation using PackDeltaStore
 *
 * Wraps PackDeltaStore's delta operations with the typed BlobDeltaApi interface.
 *
 * @internal Exported for use by GitFilesHistoryFactory
 */
export class GitFilesBlobDeltaApi implements BlobDeltaApi {
  constructor(
    private readonly packDeltaStore: PackDeltaStore,
    private readonly blobs: BlobStore,
  ) {}

  async findBlobDelta(
    _targetId: ObjectId,
    _candidates: AsyncIterable<ObjectId>,
  ): Promise<StreamingDeltaResult | null> {
    // Delta computation is handled by DeltaEngine externally
    // This API is for storage operations, not computation
    return null;
  }

  async deltifyBlob(
    targetId: ObjectId,
    baseId: ObjectId,
    delta: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    // Collect delta bytes
    const chunks: Uint8Array[] = [];
    for await (const chunk of delta) {
      chunks.push(chunk);
    }

    // Get blob content for the target to store as full object first
    const targetContent = await this.loadBlobContent(targetId);
    if (!targetContent) {
      throw new Error(`Target blob ${targetId} not found`);
    }

    // Start batch update to create pack with delta
    const update = this.packDeltaStore.startUpdate();

    // Store target as delta
    const { parseBinaryDelta } = await import("../storage/delta/delta-binary-format.js");
    const deltaBytes = concatBytes(chunks);
    const deltaInstructions = parseBinaryDelta(deltaBytes);

    await update.storeDelta({ baseKey: baseId, targetKey: targetId }, deltaInstructions);

    // Commit the pack
    await update.close();
  }

  async undeltifyBlob(id: ObjectId): Promise<void> {
    // Load resolved content from pack
    const content = await this.packDeltaStore.loadObject(id);
    if (!content) {
      throw new Error(`Blob ${id} not found in pack files`);
    }

    // The content is now resolved - removing delta just means
    // the pack file marks it as removed (handled by removeDelta)
    await this.packDeltaStore.removeDelta(id, true);
  }

  async isBlobDelta(id: ObjectId): Promise<boolean> {
    return this.packDeltaStore.isDelta(id);
  }

  async getBlobDeltaChain(id: ObjectId): Promise<BlobDeltaChainInfo | undefined> {
    const chainInfo = await this.packDeltaStore.getDeltaChainInfo(id);
    if (!chainInfo) return undefined;

    return {
      depth: chainInfo.depth,
      totalSize: chainInfo.compressedSize,
      baseIds: chainInfo.chain,
    };
  }

  private async loadBlobContent(id: ObjectId): Promise<Uint8Array | null> {
    try {
      const stream = this.blobs.load(id);
      const chunks: Uint8Array[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      return concatBytes(chunks);
    } catch {
      return null;
    }
  }
}

/**
 * DeltaApi implementation using PackDeltaStore
 *
 * Provides the unified delta interface backed by Git pack files.
 *
 * @internal Exported for use by GitFilesHistoryFactory
 */
export class GitFilesDeltaApi implements DeltaApi {
  readonly blobs: BlobDeltaApi;
  private batchDepth = 0;

  constructor(
    private readonly packDeltaStore: PackDeltaStore,
    blobStore: BlobStore,
  ) {
    this.blobs = new GitFilesBlobDeltaApi(packDeltaStore, blobStore);
  }

  async isDelta(id: ObjectId): Promise<boolean> {
    return this.packDeltaStore.isDelta(id);
  }

  async getDeltaChain(id: ObjectId): Promise<BlobDeltaChainInfo | undefined> {
    return this.blobs.getBlobDeltaChain(id);
  }

  async *listDeltas(): AsyncIterable<StorageDeltaRelationship> {
    for await (const deltaInfo of this.packDeltaStore.listDeltas()) {
      const chainInfo = await this.packDeltaStore.getDeltaChainInfo(deltaInfo.targetKey);
      yield {
        targetId: deltaInfo.targetKey,
        baseId: deltaInfo.baseKey,
        depth: chainInfo?.depth ?? 1,
        ratio: 0, // Would need to compute from sizes
      };
    }
  }

  async *getDependents(baseId: ObjectId): AsyncIterable<ObjectId> {
    const dependents = await this.packDeltaStore.findDependents(baseId);
    for (const dep of dependents) {
      yield dep;
    }
  }

  startBatch(): void {
    this.batchDepth++;
    // PackDeltaStore uses startUpdate() per batch, not global state
  }

  async endBatch(): Promise<void> {
    if (this.batchDepth <= 0) {
      throw new Error("No batch in progress");
    }
    this.batchDepth--;
    // Each deltifyBlob creates its own update and commits
  }

  cancelBatch(): void {
    if (this.batchDepth > 0) {
      this.batchDepth--;
    }
  }
}

/**
 * Git Files Storage Backend
 *
 * Full StorageBackend implementation using native Git file structures.
 * Supports:
 * - Reading/writing loose objects
 * - Reading/writing pack files with index
 * - Delta compression using OFS_DELTA/REF_DELTA
 *
 * @deprecated Use `createGitFilesHistory()` or `GitFilesHistoryFactory` instead.
 * The new pattern returns HistoryWithOperations directly, providing unified
 * access to typed stores and storage operations.
 *
 * Migration:
 * ```typescript
 * // Old pattern (deprecated)
 * const backend = new GitFilesStorageBackend(config);
 * const history = createHistoryWithOperations({ backend });
 *
 * // New pattern (recommended)
 * const history = createGitFilesHistory(config);
 * // OR use the factory:
 * const factory = new GitFilesHistoryFactory();
 * const history = await factory.createHistory(config);
 * ```
 */
export class GitFilesStorageBackend {
  readonly blobs: BlobStore;
  readonly trees: TreeStore;
  readonly commits: CommitStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
  readonly delta: DeltaApi;
  readonly serialization: SerializationApi;
  readonly capabilities: BackendCapabilities = {
    nativeBlobDeltas: true,
    randomAccess: true,
    atomicBatch: true,
    nativeGitFormat: true,
  };

  private readonly packDeltaStore: PackDeltaStore;
  private initialized = false;

  constructor(config: GitFilesStorageBackendConfig) {
    this.blobs = config.blobs;
    this.trees = config.trees;
    this.commits = config.commits;
    this.tags = config.tags;
    this.refs = config.refs;

    this.packDeltaStore = config.packDeltaStore;
    this.delta = new GitFilesDeltaApi(config.packDeltaStore, config.blobs);
    this.serialization = new DefaultSerializationApi({
      blobs: this.blobs,
      trees: this.trees,
      commits: this.commits,
      tags: this.tags,
      refs: this.refs,
      blobDeltaApi: this.delta.blobs,
    });
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.packDeltaStore.initialize();
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (!this.initialized) return;

    await this.packDeltaStore.close();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get direct access to PackDeltaStore for advanced operations
   *
   * Use this for:
   * - Building reverse index for efficient queries
   * - Direct pack file manipulation
   * - GC and repacking operations
   */
  getPackDeltaStore(): PackDeltaStore {
    return this.packDeltaStore;
  }

  /**
   * Get storage operations (delta and serialization APIs)
   *
   * Returns a StorageOperations interface without the typed stores.
   * This is the preferred way to access delta and serialization APIs
   * going forward, as it separates concerns from the History interface.
   *
   * @returns StorageOperations implementation
   */
  getOperations(): StorageOperations {
    return new GitFilesStorageOperations(this);
  }
}

/**
 * StorageOperations implementation for GitFilesStorageBackend
 *
 * Wraps the backend's delta and serialization APIs without exposing stores.
 *
 * @internal Exported for use by GitFilesHistoryFactory
 */
export class GitFilesStorageOperations implements StorageOperations {
  constructor(private readonly backend: GitFilesStorageBackend) {}

  get delta(): DeltaApi {
    return this.backend.delta;
  }

  get serialization(): SerializationApi {
    return this.backend.serialization;
  }

  get capabilities(): BackendCapabilities {
    return this.backend.capabilities;
  }

  initialize(): Promise<void> {
    return this.backend.initialize();
  }

  close(): Promise<void> {
    return this.backend.close();
  }
}

/**
 * Concatenate byte arrays
 */
function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * GitFilesHistoryFactory - Factory for creating Git-files backed HistoryWithOperations
 *
 * Implements the HistoryBackendFactory interface to create HistoryWithOperations
 * instances directly from Git-files storage configuration.
 *
 * @example
 * ```typescript
 * const factory = new GitFilesHistoryFactory();
 * const history = await factory.createHistory({
 *   blobs, trees, commits, tags, refs,
 *   packDeltaStore,
 * });
 * await history.initialize();
 *
 * // Use history for normal operations
 * const commit = await history.commits.load(commitId);
 *
 * // Use delta API for GC
 * history.delta.startBatch();
 * await history.delta.blobs.deltifyBlob(blobId, baseId, delta);
 * await history.delta.endBatch();
 *
 * await history.close();
 * ```
 */
export class GitFilesHistoryFactory implements HistoryBackendFactory<GitFilesStorageBackendConfig> {
  /**
   * Create a full HistoryWithOperations instance
   *
   * Returns an uninitialized instance. Call initialize() before use.
   *
   * @param config Git-files storage backend configuration with all stores
   * @returns HistoryWithOperations instance (not yet initialized)
   */
  async createHistory(config: GitFilesStorageBackendConfig): Promise<HistoryWithOperations> {
    // Import dynamically to avoid circular dependency
    const { createGitFilesHistory } = await import("../history/create-history.js");
    return createGitFilesHistory(config);
  }

  /**
   * Create only storage operations (delta and serialization APIs)
   *
   * Use this when you only need delta compression or pack file operations
   * without the full History interface.
   *
   * @param config Git-files storage backend configuration
   * @returns StorageOperations instance (not yet initialized)
   */
  async createOperations(config: GitFilesStorageBackendConfig): Promise<StorageOperations> {
    const backend = new GitFilesStorageBackend(config);
    return backend.getOperations();
  }
}
