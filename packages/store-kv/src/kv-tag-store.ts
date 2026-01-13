/**
 * KV-based TagStore implementation
 *
 * Stores annotated tag objects using a key-value backend with JSON serialization.
 */

import type { AnnotatedTag, ObjectId, ObjectTypeCode, TagStore } from "@statewalker/vcs-core";
import { computeTagHash, ObjectType } from "@statewalker/vcs-core";

import type { KVStore } from "./kv-store.js";

/**
 * Key prefix for tag data
 */
const TAG_PREFIX = "tag:";

/**
 * Maximum depth for following tag chains to prevent infinite loops.
 */
const MAX_TAG_CHAIN_DEPTH = 100;

/**
 * Serialized tag format
 */
interface SerializedTag {
  o: string; // object
  ot: number; // objectType
  t: string; // tag name
  tn?: string; // tagger name
  te?: string; // tagger email
  tt?: number; // tagger timestamp
  tz?: string; // tagger tzOffset
  m: string; // message
  e?: string; // encoding
  g?: string; // gpgSignature
}

/**
 * Text encoder/decoder for JSON serialization
 */
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * KV-based TagStore implementation.
 */
export class KVTagStore implements TagStore {
  constructor(private kv: KVStore) {}

  /**
   * Store an annotated tag object.
   */
  async storeTag(tag: AnnotatedTag): Promise<ObjectId> {
    const tagId = computeTagHash(tag);

    // Check if tag already exists (deduplication)
    if (await this.kv.has(`${TAG_PREFIX}${tagId}`)) {
      return tagId;
    }

    // Serialize
    const serialized: SerializedTag = {
      o: tag.object,
      ot: tag.objectType,
      t: tag.tag,
      tn: tag.tagger?.name,
      te: tag.tagger?.email,
      tt: tag.tagger?.timestamp,
      tz: tag.tagger?.tzOffset,
      m: tag.message,
      e: tag.encoding,
      g: tag.gpgSignature,
    };

    await this.kv.set(`${TAG_PREFIX}${tagId}`, encoder.encode(JSON.stringify(serialized)));

    return tagId;
  }

  /**
   * Load a tag object by ID.
   */
  async loadTag(id: ObjectId): Promise<AnnotatedTag> {
    const data = await this.kv.get(`${TAG_PREFIX}${id}`);
    if (!data) {
      throw new Error(`Tag ${id} not found`);
    }

    const s: SerializedTag = JSON.parse(decoder.decode(data));

    return {
      object: s.o,
      objectType: s.ot as ObjectTypeCode,
      tag: s.t,
      tagger:
        s.tn != null
          ? {
              name: s.tn,
              email: s.te || "",
              timestamp: s.tt || 0,
              tzOffset: s.tz || "+0000",
            }
          : undefined,
      message: s.m,
      encoding: s.e,
      gpgSignature: s.g,
    };
  }

  /**
   * Get the tagged object ID.
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
      const data = await this.kv.get(`${TAG_PREFIX}${current}`);
      if (!data) {
        // Not a tag or not found - return current
        return current;
      }

      const innerTag: SerializedTag = JSON.parse(decoder.decode(data));
      if (innerTag.ot !== ObjectType.TAG) {
        // Points to non-tag object
        return innerTag.o;
      }

      current = innerTag.o;
      depth++;
    }

    throw new Error(`Tag chain too deep (> ${MAX_TAG_CHAIN_DEPTH})`);
  }

  /**
   * Check if tag exists.
   */
  async hasTag(id: ObjectId): Promise<boolean> {
    return this.kv.has(`${TAG_PREFIX}${id}`);
  }
}
