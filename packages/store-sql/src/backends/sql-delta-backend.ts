/**
 * SQL implementation of DeltaChainStore
 *
 * Provides delta storage using SQLite with support for both Git and Fossil
 * delta formats. Stores Delta[] instructions as serialized binary BLOBs.
 */

import { type Delta, deltaToGitFormat, deserializeDeltaFromGit } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaChainStore,
  DeltaChainStoreStats,
  ObjectId,
  StoredDelta,
} from "@webrun-vcs/vcs";
import type { DatabaseClient } from "../database-client.js";

/**
 * Row structure from delta_content table
 */
interface DeltaContentRow {
  object_id: string;
  base_object_id: string;
  delta_data: Uint8Array;
  delta_format: "git" | "fossil";
  original_size: number;
  delta_size: number;
  created_at: number;
}

/**
 * Row structure from object table
 */
interface ObjectRow {
  object_id: string;
  content: Uint8Array;
  size: number;
}

/**
 * Maximum allowed delta chain depth
 */
const MAX_CHAIN_DEPTH = 50;

/**
 * SQL-based delta backend
 *
 * Implements DeltaChainStore interface using SQLite for storage.
 * Stores delta instructions in Git binary format for efficient storage
 * and compatibility with Git tools.
 */
export class SQLDeltaBackend implements DeltaChainStore {
  readonly name = "sql";
  private readonly deltaFormat: "git" | "fossil";

  constructor(
    private readonly db: DatabaseClient,
    options?: { deltaFormat?: "git" | "fossil" },
  ) {
    this.deltaFormat = options?.deltaFormat ?? "git";
  }

  async storeDelta(targetId: ObjectId, baseId: ObjectId, delta: Delta[]): Promise<boolean> {
    // Calculate target size from delta instructions
    let targetSize = 0;
    for (const d of delta) {
      if (d.type === "start") {
        targetSize = d.targetLen;
        break;
      }
    }

    // Look up the base object size from database
    const baseRows = await this.db.query<{ size: number }>(
      "SELECT size FROM object WHERE object_id = ?",
      [baseId],
    );

    // If base is a delta, look up from delta_content
    let baseSize: number;
    if (baseRows.length > 0) {
      baseSize = baseRows[0].size;
    } else {
      // Base might be a delta itself - get its original_size
      const deltaRows = await this.db.query<{ original_size: number }>(
        "SELECT original_size FROM delta_content WHERE object_id = ?",
        [baseId],
      );
      if (deltaRows.length > 0) {
        baseSize = deltaRows[0].original_size;
      } else {
        // Base not found
        return false;
      }
    }

    // Serialize delta to binary format with correct base size
    const deltaData = deltaToGitFormat(baseSize, delta);

    try {
      await this.db.execute(
        `INSERT OR REPLACE INTO delta_content
         (object_id, base_object_id, delta_data, delta_format, original_size, delta_size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [targetId, baseId, deltaData, this.deltaFormat, targetSize, deltaData.length, Date.now()],
      );
      return true;
    } catch {
      return false;
    }
  }

  async loadDelta(id: ObjectId): Promise<StoredDelta | undefined> {
    const rows = await this.db.query<DeltaContentRow>(
      `SELECT object_id, base_object_id, delta_data, delta_format, original_size, delta_size
       FROM delta_content WHERE object_id = ?`,
      [id],
    );

    if (rows.length === 0) {
      return undefined;
    }

    const row = rows[0];
    const delta = deserializeDeltaFromGit(row.delta_data);
    const ratio = row.delta_size / row.original_size;

    return {
      targetId: row.object_id,
      baseId: row.base_object_id,
      delta,
      ratio,
    };
  }

  async isDelta(id: ObjectId): Promise<boolean> {
    const rows = await this.db.query<{ cnt: number }>(
      "SELECT 1 as cnt FROM delta_content WHERE object_id = ? LIMIT 1",
      [id],
    );
    return rows.length > 0;
  }

  async has(id: ObjectId): Promise<boolean> {
    // Check both delta_content and object tables
    const rows = await this.db.query<{ cnt: number }>(
      `SELECT 1 as cnt FROM (
        SELECT object_id FROM delta_content WHERE object_id = ?
        UNION
        SELECT object_id FROM object WHERE object_id = ?
      ) LIMIT 1`,
      [id, id],
    );
    return rows.length > 0;
  }

  async loadObject(id: ObjectId): Promise<Uint8Array | undefined> {
    // First check if it's a base object (not a delta)
    const objectRows = await this.db.query<ObjectRow>(
      "SELECT content FROM object WHERE object_id = ?",
      [id],
    );

    // If it's in the object table, check if it's also a delta
    const isDeltaObject = await this.isDelta(id);

    if (!isDeltaObject && objectRows.length > 0) {
      // Not a delta, return content directly
      return objectRows[0].content;
    }

    if (!isDeltaObject) {
      // Object doesn't exist
      return undefined;
    }

    // It's a delta - need to resolve the chain
    return this.resolveDeltaChain(id);
  }

  /**
   * Resolve delta chain to get full object content
   */
  private async resolveDeltaChain(id: ObjectId): Promise<Uint8Array | undefined> {
    // Build the chain from target to base, storing binary deltas
    const chain: { baseId: ObjectId; deltaData: Uint8Array }[] = [];
    let currentId = id;
    const seen = new Set<ObjectId>();

    while (true) {
      if (seen.has(currentId)) {
        throw new Error(`Circular delta chain detected at ${currentId}`);
      }
      seen.add(currentId);

      if (chain.length >= MAX_CHAIN_DEPTH) {
        throw new Error(`Delta chain too deep (>${MAX_CHAIN_DEPTH}) for ${id}`);
      }

      // Load raw delta data
      const rows = await this.db.query<{ base_object_id: string; delta_data: Uint8Array }>(
        "SELECT base_object_id, delta_data FROM delta_content WHERE object_id = ?",
        [currentId],
      );

      if (rows.length === 0) {
        // Not a delta - this should be the base object
        break;
      }

      chain.push({
        baseId: rows[0].base_object_id,
        deltaData: rows[0].delta_data,
      });
      currentId = rows[0].base_object_id;
    }

    // Load base object content
    const baseRows = await this.db.query<ObjectRow>(
      "SELECT content FROM object WHERE object_id = ?",
      [currentId],
    );

    if (baseRows.length === 0) {
      return undefined;
    }

    // Apply deltas in reverse order (from base to target) using Git binary format
    let content = baseRows[0].content;
    for (let i = chain.length - 1; i >= 0; i--) {
      content = applyGitDelta(content, chain[i].deltaData);
    }

    return content;
  }

  async removeDelta(id: ObjectId, keepAsBase?: boolean): Promise<boolean> {
    if (keepAsBase) {
      // First resolve the full content
      const content = await this.loadObject(id);
      if (!content) {
        return false;
      }

      // Store as base object if not already present
      const existing = await this.db.query<{ cnt: number }>(
        "SELECT 1 as cnt FROM object WHERE object_id = ? LIMIT 1",
        [id],
      );

      if (existing.length === 0) {
        // Add to object table
        await this.db.execute(
          `INSERT INTO object (object_id, size, content, created_at, accessed_at)
           VALUES (?, ?, ?, ?, ?)`,
          [id, content.length, content, Date.now(), Date.now()],
        );
      }
    }

    // Remove from delta_content table
    const result = await this.db.execute("DELETE FROM delta_content WHERE object_id = ?", [id]);
    return result.changes > 0;
  }

  async getDeltaChainInfo(id: ObjectId): Promise<DeltaChainDetails | undefined> {
    const isDeltaObj = await this.isDelta(id);
    if (!isDeltaObj) {
      return undefined;
    }

    const chain: ObjectId[] = [id];
    let currentId = id;
    let compressedSize = 0;
    let originalSize = 0;
    const seen = new Set<ObjectId>();
    seen.add(id);

    // Traverse the chain
    while (true) {
      const rows = await this.db.query<DeltaContentRow>(
        `SELECT base_object_id, delta_size, original_size
         FROM delta_content WHERE object_id = ?`,
        [currentId],
      );

      if (rows.length === 0) {
        break;
      }

      const row = rows[0];
      compressedSize += row.delta_size;
      originalSize += row.original_size;

      if (seen.has(row.base_object_id)) {
        throw new Error(`Circular delta chain at ${row.base_object_id}`);
      }
      seen.add(row.base_object_id);
      chain.push(row.base_object_id);
      currentId = row.base_object_id;

      // Check if base is also a delta
      const baseIsDelta = await this.isDelta(currentId);
      if (!baseIsDelta) {
        break;
      }
    }

    // Get base object size
    const baseRows = await this.db.query<{ size: number }>(
      "SELECT size FROM object WHERE object_id = ?",
      [currentId],
    );

    if (baseRows.length > 0) {
      originalSize += baseRows[0].size;
      compressedSize += baseRows[0].size;
    }

    return {
      baseId: currentId,
      depth: chain.length - 1,
      originalSize,
      compressedSize,
      chain,
    };
  }

  async *listObjects(): AsyncIterable<ObjectId> {
    // List objects from both tables
    const deltaRows = await this.db.query<{ object_id: string }>(
      "SELECT object_id FROM delta_content",
    );

    const objectRows = await this.db.query<{ object_id: string }>("SELECT object_id FROM object");

    const seen = new Set<ObjectId>();

    for (const row of deltaRows) {
      if (!seen.has(row.object_id)) {
        seen.add(row.object_id);
        yield row.object_id;
      }
    }

    for (const row of objectRows) {
      if (!seen.has(row.object_id)) {
        seen.add(row.object_id);
        yield row.object_id;
      }
    }
  }

  async *listDeltas(): AsyncIterable<{ targetId: ObjectId; baseId: ObjectId }> {
    const rows = await this.db.query<{ object_id: string; base_object_id: string }>(
      "SELECT object_id, base_object_id FROM delta_content",
    );

    for (const row of rows) {
      yield {
        targetId: row.object_id,
        baseId: row.base_object_id,
      };
    }
  }

  async getStats(): Promise<DeltaChainStoreStats> {
    // Count deltas
    const deltaCountRows = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM delta_content",
    );
    const deltaCount = deltaCountRows[0]?.cnt ?? 0;

    // Count base objects (objects not stored as deltas)
    const baseCountRows = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM object o
       WHERE NOT EXISTS (SELECT 1 FROM delta_content d WHERE d.object_id = o.object_id)`,
    );
    const baseCount = baseCountRows[0]?.cnt ?? 0;

    // Calculate total size
    const deltaSizeRows = await this.db.query<{ total: number | null }>(
      "SELECT SUM(delta_size) as total FROM delta_content",
    );
    const deltaSize = deltaSizeRows[0]?.total ?? 0;

    const objectSizeRows = await this.db.query<{ total: number | null }>(
      `SELECT SUM(size) as total FROM object o
       WHERE NOT EXISTS (SELECT 1 FROM delta_content d WHERE d.object_id = o.object_id)`,
    );
    const objectSize = objectSizeRows[0]?.total ?? 0;

    // Calculate average and max chain depth
    let totalDepth = 0;
    let maxDepth = 0;
    let chainCount = 0;

    for await (const { targetId } of this.listDeltas()) {
      const info = await this.getDeltaChainInfo(targetId);
      if (info) {
        totalDepth += info.depth;
        maxDepth = Math.max(maxDepth, info.depth);
        chainCount++;
      }
    }

    return {
      deltaCount,
      baseCount,
      averageChainDepth: chainCount > 0 ? totalDepth / chainCount : 0,
      maxChainDepth: maxDepth,
      totalSize: deltaSize + objectSize,
      extra: {
        deltaFormat: this.deltaFormat,
      },
    };
  }

  async flush(): Promise<void> {
    // SQLite writes are immediate, nothing to flush
  }

  async close(): Promise<void> {
    // Connection managed externally, nothing to close here
  }

  async refresh(): Promise<void> {
    // No caching, nothing to refresh
  }
}

/**
 * Apply a Git binary delta to a base object
 *
 * Based on Git's delta application algorithm. Applies copy and insert
 * instructions to reconstruct the target from the base.
 *
 * @param base The base object data
 * @param delta The Git binary delta to apply
 * @returns The resulting object data
 */
function applyGitDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let deltaPtr = 0;

  // Read base object length (variable length int)
  let baseLen = 0;
  let shift = 0;
  let c: number;
  do {
    c = delta[deltaPtr++];
    baseLen |= (c & 0x7f) << shift;
    shift += 7;
  } while ((c & 0x80) !== 0);

  if (base.length !== baseLen) {
    throw new Error(`Delta base length mismatch: expected ${baseLen}, got ${base.length}`);
  }

  // Read result object length (variable length int)
  let resLen = 0;
  shift = 0;
  do {
    c = delta[deltaPtr++];
    resLen |= (c & 0x7f) << shift;
    shift += 7;
  } while ((c & 0x80) !== 0);

  const result = new Uint8Array(resLen);
  let resultPtr = 0;

  // Process delta commands
  while (deltaPtr < delta.length) {
    const cmd = delta[deltaPtr++];

    if ((cmd & 0x80) !== 0) {
      // COPY command: copy from base
      let copyOffset = 0;
      if ((cmd & 0x01) !== 0) copyOffset = delta[deltaPtr++];
      if ((cmd & 0x02) !== 0) copyOffset |= delta[deltaPtr++] << 8;
      if ((cmd & 0x04) !== 0) copyOffset |= delta[deltaPtr++] << 16;
      if ((cmd & 0x08) !== 0) copyOffset |= delta[deltaPtr++] << 24;

      let copySize = 0;
      if ((cmd & 0x10) !== 0) copySize = delta[deltaPtr++];
      if ((cmd & 0x20) !== 0) copySize |= delta[deltaPtr++] << 8;
      if ((cmd & 0x40) !== 0) copySize |= delta[deltaPtr++] << 16;
      if (copySize === 0) copySize = 0x10000;

      result.set(base.subarray(copyOffset, copyOffset + copySize), resultPtr);
      resultPtr += copySize;
    } else if (cmd !== 0) {
      // INSERT command: copy from delta
      result.set(delta.subarray(deltaPtr, deltaPtr + cmd), resultPtr);
      deltaPtr += cmd;
      resultPtr += cmd;
    } else {
      // Reserved command
      throw new Error("Unsupported delta command 0");
    }
  }

  if (resultPtr !== resLen) {
    throw new Error(`Delta result size mismatch: expected ${resLen}, got ${resultPtr}`);
  }

  return result;
}
