/**
 * Memory Storage Backend
 *
 * In-memory implementations of DeltaApi for testing and ephemeral storage.
 *
 * ## Usage
 *
 * Use the factory function for new code:
 * - `createMemoryHistoryWithOperations()` - Creates HistoryWithOperations directly
 */

import type { ObjectId } from "../common/id/object-id.js";
import type { Blobs } from "../history/blobs/blobs.js";
import type {
  BlobDeltaApi,
  BlobDeltaChainInfo,
  StreamingDeltaResult,
} from "../storage/delta/blob-delta-api.js";
import type { DeltaApi, StorageDeltaRelationship } from "../storage/delta/delta-api.js";

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
 * Uses the new Blobs interface.
 *
 * @internal Exported for use by createMemoryHistoryWithOperations
 */
export class MemoryBlobDeltaApi implements BlobDeltaApi {
  constructor(
    readonly _blobs: Blobs,
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
 * Uses the new Blobs interface.
 *
 * @internal Exported for use by createMemoryHistoryWithOperations
 */
export class MemoryDeltaApi implements DeltaApi {
  readonly blobs: BlobDeltaApi;
  private batchDepth = 0;

  constructor(
    blobs: Blobs,
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
