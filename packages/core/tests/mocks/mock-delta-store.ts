/**
 * Mock DeltaStore implementation for testing
 */

import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  DeltaStoreUpdate,
  ObjectTypeCode,
  StoredDelta,
} from "../../src/delta/delta-store.js";

/**
 * Pending delta for batch update
 */
interface PendingDelta {
  info: DeltaInfo;
  delta: Delta[];
}

/**
 * Batched update handle for mock delta storage
 */
class MockDeltaStoreUpdate implements DeltaStoreUpdate {
  private readonly pendingDeltas: PendingDelta[] = [];
  private readonly store: MockDeltaStore;
  private closed = false;

  constructor(store: MockDeltaStore) {
    this.store = store;
  }

  storeObject(_key: string, _type: ObjectTypeCode, _content: Uint8Array): void {
    if (this.closed) {
      throw new Error("Update already closed");
    }
    // Mock delta store only handles deltas
  }

  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number> {
    if (this.closed) {
      throw new Error("Update already closed");
    }

    this.pendingDeltas.push({ info, delta });

    return delta.reduce((sum, d) => {
      if (d.type === "insert") {
        return sum + d.data.length;
      }
      return sum + 8;
    }, 0);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    for (const { info, delta } of this.pendingDeltas) {
      this.store.applyDelta(info, delta);
    }
  }
}

/**
 * In-memory DeltaStore implementation for testing
 *
 * Stores deltas in a Map for fast lookup and easy inspection.
 */
export class MockDeltaStore implements DeltaStore {
  private readonly deltas = new Map<string, { info: DeltaInfo; delta: Delta[]; ratio: number }>();

  startUpdate(): DeltaStoreUpdate {
    return new MockDeltaStoreUpdate(this);
  }

  applyDelta(info: DeltaInfo, delta: Delta[]): void {
    this.deltas.set(info.targetKey, {
      info,
      delta,
      ratio: 0.5, // Default compression ratio for testing
    });
  }

  async loadDelta(targetKey: string): Promise<StoredDelta | undefined> {
    const entry = this.deltas.get(targetKey);
    if (!entry) return undefined;
    return {
      baseKey: entry.info.baseKey,
      targetKey: entry.info.targetKey,
      delta: entry.delta,
      ratio: entry.ratio,
    };
  }

  async isDelta(targetKey: string): Promise<boolean> {
    return this.deltas.has(targetKey);
  }

  async removeDelta(targetKey: string, _keepAsBase?: boolean): Promise<boolean> {
    return this.deltas.delete(targetKey);
  }

  async getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined> {
    const entry = this.deltas.get(targetKey);
    if (!entry) return undefined;

    // Build chain by following base references
    const chain: string[] = [targetKey];
    let current = entry.info.baseKey;
    let depth = 1;

    while (this.deltas.has(current)) {
      chain.push(current);
      const nextEntry = this.deltas.get(current);
      if (!nextEntry) break;
      current = nextEntry.info.baseKey;
      depth++;
    }
    chain.push(current); // Add final base

    return {
      baseKey: entry.info.baseKey,
      targetKey,
      depth,
      originalSize: 100, // Default for testing
      compressedSize: 50, // Default for testing
      chain,
    };
  }

  async *listDeltas(): AsyncIterable<DeltaInfo> {
    for (const entry of this.deltas.values()) {
      yield entry.info;
    }
  }

  /**
   * Get all stored deltas for inspection
   */
  getStoredDeltas(): Map<string, { info: DeltaInfo; delta: Delta[]; ratio: number }> {
    return new Map(this.deltas);
  }

  /**
   * Clear all stored deltas
   */
  clear(): void {
    this.deltas.clear();
  }

  /**
   * Set a specific compression ratio for a delta (for testing)
   */
  setRatio(targetKey: string, ratio: number): void {
    const entry = this.deltas.get(targetKey);
    if (entry) {
      entry.ratio = ratio;
    }
  }
}
