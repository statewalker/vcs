/**
 * Git tag store implementation
 *
 * Wraps GitObjectStore with tag serialization/deserialization.
 * Implements both TagStore (legacy) and Tags (new) interfaces.
 */

import type { ObjectId } from "../../common/id/index.js";
import type { GitObjectStore } from "../objects/object-store.js";
import { ObjectType } from "../objects/object-types.js";
import { decodeTagEntries, encodeTagEntries, entriesToTag, tagToEntries } from "./tag-format.js";
import type { TagStore } from "./tag-store.js";
import type { AnnotatedTag, Tags } from "./tags.js";

/**
 * Git tag store implementation
 *
 * Handles tag serialization and delegates storage to GitObjectStore.
 * Implements both TagStore (legacy) and Tags (new) interfaces.
 */
export class GitTagStore implements TagStore, Tags {
  constructor(private readonly objects: GitObjectStore) {}

  // ============ New Tags Interface ============

  /**
   * Store an annotated tag (new interface)
   */
  async store(tag: AnnotatedTag): Promise<ObjectId> {
    const entries = tagToEntries(tag);
    return this.objects.store("tag", encodeTagEntries(entries));
  }

  /**
   * Load a tag by ID (new interface)
   * Returns undefined if tag doesn't exist.
   */
  async load(id: ObjectId): Promise<AnnotatedTag | undefined> {
    if (!(await this.has(id))) {
      return undefined;
    }
    return this.loadTag(id);
  }

  /**
   * Remove tag (new interface)
   */
  async remove(id: ObjectId): Promise<boolean> {
    return this.objects.remove(id);
  }

  // ============ Legacy TagStore Interface ============

  /**
   * Store an annotated tag (legacy)
   */
  async storeTag(tag: AnnotatedTag): Promise<ObjectId> {
    return this.store(tag);
  }

  /**
   * Load an annotated tag by ID (legacy)
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

  // ============ Common Methods ============

  /**
   * Get the tagged object ID
   *
   * Follows tag chains if peel is true.
   * Returns undefined if tag doesn't exist (new interface behavior).
   */
  async getTarget(id: ObjectId, peel = false): Promise<ObjectId | undefined> {
    if (!(await this.has(id))) {
      return undefined;
    }

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
   * Enumerate all tag object IDs
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
