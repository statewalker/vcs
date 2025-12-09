/**
 * Git tag storage implementation
 *
 * Manages annotated tag objects with tag peeling support.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TagBuilder.java
 */

import type { AnnotatedTag, ObjectId, ObjectStorage, TagStorage } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";
import { parseTag, serializeTag } from "./format/tag-format.js";
import { loadTypedObject, storeTypedObject } from "./typed-object-utils.js";

/**
 * Git tag storage implementation
 *
 * Implements TagStorage for annotated tags.
 * Lightweight tags are just refs and are not handled here.
 */
export class GitTagStorage implements TagStorage {
  private readonly rawStorage: ObjectStorage;

  constructor(rawStorage: ObjectStorage) {
    this.rawStorage = rawStorage;
  }

  /**
   * Store an annotated tag object
   */
  async storeTag(tag: AnnotatedTag): Promise<ObjectId> {
    const content = serializeTag(tag);
    return storeTypedObject(this.rawStorage, ObjectType.TAG, content);
  }

  /**
   * Load a tag object by ID
   */
  async loadTag(id: ObjectId): Promise<AnnotatedTag> {
    const obj = await loadTypedObject(this.rawStorage, id);

    if (obj.type !== ObjectType.TAG) {
      throw new Error(`Expected tag object, got type ${obj.type}`);
    }

    return parseTag(obj.content);
  }

  /**
   * Get the tagged object ID
   *
   * If peel is true, follows tag chains to the final non-tag object.
   */
  async getTarget(id: ObjectId, peel = false): Promise<ObjectId> {
    const tag = await this.loadTag(id);

    if (!peel || tag.objectType !== ObjectType.TAG) {
      return tag.object;
    }

    // Peel the tag chain
    let currentId = tag.object;
    let maxDepth = 100; // Prevent infinite loops

    while (maxDepth-- > 0) {
      const obj = await loadTypedObject(this.rawStorage, currentId);

      if (obj.type !== ObjectType.TAG) {
        return currentId;
      }

      const innerTag = parseTag(obj.content);
      currentId = innerTag.object;
    }

    throw new Error(`Tag chain too deep starting from ${id}`);
  }

  /**
   * Check if tag exists
   */
  async hasTag(id: ObjectId): Promise<boolean> {
    if (!(await this.rawStorage.has(id))) {
      return false;
    }

    // Verify it's actually a tag object
    try {
      const obj = await loadTypedObject(this.rawStorage, id);
      return obj.type === ObjectType.TAG;
    } catch {
      return false;
    }
  }
}
