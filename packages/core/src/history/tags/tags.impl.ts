/**
 * Tags implementation using GitObjectStore
 *
 * This implementation wraps GitObjectStore for annotated tag storage,
 * ensuring Git-compatible format and SHA-1 computation.
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import { ObjectType } from "../objects/object-types.js";
import { decodeTagEntries, encodeTagEntries, entriesToTag, tagToEntries } from "./tag-format.js";
import type { Tag, Tags } from "./tags.js";

/**
 * Storage-agnostic Tags implementation using GitObjectStore
 *
 * Stores annotated tags in Git binary format for compatibility with
 * transport layer and SHA-1 computation.
 */
export class TagsImpl implements Tags {
  constructor(private readonly objects: GitObjectStore) {}

  /**
   * Store an annotated tag
   *
   * @param tag Tag data
   * @returns ObjectId of the stored tag
   */
  async store(tag: Tag): Promise<ObjectId> {
    const entries = tagToEntries(tag);
    return this.objects.store("tag", encodeTagEntries(entries));
  }

  /**
   * Load a tag by ID
   *
   * @param id Tag object ID
   * @returns Tag data if found, undefined otherwise
   */
  async load(id: ObjectId): Promise<Tag | undefined> {
    if (!(await this.objects.has(id))) {
      return undefined;
    }

    const [header, content] = await this.objects.loadWithHeader(id);
    try {
      if (header.type !== "tag") {
        // Not a tag, close the stream
        await content?.return?.(void 0);
        return undefined;
      }
      const entries = decodeTagEntries(content);
      return entriesToTag(entries);
    } catch {
      await content?.return?.(void 0);
      return undefined;
    }
  }

  /**
   * Check if tag exists
   *
   * @param id Tag object ID
   * @returns True if tag exists
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
   * Remove a tag
   *
   * @param id Tag object ID
   * @returns True if tag was removed, false if it didn't exist
   */
  remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  /**
   * Iterate over all stored tag IDs
   *
   * @returns AsyncIterable of all tag object IDs
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

  /**
   * Get the target object ID
   *
   * @param tagId Tag object ID
   * @param peel If true, follow tag chains to the final non-tag object
   * @returns Target object ID if tag exists, undefined otherwise
   */
  async getTarget(tagId: ObjectId, peel?: boolean): Promise<ObjectId | undefined> {
    const tag = await this.load(tagId);
    if (!tag) {
      return undefined;
    }

    if (!peel) {
      return tag.object;
    }

    // Peel: follow tag chains to the final non-tag object
    let targetId = tag.object;
    let targetType = tag.objectType;

    while (targetType === ObjectType.TAG) {
      const innerTag = await this.load(targetId);
      if (!innerTag) {
        // Target tag doesn't exist, return what we have
        return targetId;
      }
      targetId = innerTag.object;
      targetType = innerTag.objectType;
    }

    return targetId;
  }
}

/**
 * Create a Tags instance backed by GitObjectStore
 *
 * @param objects GitObjectStore implementation to use for persistence
 * @returns Tags instance
 */
export function createTags(objects: GitObjectStore): Tags {
  return new TagsImpl(objects);
}
