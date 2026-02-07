/**
 * Git tag store implementation
 *
 * Wraps GitObjectStore with tag serialization/deserialization.
 *
 * @module
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../../history/objects/object-store.js";
import { ObjectType } from "../../history/objects/object-types.js";
import {
  decodeTagEntries,
  encodeTagEntries,
  entriesToTag,
  tagToEntries,
} from "../../history/tags/tag-format.js";
import type { AnnotatedTag, Tags } from "../../history/tags/tags.js";

/**
 * Git tag store implementation
 *
 * Wraps GitObjectStore to provide tag-specific operations.
 * Implements the Tags interface for use with History.
 */
export class GitTags implements Tags {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store an annotated tag
   *
   * @param tag Annotated tag data
   * @returns ObjectId (SHA-1 hash)
   */
  async store(tag: AnnotatedTag): Promise<ObjectId> {
    const entries = tagToEntries(tag);
    return this.objects.store("tag", encodeTagEntries(entries));
  }

  /**
   * Load a tag by ID
   *
   * Returns undefined if tag doesn't exist.
   *
   * @param id Tag object ID
   * @returns AnnotatedTag if found, undefined otherwise
   */
  async load(id: ObjectId): Promise<AnnotatedTag | undefined> {
    if (!(await this.has(id))) {
      return undefined;
    }
    return this.loadTagInternal(id);
  }

  /**
   * Remove tag from storage
   *
   * @param id Tag object ID
   * @returns True if removed, false if didn't exist
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  /**
   * Load an annotated tag by ID (internal implementation)
   */
  private async loadTagInternal(id: ObjectId): Promise<AnnotatedTag> {
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
   *
   * @param id Tag object ID
   * @param peel Whether to follow tag chains
   * @returns Target object ID if tag exists, undefined otherwise
   */
  async getTarget(id: ObjectId, peel = false): Promise<ObjectId | undefined> {
    if (!(await this.has(id))) {
      return undefined;
    }

    const tag = await this.loadTagInternal(id);

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
      const nextTag = await this.loadTagInternal(currentId);
      currentId = nextTag.object;
    }
  }

  /**
   * Check if tag exists and is actually a tag object
   *
   * @param id Object ID
   * @returns True if object exists and is a tag
   */
  async has(id: ObjectId): Promise<boolean> {
    if (!(await this.objects.has(id))) {
      return false;
    }
    try {
      const header = await this.objects.getHeader(id);
      return header.type === "tag";
    } catch {
      return false;
    }
  }

  /**
   * Iterate over all tag object IDs
   *
   * @returns AsyncIterable of tag ObjectIds
   */
  async *keys(): AsyncIterable<ObjectId> {
    for await (const id of this.objects.list()) {
      try {
        const header = await this.objects.getHeader(id);
        if (header.type === "tag") {
          yield id;
        }
      } catch {
        // Skip invalid objects
      }
    }
  }
}

/**
 * Create a GitTags instance
 *
 * @param objects GitObjectStore to wrap
 * @returns GitTags instance
 */
export function createGitTags(objects: GitObjectStore): Tags {
  return new GitTags(objects);
}
