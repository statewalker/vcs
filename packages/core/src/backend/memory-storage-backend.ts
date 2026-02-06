/**
 * Memory Storage Backend
 *
 * Simple in-memory implementation of StorageBackend for testing.
 * Wraps existing memory stores to provide the unified interface.
 *
 * ## New Pattern (Recommended)
 *
 * Use the factory pattern for new code:
 * - `createMemoryHistoryWithOperations()` - Creates HistoryWithOperations directly
 * - `MemoryHistoryFactory` - Implements HistoryBackendFactory interface
 *
 * ## Legacy Pattern (Deprecated)
 *
 * The `MemoryStorageBackend` class is deprecated.
 * Use `createMemoryHistoryWithOperations()` or `MemoryHistoryFactory` instead.
 */

import type { ObjectId } from "../common/id/object-id.js";
import type { BlobStore } from "../history/blobs/blob-store.js";
import type { Blobs } from "../history/blobs/blobs.js";
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
import type { HistoryBackendFactory, MemoryBackendConfig } from "./history-backend-factory.js";
import type { BackendCapabilities, StorageOperations } from "./storage-backend.js";

/**
 * Configuration for creating MemoryStorageBackend
 */
export interface MemoryStorageBackendConfig {
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
  /** Optional delta tracking for blobs */
  deltaTracker?: DeltaTracker;
}

/**
 * Simple delta tracking interface for memory backend
 *
 * Tracks which blobs are stored as deltas vs full content.
 */
export interface DeltaTracker {
  /** Check if blob is stored as delta */
  isDelta(id: ObjectId): Promise<boolean>;
  /** Get delta chain info */
  getChain(id: ObjectId): Promise<BlobDeltaChainInfo | undefined>;
  /** Store blob as delta */
  storeDelta(targetId: ObjectId, baseId: ObjectId, delta: Uint8Array): Promise<void>;
  /** Expand delta to full content */
  undeltify(id: ObjectId): Promise<void>;
  /** List all delta relationships */
  listDeltas(): AsyncIterable<StorageDeltaRelationship>;
  /** Get dependents of a base */
  getDependents(baseId: ObjectId): AsyncIterable<ObjectId>;
}

/**
 * In-memory BlobDeltaApi implementation
 *
 * Accepts both old BlobStore (deprecated) and new Blobs interface for migration compatibility.
 *
 * @internal Exported for use by MemoryHistoryFactory
 */
export class MemoryBlobDeltaApi implements BlobDeltaApi {
  constructor(
    readonly _blobs: Blobs | BlobStore,
    private readonly tracker: DeltaTracker | undefined,
  ) {}

  async findBlobDelta(
    _targetId: ObjectId,
    _candidates: AsyncIterable<ObjectId>,
  ): Promise<StreamingDeltaResult | null> {
    // Memory backend doesn't compute deltas internally
    // Delta computation is handled by DeltaEngine externally
    return null;
  }

  async deltifyBlob(
    targetId: ObjectId,
    baseId: ObjectId,
    delta: AsyncIterable<Uint8Array>,
  ): Promise<void> {
    if (!this.tracker) {
      // No delta tracking - silently ignore
      return;
    }

    // Collect delta bytes
    const chunks: Uint8Array[] = [];
    for await (const chunk of delta) {
      chunks.push(chunk);
    }
    const deltaBytes = concatBytes(chunks);

    await this.tracker.storeDelta(targetId, baseId, deltaBytes);
  }

  async undeltifyBlob(id: ObjectId): Promise<void> {
    if (!this.tracker) {
      return;
    }
    await this.tracker.undeltify(id);
  }

  async isBlobDelta(id: ObjectId): Promise<boolean> {
    if (!this.tracker) {
      return false;
    }
    return this.tracker.isDelta(id);
  }

  async getBlobDeltaChain(id: ObjectId): Promise<BlobDeltaChainInfo | undefined> {
    if (!this.tracker) {
      return undefined;
    }
    return this.tracker.getChain(id);
  }
}

/**
 * In-memory DeltaApi implementation
 *
 * Accepts both old BlobStore (deprecated) and new Blobs interface for migration compatibility.
 *
 * @internal Exported for use by MemoryHistoryFactory
 */
export class MemoryDeltaApi implements DeltaApi {
  readonly blobs: BlobDeltaApi;
  private batchDepth = 0;

  constructor(
    blobs: Blobs | BlobStore,
    private readonly tracker: DeltaTracker | undefined,
  ) {
    this.blobs = new MemoryBlobDeltaApi(blobs, tracker);
  }

  async isDelta(id: ObjectId): Promise<boolean> {
    return this.blobs.isBlobDelta(id);
  }

  async getDeltaChain(id: ObjectId): Promise<BlobDeltaChainInfo | undefined> {
    return this.blobs.getBlobDeltaChain(id);
  }

  async *listDeltas(): AsyncIterable<StorageDeltaRelationship> {
    if (this.tracker) {
      yield* this.tracker.listDeltas();
    }
  }

  async *getDependents(baseId: ObjectId): AsyncIterable<ObjectId> {
    if (this.tracker) {
      yield* this.tracker.getDependents(baseId);
    }
  }

  startBatch(): void {
    this.batchDepth++;
  }

  async endBatch(): Promise<void> {
    if (this.batchDepth <= 0) {
      throw new Error("No batch in progress");
    }
    this.batchDepth--;
    // Memory backend doesn't need atomic commit
  }

  cancelBatch(): void {
    if (this.batchDepth > 0) {
      this.batchDepth--;
    }
    // Memory backend doesn't need rollback
  }
}

/**
 * In-memory StorageBackend implementation
 *
 * Simple implementation for testing and simple use cases.
 * Does not provide efficient delta compression.
 *
 * @deprecated Use `createMemoryHistoryWithOperations()` or `MemoryHistoryFactory` instead.
 * The new pattern returns HistoryWithOperations directly, providing unified
 * access to typed stores and storage operations.
 *
 * Migration:
 * ```typescript
 * // Old pattern (deprecated)
 * const backend = new MemoryStorageBackend(config);
 * const history = createHistoryWithOperations({ backend });
 *
 * // New pattern (recommended)
 * const history = createMemoryHistoryWithOperations();
 * // OR use the factory:
 * const factory = new MemoryHistoryFactory();
 * const history = await factory.createHistory({});
 * ```
 */
export class MemoryStorageBackend {
  readonly blobs: BlobStore;
  readonly trees: TreeStore;
  readonly commits: CommitStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
  readonly delta: DeltaApi;
  readonly serialization: SerializationApi;
  readonly capabilities: BackendCapabilities = {
    nativeBlobDeltas: false,
    randomAccess: true,
    atomicBatch: false,
    nativeGitFormat: false,
  };

  private initialized = false;

  constructor(config: MemoryStorageBackendConfig) {
    this.blobs = config.blobs;
    this.trees = config.trees;
    this.commits = config.commits;
    this.tags = config.tags;
    this.refs = config.refs;

    this.delta = new MemoryDeltaApi(config.blobs, config.deltaTracker);
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
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
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
    return new MemoryStorageOperations(this);
  }
}

/**
 * StorageOperations implementation for MemoryStorageBackend
 *
 * Wraps the backend's delta and serialization APIs without exposing stores.
 *
 * @internal Exported for use by MemoryHistoryFactory
 */
export class MemoryStorageOperations implements StorageOperations {
  constructor(private readonly backend: MemoryStorageBackend) {}

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
 * MemoryHistoryFactory - Factory for creating in-memory HistoryWithOperations
 *
 * Implements the HistoryBackendFactory interface to create HistoryWithOperations
 * instances directly from in-memory storage configuration.
 *
 * @example
 * ```typescript
 * const factory = new MemoryHistoryFactory();
 * const history = await factory.createHistory({});
 * await history.initialize();
 *
 * // Use history for normal operations
 * const id = await history.blobs.store([new TextEncoder().encode("test")]);
 *
 * // Use delta API for storage optimization
 * history.delta.startBatch();
 * await history.delta.blobs.deltifyBlob(targetId, baseId, delta);
 * await history.delta.endBatch();
 *
 * await history.close();
 * ```
 */
export class MemoryHistoryFactory implements HistoryBackendFactory<MemoryBackendConfig> {
  /**
   * Create a full HistoryWithOperations instance
   *
   * Returns an uninitialized instance. Call initialize() before use.
   *
   * @param config Memory backend configuration (optional delta tracking)
   * @returns HistoryWithOperations instance (not yet initialized)
   */
  async createHistory(config: MemoryBackendConfig = {}): Promise<HistoryWithOperations> {
    // Import dynamically to avoid circular dependency
    const { createMemoryHistoryWithOperations } = await import("../history/create-history.js");
    return createMemoryHistoryWithOperations(config);
  }

  /**
   * Create only storage operations (delta and serialization APIs)
   *
   * Use this when you only need delta compression operations
   * without the full History interface.
   *
   * @param config Memory backend configuration
   * @returns StorageOperations instance (not yet initialized)
   */
  async createOperations(config: MemoryBackendConfig = {}): Promise<StorageOperations> {
    // Create a minimal memory backend for operations
    const { createMemoryHistoryWithOperations } = await import("../history/create-history.js");
    const history = createMemoryHistoryWithOperations(config);

    // Return a StorageOperations wrapper
    return {
      delta: history.delta,
      serialization: history.serialization,
      capabilities: history.capabilities,
      initialize: () => history.initialize(),
      close: () => history.close(),
    };
  }
}
