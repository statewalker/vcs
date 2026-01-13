/**
 * Combined Raw Store
 *
 * Combines loose object storage with pack file support.
 * Implements RawStore interface for Git object storage.
 *
 * - Reads from both loose objects and pack files
 * - Writes to loose objects only
 * - Pack files are read-only (created by GC/pack operations)
 */

import type { DeltaStore } from "../delta/delta-store.js";
import type { RawStore } from "./raw-store.js";

/**
 * Combined raw store that reads from loose objects and pack files
 *
 * @example
 * ```typescript
 * const looseStore = new CompressedRawStore(fileStore);
 * const packStore = new PackDeltaStore({ files, basePath: "objects/pack" });
 * const combined = new CombinedRawStore(looseStore, packStore);
 * ```
 */
export class CombinedRawStore implements RawStore {
  constructor(
    private readonly loose: RawStore,
    private readonly packs: DeltaStore,
  ) {}

  /**
   * Store content (always to loose objects)
   */
  async store(
    key: string,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<number> {
    return this.loose.store(key, content);
  }

  /**
   * Load content from loose objects or pack files
   *
   * Checks pack files first (more efficient for large repos),
   * then falls back to loose objects.
   */
  async *load(
    key: string,
    options?: { offset?: number; length?: number },
  ): AsyncGenerator<Uint8Array> {
    // Try pack files first (loadObject resolves deltas internally)
    if (this.packs.loadObject) {
      try {
        const content = await this.packs.loadObject(key);
        if (content) {
          if (options?.offset !== undefined || options?.length !== undefined) {
            const offset = options.offset ?? 0;
            const length = options.length ?? content.length - offset;
            yield content.subarray(offset, offset + length);
          } else {
            yield content;
          }
          return;
        }
      } catch {
        // Pack load failed, try loose objects
      }
    }

    // Try loose objects
    if (await this.loose.has(key)) {
      yield* this.loose.load(key, options);
      return;
    }

    throw new Error(`Object not found: ${key}`);
  }

  /**
   * Check if object exists in loose objects or pack files
   */
  async has(key: string): Promise<boolean> {
    if (await this.loose.has(key)) {
      return true;
    }

    if (this.packs.hasObject) {
      return this.packs.hasObject(key);
    }

    return false;
  }

  /**
   * Delete from loose objects only
   *
   * Pack files are immutable - objects in packs are not deleted
   * individually; the entire pack is replaced during GC.
   */
  async delete(key: string): Promise<boolean> {
    return this.loose.delete(key);
  }

  /**
   * List all keys from loose objects and pack files
   */
  async *keys(): AsyncIterable<string> {
    const seen = new Set<string>();

    // Loose objects
    for await (const key of this.loose.keys()) {
      if (!seen.has(key)) {
        seen.add(key);
        yield key;
      }
    }

    // Pack files (all objects, including bases of deltas)
    for await (const info of this.packs.listDeltas()) {
      if (!seen.has(info.targetKey)) {
        seen.add(info.targetKey);
        yield info.targetKey;
      }
    }
  }

  /**
   * Get object size
   */
  async size(key: string): Promise<number> {
    // Check packs first (getDeltaChainInfo returns originalSize)
    const chainInfo = await this.packs.getDeltaChainInfo(key);
    if (chainInfo) {
      return chainInfo.originalSize;
    }

    // Check loose objects
    if (await this.loose.has(key)) {
      return this.loose.size(key);
    }

    // Check if object exists in pack but not as delta
    if (this.packs.loadObject) {
      const content = await this.packs.loadObject(key);
      if (content) {
        return content.length;
      }
    }

    return -1;
  }
}
