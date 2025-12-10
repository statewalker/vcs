/**
 * SQL implementation of ObjectRepository
 *
 * Stores objects in SQLite database with deduplication and efficient
 * lookups by both object ID (hash) and internal record ID.
 */

import type { ObjectEntry, ObjectId, ObjectRepository } from "@webrun-vcs/vcs";
import type { DatabaseClient } from "./database-client.js";

/**
 * Row structure from object table
 */
interface ObjectRow {
  record_id: number;
  object_id: string;
  size: number;
  content: Uint8Array;
  created_at: number;
  accessed_at: number;
}

/**
 * SQL-based object repository
 *
 * Uses SQLite for persistent storage with automatic deduplication
 * based on object ID (content hash).
 */
export class SQLObjectRepository implements ObjectRepository {
  constructor(private db: DatabaseClient) {}

  async storeObject(entry: Omit<ObjectEntry, "recordId">): Promise<ObjectEntry> {
    // Check if object already exists (deduplication)
    const existing = await this.loadObjectEntry(entry.id);
    if (existing) {
      // Update accessed timestamp, return existing entry with updated timestamp
      await this.db.execute("UPDATE object SET accessed_at = ? WHERE object_id = ?", [
        entry.accessed,
        entry.id,
      ]);
      return {
        ...existing,
        accessed: entry.accessed,
        // Update other fields that may have changed
        size: entry.size,
        content: entry.content,
        created: entry.created,
      };
    }

    // Insert new object
    const result = await this.db.execute(
      `INSERT INTO object (object_id, size, content, created_at, accessed_at)
       VALUES (?, ?, ?, ?, ?)`,
      [entry.id, entry.size, entry.content, entry.created, entry.accessed],
    );

    return {
      recordId: result.lastInsertRowId,
      ...entry,
    };
  }

  async loadObjectEntry(objectId: ObjectId): Promise<ObjectEntry | undefined> {
    const rows = await this.db.query<ObjectRow>(
      `SELECT record_id, object_id, size, content, created_at, accessed_at
       FROM object WHERE object_id = ?`,
      [objectId],
    );

    if (rows.length === 0) {
      return undefined;
    }

    return this.rowToEntry(rows[0]);
  }

  async loadObjectByRecordId(recordId: number): Promise<ObjectEntry | undefined> {
    const rows = await this.db.query<ObjectRow>(
      `SELECT record_id, object_id, size, content, created_at, accessed_at
       FROM object WHERE record_id = ?`,
      [recordId],
    );

    if (rows.length === 0) {
      return undefined;
    }

    return this.rowToEntry(rows[0]);
  }

  async loadObjectContent(recordId: number): Promise<Uint8Array | undefined> {
    const rows = await this.db.query<{ content: Uint8Array }>(
      "SELECT content FROM object WHERE record_id = ?",
      [recordId],
    );
    return rows[0]?.content;
  }

  async deleteObject(objectId: ObjectId): Promise<boolean> {
    const result = await this.db.execute("DELETE FROM object WHERE object_id = ?", [objectId]);
    return result.changes > 0;
  }

  async hasObject(objectId: ObjectId): Promise<boolean> {
    const rows = await this.db.query<{ cnt: number }>(
      "SELECT 1 as cnt FROM object WHERE object_id = ? LIMIT 1",
      [objectId],
    );
    return rows.length > 0;
  }

  async getMany(objectIds: ObjectId[]): Promise<ObjectEntry[]> {
    if (objectIds.length === 0) {
      return [];
    }

    // Build parameterized IN clause
    const placeholders = objectIds.map(() => "?").join(", ");
    const rows = await this.db.query<ObjectRow>(
      `SELECT record_id, object_id, size, content, created_at, accessed_at
       FROM object WHERE object_id IN (${placeholders})`,
      objectIds,
    );

    return rows.map((row) => this.rowToEntry(row));
  }

  async size(): Promise<number> {
    const rows = await this.db.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM object");
    return rows[0]?.cnt ?? 0;
  }

  async getAllIds(): Promise<ObjectId[]> {
    const rows = await this.db.query<{ object_id: string }>("SELECT object_id FROM object");
    return rows.map((r) => r.object_id);
  }

  /**
   * Convert database row to ObjectEntry
   */
  private rowToEntry(row: ObjectRow): ObjectEntry {
    return {
      recordId: row.record_id,
      id: row.object_id,
      size: row.size,
      content: row.content,
      created: row.created_at,
      accessed: row.accessed_at,
    };
  }
}
