/**
 * In-memory implementation of MetadataRepository
 *
 * Tracks access patterns and provides cache hints for optimization.
 */

import type { ObjectId } from "../../interfaces/index.js";
import type { CacheMetadata, MetadataRepository } from "../index.js";

/**
 * In-memory metadata repository
 *
 * Maintains access tracking and hot/cold object classification
 * for cache optimization.
 */
export class InMemoryMetadataRepository implements MetadataRepository {
  private metadata = new Map<ObjectId, CacheMetadata>();
  private hotObjects = new Set<ObjectId>();
  private coldObjects = new Set<ObjectId>();

  async recordAccess(objectId: ObjectId): Promise<void> {
    const meta = this.metadata.get(objectId);
    const now = Date.now();

    if (meta) {
      meta.lastAccessed = now;
      meta.accessCount++;
    } else {
      this.metadata.set(objectId, {
        objectId,
        lastAccessed: now,
        accessCount: 1,
        size: 0, // Will be updated separately
      });
    }
  }

  async getLRUCandidates(limit: number): Promise<ObjectId[]> {
    const entries = Array.from(this.metadata.values());
    entries.sort((a, b) => a.lastAccessed - b.lastAccessed);
    return entries.slice(0, limit).map((e) => e.objectId);
  }

  async getTotalSize(): Promise<number> {
    let total = 0;
    for (const meta of this.metadata.values()) {
      total += meta.size;
    }
    return total;
  }

  async markHot(objectId: ObjectId): Promise<void> {
    this.hotObjects.add(objectId);
    this.coldObjects.delete(objectId);
  }

  async markCold(objectId: ObjectId): Promise<void> {
    this.coldObjects.add(objectId);
    this.hotObjects.delete(objectId);
  }

  async getHotObjects(limit: number): Promise<ObjectId[]> {
    return Array.from(this.hotObjects).slice(0, limit);
  }

  async updateSize(objectId: ObjectId, size: number): Promise<void> {
    const meta = this.metadata.get(objectId);
    if (meta) {
      meta.size = size;
    } else {
      this.metadata.set(objectId, {
        objectId,
        lastAccessed: Date.now(),
        accessCount: 0,
        size,
      });
    }
  }

  async getMetadata(objectId: ObjectId): Promise<CacheMetadata | undefined> {
    return this.metadata.get(objectId);
  }
}
