/**
 * Git tag store implementation
 *
 * Wraps GitObjectStore with tag serialization/deserialization.
 */

import { toArray } from "../../format/stream-utils.js";
import {
  decodeTagEntries,
  encodeTagEntries,
  entriesToTag,
  tagToEntries,
} from "../../format/tag-format.js";
import {
  type AnnotatedTag,
  type ObjectId,
  ObjectType,
  type TagStore,
} from "../interfaces/index.js";
import type { GitObjectStore } from "./git-object-store.js";

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
    const header = await this.objects.getHeader(id);
    if (header.type !== "tag") {
      throw new Error(`Object ${id} is not a tag (found type: ${header.type})`);
    }
    const entries = await toArray(decodeTagEntries(this.objects.load(id)));
    return entriesToTag(entries);
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
