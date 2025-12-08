/**
 * Composite object storage implementation
 *
 * Combines multiple ObjectStorage implementations into a single unified interface.
 * Writes go to the primary storage; reads check all storages in order.
 *
 * This is useful for combining loose object storage with pack file storage,
 * where new objects are written to loose storage but reads can come from either.
 */

import type { ObjectId, ObjectInfo, ObjectStorage } from "@webrun-vcs/storage";

/**
 * Composite object storage combining multiple backends
 *
 * - store() writes to primaryStorage only
 * - load(), getInfo() check primaryStorage first, then fallback storages
 * - delete() only affects primaryStorage
 * - listObjects() yields from all storages (deduplicating)
 */
export class CompositeObjectStorage implements ObjectStorage {
  private readonly primaryStorage: ObjectStorage;
  private readonly fallbackStorages: ObjectStorage[];

  /**
   * Create a composite storage
   *
   * @param primaryStorage Storage for writes and primary reads
   * @param fallbackStorages Additional storages to check for reads (in order)
   */
  constructor(primaryStorage: ObjectStorage, fallbackStorages: ObjectStorage[] = []) {
    this.primaryStorage = primaryStorage;
    this.fallbackStorages = fallbackStorages;
  }

  /**
   * Store object content
   *
   * Writes only to the primary storage.
   */
  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectInfo> {
    return this.primaryStorage.store(data);
  }

  /**
   * Load object content by ID
   *
   * Checks primary storage first, then fallback storages in order.
   */
  async *load(
    id: ObjectId,
    params?: { offset?: number; length?: number },
  ): AsyncIterable<Uint8Array> {
    // Try primary storage first
    const primaryInfo = await this.primaryStorage.getInfo(id);
    if (primaryInfo) {
      yield* this.primaryStorage.load(id, params);
      return;
    }

    // Try fallback storages
    for (const storage of this.fallbackStorages) {
      const info = await storage.getInfo(id);
      if (info) {
        yield* storage.load(id, params);
        return;
      }
    }

    throw new Error(`Object not found: ${id}`);
  }

  /**
   * Get object metadata
   *
   * Checks primary storage first, then fallback storages.
   */
  async getInfo(id: ObjectId): Promise<ObjectInfo | null> {
    // Try primary storage first
    const primaryInfo = await this.primaryStorage.getInfo(id);
    if (primaryInfo) {
      return primaryInfo;
    }

    // Try fallback storages
    for (const storage of this.fallbackStorages) {
      const info = await storage.getInfo(id);
      if (info) {
        return info;
      }
    }

    return null;
  }

  /**
   * Delete object
   *
   * Only affects primary storage. Pack file objects cannot be deleted.
   */
  async delete(id: ObjectId): Promise<boolean> {
    return this.primaryStorage.delete(id);
  }

  /**
   * Close all storages
   */
  async close(): Promise<void> {
    // Close primary storage if it has a close method
    if ("close" in this.primaryStorage && typeof this.primaryStorage.close === "function") {
      await this.primaryStorage.close();
    }
    // Close fallback storages
    for (const storage of this.fallbackStorages) {
      if ("close" in storage && typeof storage.close === "function") {
        await storage.close();
      }
    }
  }

  /**
   * Iterate over all objects in all storages
   *
   * Deduplicates objects that appear in multiple storages.
   *
   * @returns AsyncGenerator yielding ObjectInfos
   */
  async *listObjects(): AsyncGenerator<ObjectInfo> {
    const seen = new Set<ObjectId>();

    // Enumerate primary storage first
    for await (const info of this.primaryStorage.listObjects()) {
      seen.add(info.id);
      yield info;
    }

    // Enumerate fallback storages (skip duplicates)
    for (const storage of this.fallbackStorages) {
      for await (const info of storage.listObjects()) {
        if (!seen.has(info.id)) {
          seen.add(info.id);
          yield info;
        }
      }
    }
  }
}
