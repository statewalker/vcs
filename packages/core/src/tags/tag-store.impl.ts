/**
 * Git tag store implementation
 *
 * Wraps GitObjectStore with tag serialization/deserialization.
 */

import type { ObjectId } from "../id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import { ObjectType } from "../objects/object-types.js";
import { decodeTagEntries, encodeTagEntries, entriesToTag, tagToEntries } from "./tag-format.js";
import type { AnnotatedTag, TagStore } from "./tag-store.js";

/**
 * Git tag store implementation
 *
 * Handles tag serialization and delegates storage to GitObjectStore.
 */
export class GitTagStore implements TagStore {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store an annotated tag
   */
  async storeTag(tag: AnnotatedTag): Promise<ObjectId> {
    const entries = tagToEntries(tag);
    return this.objects.store("tag", encodeTagEntries(entries));
  }

  /**
   * Load an annotated tag by ID
   */
  async loadTag(id: ObjectId): Promise<AnnotatedTag> {
    const [header, content] = await this.objects.loadWithHeader(id);
    try {
      if (header.type !== "tag") {
        throw new Error(`Object ${id} is not a tag (found type: ${header.type})`);
      }
      const entries = decodeTagEntries(content);
      return entriesToTag(entries);
    } catch (err) {
      content?.return?.(void 0);
      throw err;
    }
  }

  /**
   * Get the tagged object ID
   *
   * Follows tag chains if peel is true.
   */
  async getTarget(id: ObjectId, peel = false): Promise<ObjectId> {
    const tag = await this.loadTag(id);

    if (!peel || tag.objectType !== ObjectType.TAG) {
      return tag.object;
    }

    // Follow tag chain
    let currentId = tag.object;
    while (true) {
      const header = await this.objects.getHeader(currentId);
      if (header.type !== "tag") {
        return currentId;
      }
      const nextTag = await this.loadTag(currentId);
      currentId = nextTag.object;
    }
  }

  /**
   * Check if tag exists
   */
  hasTag(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }
}
