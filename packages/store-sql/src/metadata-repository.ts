/**
 * SQL implementation of MetadataRepository
 *
 * Manages object access patterns and cache hints for LRU eviction
 * and hot/cold object classification.
 */

import type { CacheMetadata, MetadataRepository, ObjectId } from "@statewalker/vcs-sandbox";
import type { DatabaseClient } from "./database-client.js";

/**
 * Row structure from metadata table
 */
interface MetadataRow {
  object_id: string;
  access_count: number;
  is_hot: number;
  total_size: number;
}

/**
 * SQL-based metadata repository
 *
 * Uses a dedicated metadata table with UPSERT operations for
 * efficient access tracking and size management.
 */
export class SQLMetadataRepository implements MetadataRepository {
  constructor(private db: DatabaseClient) {}

  async recordAccess(objectId: ObjectId): Promise<void> {
    const now = Date.now();

    // Update object's accessed_at timestamp if it exists
    await this.db.execute("UPDATE object SET accessed_at = ? WHERE object_id = ?", [now, objectId]);

    // Upsert metadata: increment access count and update last_accessed
    await this.db.execute(
      `INSERT INTO metadata (object_id, access_count, total_size, is_hot, last_accessed)
       VALUES (?, 1, COALESCE((SELECT size FROM object WHERE object_id = ?), 0), 0, ?)
       ON CONFLICT(object_id) DO UPDATE SET
         access_count = access_count + 1,
         last_accessed = ?`,
      [objectId, objectId, now, now],
    );
  }

  /**
   * Get least recently used objects
   *
   * Returns objects sorted by last access time (oldest first),
   * excluding hot objects that should be kept in cache.
   */
  async getLRUCandidates(limit: number): Promise<ObjectId[]> {
    const rows = await this.db.query<{ object_id: string }>(
      `SELECT object_id FROM metadata
       WHERE is_hot = 0
       ORDER BY last_accessed ASC
       LIMIT ?`,
      [limit],
    );
    return rows.map((r) => r.object_id);
  }

  async getTotalSize(): Promise<number> {
    const rows = await this.db.query<{ total: number | null }>(
      "SELECT COALESCE(SUM(total_size), 0) as total FROM metadata",
    );
    return rows[0]?.total ?? 0;
  }

  async markHot(objectId: ObjectId): Promise<void> {
    await this.db.execute(
      `INSERT INTO metadata (object_id, is_hot, access_count, total_size, last_accessed)
       VALUES (?, 1, 0, 0, ?)
       ON CONFLICT(object_id) DO UPDATE SET is_hot = 1`,
      [objectId, Date.now()],
    );
  }

  async markCold(objectId: ObjectId): Promise<void> {
    await this.db.execute("UPDATE metadata SET is_hot = 0 WHERE object_id = ?", [objectId]);
  }

  /**
   * Get hot objects (frequently accessed)
   *
   * Returns hot objects sorted by access count (most accessed first).
   */
  async getHotObjects(limit: number): Promise<ObjectId[]> {
    const rows = await this.db.query<{ object_id: string }>(
      `SELECT object_id FROM metadata
       WHERE is_hot = 1
       ORDER BY access_count DESC
       LIMIT ?`,
      [limit],
    );
    return rows.map((r) => r.object_id);
  }

  async updateSize(objectId: ObjectId, size: number): Promise<void> {
    await this.db.execute(
      `INSERT INTO metadata (object_id, total_size, access_count, is_hot, last_accessed)
       VALUES (?, ?, 0, 0, ?)
       ON CONFLICT(object_id) DO UPDATE SET total_size = ?`,
      [objectId, size, Date.now(), size],
    );
  }

  /**
   * Get metadata for an object
   */
  async getMetadata(objectId: ObjectId): Promise<CacheMetadata | undefined> {
    const rows = await this.db.query<MetadataRow & { last_accessed: number }>(
      `SELECT object_id, access_count, total_size, last_accessed
       FROM metadata
       WHERE object_id = ?`,
      [objectId],
    );

    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    return {
      objectId: row.object_id,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
      size: row.total_size,
    };
  }
}
