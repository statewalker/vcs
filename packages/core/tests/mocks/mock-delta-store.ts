/**
 * Mock DeltaStore implementation for testing
 */

import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  StoredDelta,
} from "../../src/delta/delta-store.js";

/**
 * In-memory DeltaStore implementation for testing
 *
 * Stores deltas in a Map for fast lookup and easy inspection.
 */
export class MockDeltaStore implements DeltaStore {
  private readonly deltas = new Map<
    string,
    { info: DeltaInfo; delta: Delta[]; ratio: number }
  >();

  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number> {
    const estimatedSize = this.estimateDeltaSize(delta);
    this.deltas.set(info.targetKey, {
      info,
      delta,
      ratio: 0.5, // Default compression ratio for testing
    });
    return estimatedSize;
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

  async getDeltaChainInfo(
    targetKey: string,
  ): Promise<DeltaChainDetails | undefined> {
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
  getStoredDeltas(): Map<
    string,
    { info: DeltaInfo; delta: Delta[]; ratio: number }
  > {
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

  private estimateDeltaSize(delta: Delta[]): number {
    let size = 0;
    for (const instruction of delta) {
      if (instruction.type === "insert") {
        size += instruction.data.length;
      } else {
        size += 8; // Approximate size for copy/start/finish instructions
      }
    }
    return size;
  }
}
