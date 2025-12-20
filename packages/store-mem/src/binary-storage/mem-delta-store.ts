/**
 * In-memory DeltaStore implementation
 *
 * Stores delta relationships and instructions in memory.
 * Implements the new DeltaStore interface from binary-storage.
 */

import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  StoredDelta,
} from "@webrun-vcs/vcs/binary-storage";

/**
 * Internal delta entry storage
 */
interface DeltaEntry {
  baseKey: string;
  targetKey: string;
  delta: Delta[];
  ratio: number;
}

/**
 * In-memory delta storage implementation
 *
 * Stores delta relationships with support for chain traversal.
 * Maximum chain depth is enforced to prevent infinite loops.
 */
export class MemDeltaStore implements DeltaStore {
  private readonly deltas = new Map<string, DeltaEntry>();
  private readonly maxChainDepth = 50;

  /**
   * Store a delta relationship
   */
  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number> {
    // Calculate approximate ratio
    const deltaSize = delta.reduce((sum, d) => {
      switch (d.type) {
        case "copy":
          return sum + 8; // offset + length
        case "insert":
          return sum + 1 + d.data.length; // type + data
        case "start":
        case "finish":
          return sum + 4; // small overhead
        default:
          return sum;
      }
    }, 0);

    // We don't have the original size, so ratio is approximate
    const ratio = deltaSize > 0 ? 1 : 0;

    this.deltas.set(info.targetKey, {
      baseKey: info.baseKey,
      targetKey: info.targetKey,
      delta,
      ratio,
    });

    return deltaSize;
  }

  /**
   * Load delta for an object
   */
  async loadDelta(targetKey: string): Promise<StoredDelta | undefined> {
    const entry = this.deltas.get(targetKey);
    if (!entry) {
      return undefined;
    }

    return {
      baseKey: entry.baseKey,
      targetKey: entry.targetKey,
      delta: entry.delta,
      ratio: entry.ratio,
    };
  }

  /**
   * Check if object is stored as delta
   */
  async isDelta(targetKey: string): Promise<boolean> {
    return this.deltas.has(targetKey);
  }

  /**
   * Remove delta relationship
   */
  async removeDelta(targetKey: string, _keepAsBase?: boolean): Promise<boolean> {
    return this.deltas.delete(targetKey);
  }

  /**
   * Get delta chain info for an object
   */
  async getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined> {
    const entry = this.deltas.get(targetKey);
    if (!entry) {
      return undefined;
    }

    // Build chain
    const chain: string[] = [targetKey];
    let current = entry;
    let depth = 1;
    const totalSize = 0;

    while (current && depth < this.maxChainDepth) {
      const baseEntry = this.deltas.get(current.baseKey);
      if (!baseEntry) {
        // Found the base object
        chain.push(current.baseKey);
        break;
      }
      chain.push(current.baseKey);
      current = baseEntry;
      depth++;
    }

    // Calculate sizes (approximate)
    let compressedSize = 0;
    for (const key of chain) {
      const deltaEntry = this.deltas.get(key);
      if (deltaEntry) {
        compressedSize += deltaEntry.delta.reduce((sum, d) => {
          switch (d.type) {
            case "copy":
              return sum + 8;
            case "insert":
              return sum + 1 + d.data.length;
            case "start":
            case "finish":
              return sum + 4;
            default:
              return sum;
          }
        }, 0);
      }
    }

    return {
      baseKey: chain[chain.length - 1],
      targetKey,
      depth,
      originalSize: totalSize,
      compressedSize,
      chain,
    };
  }

  /**
   * List all delta relationships
   */
  async *listDeltas(): AsyncIterable<DeltaInfo> {
    for (const entry of this.deltas.values()) {
      yield {
        baseKey: entry.baseKey,
        targetKey: entry.targetKey,
      };
    }
  }

  /**
   * Clear all stored deltas
   */
  clear(): void {
    this.deltas.clear();
  }

  /**
   * Get number of stored deltas
   */
  get count(): number {
    return this.deltas.size;
  }
}
