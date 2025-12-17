/**
 * In-memory TagStore implementation
 *
 * Provides a pure in-memory tag storage for testing and ephemeral operations.
 * No persistence - data is lost when the instance is garbage collected.
 *
 * Unlike file-based implementations, this does not use Git format serialization.
 * Tags are stored directly as JavaScript objects for simplicity and performance.
 */

import type { AnnotatedTag, ObjectId, TagStore } from "@webrun-vcs/vcs";
import { ObjectType } from "@webrun-vcs/vcs";

/**
 * Maximum depth for following tag chains to prevent infinite loops.
 */
const MAX_TAG_CHAIN_DEPTH = 100;

/**
 * Simple hash function for generating deterministic object IDs.
 */
function computeTagHash(tag: AnnotatedTag): ObjectId {
  const content = JSON.stringify({
    object: tag.object,
    objectType: tag.objectType,
    tag: tag.tag,
    tagger: tag.tagger,
    message: tag.message,
    encoding: tag.encoding,
  });

  // Simple hash (FNV-1a inspired)
  let hash = 2166136261;
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  return `tag${hex}${"0".repeat(29)}`;
}

/**
 * In-memory TagStore implementation.
 */
export class MemoryTagStore implements TagStore {
  private tags = new Map<ObjectId, AnnotatedTag>();

  /**
   * Store an annotated tag object.
   */
  async storeTag(tag: AnnotatedTag): Promise<ObjectId> {
    const id = computeTagHash(tag);

    // Store a deep copy to prevent external mutation
    if (!this.tags.has(id)) {
      this.tags.set(id, {
        object: tag.object,
        objectType: tag.objectType,
        tag: tag.tag,
        tagger: tag.tagger ? { ...tag.tagger } : undefined,
        message: tag.message,
        encoding: tag.encoding,
        gpgSignature: tag.gpgSignature,
      });
    }

    return id;
  }

  /**
   * Load a tag object by ID.
   */
  async loadTag(id: ObjectId): Promise<AnnotatedTag> {
    const tag = this.tags.get(id);
    if (!tag) {
      throw new Error(`Tag ${id} not found`);
    }

    // Return a copy to prevent external mutation
    return {
      object: tag.object,
      objectType: tag.objectType,
      tag: tag.tag,
      tagger: tag.tagger ? { ...tag.tagger } : undefined,
      message: tag.message,
      encoding: tag.encoding,
      gpgSignature: tag.gpgSignature,
    };
  }

  /**
   * Get the tagged object ID.
   *
   * Follows tag chains if the tag points to another tag and peel is true.
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
      const innerTag = this.tags.get(current);
      if (!innerTag) {
        // Not a tag or not found - return current
        return current;
      }

      if (innerTag.objectType !== ObjectType.TAG) {
        // Points to non-tag object
        return innerTag.object;
      }

      current = innerTag.object;
      depth++;
    }

    throw new Error(`Tag chain too deep (> ${MAX_TAG_CHAIN_DEPTH})`);
  }

  /**
   * Check if tag exists.
   */
  async hasTag(id: ObjectId): Promise<boolean> {
    return this.tags.has(id);
  }
}
