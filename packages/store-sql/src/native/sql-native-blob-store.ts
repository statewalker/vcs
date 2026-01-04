/**
 * Native SQL BlobStore with Git-compatible IDs
 *
 * Stores blobs in SQL tables while computing SHA-1 hashes
 * identical to native Git.
 */

import { encodeObjectHeader, type ObjectId } from "@statewalker/vcs-core";
import { bytesToHex, collect, Sha1 } from "@statewalker/vcs-utils";
import type { DatabaseClient } from "../database-client.js";
import type { SqlNativeBlobStore } from "./types.js";

/**
 * Table name for blob storage
 */
const BLOB_TABLE = "vcs_blob";

/**
 * Native SQL BlobStore implementation
 *
 * Uses a simple table with:
 * - blob_id: Git-compatible SHA-1 hash
 * - content: Raw blob content
 * - size: Content size in bytes
 * - created_at: Storage timestamp
 *
 * Computes Git-compatible SHA-1 object IDs for interoperability.
 */
export class SqlNativeBlobStoreImpl implements SqlNativeBlobStore {
  private initialized = false;

  constructor(private db: DatabaseClient) {}

  /**
   * Ensure blob table exists
   */
  private async ensureTable(): Promise<void> {
    if (this.initialized) return;

    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS ${BLOB_TABLE} (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        blob_id TEXT UNIQUE NOT NULL,
        content BLOB NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);

    await this.db.execute(`
      CREATE INDEX IF NOT EXISTS ${BLOB_TABLE}_size_idx ON ${BLOB_TABLE}(size)
    `);

    this.initialized = true;
  }

  /**
   * Compute Git-compatible SHA-1 hash for a blob
   */
  private computeGitBlobId(content: Uint8Array): ObjectId {
    const sha1 = new Sha1();
    sha1.update(encodeObjectHeader("blob", content.length));
    sha1.update(content);
    return bytesToHex(sha1.finalize());
  }

  /**
   * Store blob with unknown size
   */
  async store(content: AsyncIterable<Uint8Array>): Promise<ObjectId> {
    // FIXME: write down content in chunks - a separate table for large blobs, containing chunk, position and the length of the chunks; stores compressed chunks
    // FIXME: add streaming SHA1 computation to avoid collecting entire content; id is stored after the content is fully written

    await this.ensureTable();

    // Collect content to determine size
    const data = await collect(content);
    return this.storeContent(data);
  }

  /**
   * Store blob content
   */
  private async storeContent(content: Uint8Array): Promise<ObjectId> {
    const blobId = this.computeGitBlobId(content);

    // Check if blob already exists (deduplication)
    const existing = await this.db.query<{ id: number }>(
      `SELECT id FROM ${BLOB_TABLE} WHERE blob_id = ?`,
      [blobId],
    );

    if (existing.length > 0) {
      return blobId;
    }

    // Store blob
    const now = Date.now();
    await this.db.execute(
      `INSERT INTO ${BLOB_TABLE} (blob_id, content, size, created_at) VALUES (?, ?, ?, ?)`,
      [blobId, content, content.length, now],
    );

    return blobId;
  }

  /**
   * Load blob content
   */
  async *load(id: ObjectId): AsyncIterable<Uint8Array> {
    await this.ensureTable();

    const rows = await this.db.query<{ content: Uint8Array }>(
      `SELECT content FROM ${BLOB_TABLE} WHERE blob_id = ?`,
      [id],
    );

    if (rows.length === 0) {
      throw new Error(`Blob ${id} not found`);
    }

    yield rows[0].content;
  }

  /**
   * Check if blob exists
   */
  async has(id: ObjectId): Promise<boolean> {
    await this.ensureTable();

    const result = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${BLOB_TABLE} WHERE blob_id = ?`,
      [id],
    );

    return result[0].cnt > 0;
  }

  // --- Extended query methods ---

  /**
   * Get blob count
   */
  async count(): Promise<number> {
    await this.ensureTable();

    const result = await this.db.query<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM ${BLOB_TABLE}`,
    );
    return result[0].cnt;
  }

  /**
   * Get total size of all blobs
   */
  async totalSize(): Promise<number> {
    await this.ensureTable();

    const result = await this.db.query<{ total: number | null }>(
      `SELECT SUM(size) as total FROM ${BLOB_TABLE}`,
    );
    return result[0].total || 0;
  }
}
