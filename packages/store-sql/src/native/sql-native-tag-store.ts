/**
 * Native SQL TagStore with Git-compatible IDs and query capabilities
 *
 * Stores tags in SQL tables while computing SHA-1 hashes
 * identical to native Git. Provides extended query methods for
 * efficient lookups by name pattern.
 */

import {
  type AnnotatedTag,
  computeTagSize,
  encodeObjectHeader,
  encodeTagEntries,
  type ObjectId,
  ObjectType,
  type ObjectTypeCode,
  tagToEntries,
} from "@statewalker/vcs-core";
import { bytesToHex, Sha1 } from "@statewalker/vcs-utils";
import type { DatabaseClient } from "../database-client.js";
import type { SqlNativeTagStore } from "./types.js";

/**
 * Maximum depth for following tag chains to prevent infinite loops
 */
const MAX_TAG_CHAIN_DEPTH = 100;

/**
 * Database row type for tag queries
 */
interface TagRow {
  id: number;
  tag_id: string;
  object_id: string;
  object_type: number;
  tag_name: string;
  tagger_name: string | null;
  tagger_email: string | null;
  tagger_timestamp: number | null;
  tagger_tz: string | null;
  message: string;
  encoding: string | null;
  gpg_signature: string | null;
}

/**
 * Compute Git-compatible SHA-1 hash for a tag
 */
async function computeGitTagId(tag: AnnotatedTag): Promise<ObjectId> {
  const entries = Array.from(tagToEntries(tag));
  const size = await computeTagSize(entries);

  const sha1 = new Sha1();
  sha1.update(encodeObjectHeader("tag", size));

  for await (const chunk of encodeTagEntries(entries)) {
    sha1.update(chunk);
  }

  return bytesToHex(sha1.finalize());
}

/**
 * Native SQL TagStore implementation
 *
 * Uses the vcs_tag table for storage and computes Git-compatible
 * SHA-1 object IDs for interoperability.
 */
export class SqlNativeTagStoreImpl implements SqlNativeTagStore {
  constructor(private db: DatabaseClient) {}

  /**
   * Store an annotated tag object with Git-compatible ID
   */
  async storeTag(tag: AnnotatedTag): Promise<ObjectId> {
    const tagId = await computeGitTagId(tag);

    // Check if tag already exists (deduplication)
    const existing = await this.db.query<{ id: number }>(
      "SELECT id FROM vcs_tag WHERE tag_id = ?",
      [tagId],
    );

    if (existing.length > 0) {
      return tagId;
    }

    // Store tag
    const now = Date.now();
    await this.db.execute(
      `INSERT INTO vcs_tag (
        tag_id, object_id, object_type, tag_name,
        tagger_name, tagger_email, tagger_timestamp, tagger_tz,
        message, encoding, gpg_signature, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        tagId,
        tag.object,
        tag.objectType,
        tag.tag,
        tag.tagger?.name || null,
        tag.tagger?.email || null,
        tag.tagger?.timestamp || null,
        tag.tagger?.tzOffset || null,
        tag.message,
        tag.encoding || null,
        tag.gpgSignature || null,
        now,
      ],
    );

    return tagId;
  }

  /**
   * Load a tag object by ID
   */
  async loadTag(id: ObjectId): Promise<AnnotatedTag> {
    const tags = await this.db.query<TagRow>("SELECT * FROM vcs_tag WHERE tag_id = ?", [id]);

    if (tags.length === 0) {
      throw new Error(`Tag ${id} not found`);
    }

    const row = tags[0];

    const tag: AnnotatedTag = {
      object: row.object_id,
      objectType: row.object_type as ObjectTypeCode,
      tag: row.tag_name,
      message: row.message,
    };

    if (row.tagger_name != null) {
      tag.tagger = {
        name: row.tagger_name,
        email: row.tagger_email || "",
        timestamp: row.tagger_timestamp || 0,
        tzOffset: row.tagger_tz || "+0000",
      };
    }

    if (row.encoding) {
      tag.encoding = row.encoding;
    }

    if (row.gpg_signature) {
      tag.gpgSignature = row.gpg_signature;
    }

    return tag;
  }

  /**
   * Get the tagged object ID
   */
  async getTarget(id: ObjectId, peel = false): Promise<ObjectId> {
    const tag = await this.loadTag(id);

    if (!peel || tag.objectType !== ObjectType.TAG) {
      return tag.object;
    }

    // Follow tag chain
    let current = tag.object;
    let depth = 0;

    while (depth < MAX_TAG_CHAIN_DEPTH) {
      const innerTags = await this.db.query<{ object_id: string; object_type: number }>(
        "SELECT object_id, object_type FROM vcs_tag WHERE tag_id = ?",
        [current],
      );

      if (innerTags.length === 0) {
        // Not a tag or not found - return current
        return current;
      }

      const innerTag = innerTags[0];
      if (innerTag.object_type !== ObjectType.TAG) {
        // Points to non-tag object
        return innerTag.object_id;
      }

      current = innerTag.object_id;
      depth++;
    }

    throw new Error(`Tag chain too deep (> ${MAX_TAG_CHAIN_DEPTH})`);
  }

  /**
   * Check if tag exists
   */
  async hasTag(id: ObjectId): Promise<boolean> {
    const result = await this.db.query<{ cnt: number }>(
      "SELECT COUNT(*) as cnt FROM vcs_tag WHERE tag_id = ?",
      [id],
    );
    return result[0].cnt > 0;
  }

  // --- Extended query methods ---

  /**
   * Find tags by name pattern
   */
  async *findByNamePattern(pattern: string): AsyncIterable<ObjectId> {
    const rows = await this.db.query<{ tag_id: string }>(
      "SELECT tag_id FROM vcs_tag WHERE tag_name LIKE ? ORDER BY tag_name",
      [pattern],
    );

    for (const row of rows) {
      yield row.tag_id;
    }
  }

  /**
   * Get tag count
   */
  async count(): Promise<number> {
    const result = await this.db.query<{ cnt: number }>("SELECT COUNT(*) as cnt FROM vcs_tag");
    return result[0].cnt;
  }
}
