/**
 * SQL implementation of DeltaRepository
 *
 * Manages delta relationships between objects using SQLite with
 * efficient chain traversal via recursive CTEs.
 */

import type { DeltaEntry, DeltaRepository } from "@webrun-vcs/vcs";
import type { DatabaseClient } from "./database-client.js";

/**
 * Maximum allowed delta chain depth
 *
 * Prevents runaway recursion and detects corrupt data.
 */
const MAX_CHAIN_DEPTH = 1000;

/**
 * Row structure from delta table
 */
interface DeltaRow {
  record_id: number;
  base_record_id: number;
  delta_size: number;
}

/**
 * SQL-based delta repository
 *
 * Uses SQLite recursive CTEs for efficient delta chain traversal
 * and cycle detection.
 */
export class SQLDeltaRepository implements DeltaRepository {
  constructor(private db: DatabaseClient) {}

  async get(objectRecordId: number): Promise<DeltaEntry | undefined> {
    const rows = await this.db.query<DeltaRow>(
      "SELECT record_id, base_record_id, delta_size FROM delta WHERE record_id = ?",
      [objectRecordId],
    );

    if (rows.length === 0) {
      return undefined;
    }

    return {
      objectRecordId: rows[0].record_id,
      baseRecordId: rows[0].base_record_id,
      deltaSize: rows[0].delta_size,
    };
  }

  async set(entry: DeltaEntry): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO delta (record_id, base_record_id, delta_size)
       VALUES (?, ?, ?)`,
      [entry.objectRecordId, entry.baseRecordId, entry.deltaSize],
    );
  }

  async has(objectRecordId: number): Promise<boolean> {
    const rows = await this.db.query<{ cnt: number }>(
      "SELECT 1 as cnt FROM delta WHERE record_id = ? LIMIT 1",
      [objectRecordId],
    );
    return rows.length > 0;
  }

  async delete(objectRecordId: number): Promise<void> {
    await this.db.execute("DELETE FROM delta WHERE record_id = ?", [objectRecordId]);
  }

  /**
   * Get complete delta chain using recursive CTE
   *
   * Returns entries ordered from target object back toward the base.
   * More efficient than multiple individual queries.
   */
  async getChain(objectRecordId: number): Promise<DeltaEntry[]> {
    const rows = await this.db.query<DeltaRow & { depth: number }>(
      `WITH RECURSIVE chain(rid, base_rid, delta_size, depth, visited) AS (
        -- Start with the target object
        SELECT record_id, base_record_id, delta_size, 1, ',' || record_id || ','
        FROM delta WHERE record_id = ?
        UNION ALL
        -- Follow the chain to base objects
        SELECT d.record_id, d.base_record_id, d.delta_size, c.depth + 1,
               c.visited || d.record_id || ','
        FROM delta d
        JOIN chain c ON d.record_id = c.base_rid
        WHERE c.depth < ?
          AND c.visited NOT LIKE '%,' || d.record_id || ',%'
      )
      SELECT rid as record_id, base_rid as base_record_id, delta_size, depth
      FROM chain
      ORDER BY depth`,
      [objectRecordId, MAX_CHAIN_DEPTH],
    );

    // Check for cycles and depth limits
    if (rows.length > 0) {
      const lastRow = rows[rows.length - 1];

      // Check if we hit the depth limit (might indicate a cycle or very deep chain)
      if (lastRow.depth >= MAX_CHAIN_DEPTH) {
        throw new Error(`Delta chain too deep (>${MAX_CHAIN_DEPTH}) for record ${objectRecordId}`);
      }

      // Build set of all record IDs in the chain
      const seen = new Set<number>();
      for (const row of rows) {
        seen.add(row.record_id);
      }

      // Check for cycle: if the last row's base has a delta entry AND
      // that base is already in our chain, we have a cycle
      const baseEntry = await this.get(lastRow.base_record_id);
      if (baseEntry && seen.has(lastRow.base_record_id)) {
        throw new Error(`Circular delta chain detected at record ${lastRow.base_record_id}`);
      }
    }

    return rows.map((row) => ({
      objectRecordId: row.record_id,
      baseRecordId: row.base_record_id,
      deltaSize: row.delta_size,
    }));
  }

  async getBaseRecordId(objectRecordId: number): Promise<number | undefined> {
    const rows = await this.db.query<{ base_record_id: number }>(
      "SELECT base_record_id FROM delta WHERE record_id = ?",
      [objectRecordId],
    );
    return rows[0]?.base_record_id;
  }

  /**
   * Get all objects that depend on a base object
   *
   * Uses the delta_base_idx index for efficiency.
   */
  async getDependents(baseRecordId: number): Promise<number[]> {
    const rows = await this.db.query<{ record_id: number }>(
      "SELECT record_id FROM delta WHERE base_record_id = ?",
      [baseRecordId],
    );
    return rows.map((r) => r.record_id);
  }

  async hasDependents(baseRecordId: number): Promise<boolean> {
    const rows = await this.db.query<{ cnt: number }>(
      "SELECT 1 as cnt FROM delta WHERE base_record_id = ? LIMIT 1",
      [baseRecordId],
    );
    return rows.length > 0;
  }

  /**
   * Get delta chain depth using recursive CTE
   */
  async getChainDepth(objectRecordId: number): Promise<number> {
    const rows = await this.db.query<{ max_depth: number | null }>(
      `WITH RECURSIVE chain(rid, depth, visited) AS (
        SELECT record_id, 1, ',' || record_id || ','
        FROM delta WHERE record_id = ?
        UNION ALL
        SELECT d.record_id, c.depth + 1, c.visited || d.record_id || ','
        FROM delta d
        JOIN chain c ON d.record_id = c.base_rid
        WHERE c.depth < ?
          AND c.visited NOT LIKE '%,' || d.record_id || ',%'
      ),
      chain_with_base(rid, base_rid, depth, visited) AS (
        SELECT record_id, base_record_id, 1, ',' || record_id || ','
        FROM delta WHERE record_id = ?
        UNION ALL
        SELECT d.record_id, d.base_record_id, c.depth + 1, c.visited || d.record_id || ','
        FROM delta d
        JOIN chain_with_base c ON d.record_id = c.base_rid
        WHERE c.depth < ?
          AND c.visited NOT LIKE '%,' || d.record_id || ',%'
      )
      SELECT MAX(depth) as max_depth FROM chain_with_base`,
      [objectRecordId, MAX_CHAIN_DEPTH, objectRecordId, MAX_CHAIN_DEPTH],
    );
    return rows[0]?.max_depth ?? 0;
  }

  /**
   * Check if creating a delta would create a cycle
   *
   * Traverses from proposedBaseId upward to see if objectRecordId is in the chain.
   */
  async wouldCreateCycle(objectRecordId: number, proposedBaseId: number): Promise<boolean> {
    // Self-reference is always a cycle
    if (objectRecordId === proposedBaseId) {
      return true;
    }

    // Check if objectRecordId appears anywhere in proposedBaseId's chain
    const rows = await this.db.query<{ found: number }>(
      `WITH RECURSIVE chain(rid, base_rid, visited) AS (
        -- Start from proposed base
        SELECT record_id, base_record_id, ',' || record_id || ','
        FROM delta WHERE record_id = ?
        UNION ALL
        -- Follow chain upward
        SELECT d.record_id, d.base_record_id, c.visited || d.record_id || ','
        FROM delta d
        JOIN chain c ON d.record_id = c.base_rid
        WHERE c.visited NOT LIKE '%,' || d.record_id || ',%'
      )
      SELECT 1 as found FROM chain
      WHERE rid = ? OR base_rid = ?
      LIMIT 1`,
      [proposedBaseId, objectRecordId, objectRecordId],
    );

    return rows.length > 0;
  }
}
