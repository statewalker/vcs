/**
 * Memory Storage Backend
 *
 * Simple in-memory implementation of StorageBackend for testing.
 * Wraps existing memory stores to provide the unified interface.
 */

import type { ObjectId } from "../common/id/object-id.js";
import type { BlobStore } from "../history/blobs/blob-store.js";
import type { CommitStore } from "../history/commits/commit-store.js";
import type { RefStore } from "../history/refs/ref-store.js";
import type { StructuredStores } from "../history/structured-stores.js";
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
import type { BackendCapabilities, StorageBackend } from "./storage-backend.js";

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
 */
class MemoryBlobDeltaApi implements BlobDeltaApi {
  constructor(
    readonly _blobs: BlobStore,
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
 */
class MemoryDeltaApi implements DeltaApi {
  readonly blobs: BlobDeltaApi;
  private batchDepth = 0;

  constructor(
    blobStore: BlobStore,
    private readonly tracker: DeltaTracker | undefined,
  ) {
    this.blobs = new MemoryBlobDeltaApi(blobStore, tracker);
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
 */
export class MemoryStorageBackend implements StorageBackend {
  readonly structured: StructuredStores;
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
    this.structured = {
      blobs: config.blobs,
      trees: config.trees,
      commits: config.commits,
      tags: config.tags,
      refs: config.refs,
    };

    this.delta = new MemoryDeltaApi(config.blobs, config.deltaTracker);
    this.serialization = new DefaultSerializationApi({
      stores: this.structured,
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
