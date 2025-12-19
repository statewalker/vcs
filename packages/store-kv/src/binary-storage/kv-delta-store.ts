/**
 * Key-Value based DeltaStore implementation
 *
 * Stores delta relationships and instructions in a key-value store.
 * Implements the new DeltaStore interface from binary-storage.
 */

import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  StoredDelta,
} from "@webrun-vcs/vcs/binary-storage";
import type { KVStore } from "../kv-store.js";

/**
 * Key prefix for delta storage
 */
const DELTA_PREFIX = "delta:";

/**
 * KV-based delta storage
 *
 * Stores deltas with prefixed keys:
 * - delta:{target_key} -> serialized delta data (JSON)
 */
export class KvDeltaStore implements DeltaStore {
  private readonly maxChainDepth = 50;

  /**
   * Create KV-based delta store
   *
   * @param kv Key-value store
   * @param prefix Optional key prefix (default: "delta")
   */
  constructor(
    private readonly kv: KVStore,
    private readonly prefix: string = "delta",
  ) {}

  /**
   * Get prefixed key
   */
  private deltaKey(targetKey: string): string {
    return `${this.prefix}:${DELTA_PREFIX}${targetKey}`;
  }

  /**
   * Serialize delta entry to bytes
   */
  private serialize(
    baseKey: string,
    delta: Delta[],
    ratio: number,
  ): Uint8Array {
    const encoder = new TextEncoder();
    const data = {
      baseKey,
      delta: delta.map((d) => {
        switch (d.type) {
          case "start":
            return { type: "start", targetLen: d.targetLen };
          case "copy":
            return { type: "copy", start: d.start, len: d.len };
          case "insert":
            return { type: "insert", data: Array.from(d.data) };
          case "finish":
            return { type: "finish", checksum: d.checksum };
        }
      }),
      ratio,
    };
    return encoder.encode(JSON.stringify(data));
  }

  /**
   * Deserialize delta entry from bytes
   */
  private deserialize(
    bytes: Uint8Array,
    targetKey: string,
  ): StoredDelta {
    const decoder = new TextDecoder();
    const data = JSON.parse(decoder.decode(bytes));
    return {
      baseKey: data.baseKey,
      targetKey,
      delta: data.delta.map((d: { type: string; targetLen?: number; start?: number; len?: number; data?: number[]; checksum?: number }) => {
        switch (d.type) {
          case "start":
            return { type: "start", targetLen: d.targetLen };
          case "copy":
            return { type: "copy", start: d.start, len: d.len };
          case "insert":
            return { type: "insert", data: new Uint8Array(d.data || []) };
          case "finish":
            return { type: "finish", checksum: d.checksum };
          default:
            throw new Error(`Unknown delta type: ${d.type}`);
        }
      }),
      ratio: data.ratio,
    };
  }

  /**
   * Store a delta relationship
   */
  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<boolean> {
    // Calculate ratio
    const deltaSize = delta.reduce((sum, d) => {
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

    const ratio = deltaSize > 0 ? 1 : 0;
    const data = this.serialize(info.baseKey, delta, ratio);

    await this.kv.set(this.deltaKey(info.targetKey), data);
    return true;
  }

  /**
   * Load delta for an object
   */
  async loadDelta(targetKey: string): Promise<StoredDelta | undefined> {
    const bytes = await this.kv.get(this.deltaKey(targetKey));
    if (!bytes) {
      return undefined;
    }
    return this.deserialize(bytes, targetKey);
  }

  /**
   * Check if object is stored as delta
   */
  async isDelta(targetKey: string): Promise<boolean> {
    return this.kv.has(this.deltaKey(targetKey));
  }

  /**
   * Remove delta relationship
   */
  async removeDelta(targetKey: string, _keepAsBase?: boolean): Promise<boolean> {
    return this.kv.delete(this.deltaKey(targetKey));
  }

  /**
   * Get delta chain info for an object
   */
  async getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined> {
    const entry = await this.loadDelta(targetKey);
    if (!entry) {
      return undefined;
    }

    // Build chain
    const chain: string[] = [targetKey];
    let currentKey = entry.baseKey;
    let depth = 1;
    let compressedSize = this.calculateDeltaSize(entry.delta);

    while (depth < this.maxChainDepth) {
      const baseEntry = await this.loadDelta(currentKey);
      if (!baseEntry) {
        // Found the base object
        chain.push(currentKey);
        break;
      }
      chain.push(currentKey);
      compressedSize += this.calculateDeltaSize(baseEntry.delta);
      currentKey = baseEntry.baseKey;
      depth++;
    }

    return {
      baseKey: chain[chain.length - 1],
      targetKey,
      depth,
      originalSize: 0, // Not tracked in this implementation
      compressedSize,
      chain,
    };
  }

  /**
   * Calculate approximate delta size
   */
  private calculateDeltaSize(delta: Delta[]): number {
    return delta.reduce((sum, d) => {
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

  /**
   * List all delta relationships
   */
  async *listDeltas(): AsyncIterable<DeltaInfo> {
    const deltaPrefix = this.deltaKey("");
    for await (const fullKey of this.kv.list(deltaPrefix)) {
      const targetKey = fullKey.substring(deltaPrefix.length);
      const entry = await this.loadDelta(targetKey);
      if (entry) {
        yield {
          baseKey: entry.baseKey,
          targetKey: entry.targetKey,
        };
      }
    }
  }
}

/**
 * Create a new KV-based delta store
 */
export function createKvDeltaStore(kv: KVStore, prefix?: string): KvDeltaStore {
  return new KvDeltaStore(kv, prefix);
}
