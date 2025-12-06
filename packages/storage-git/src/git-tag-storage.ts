/**
 * Git tag storage implementation
 *
 * Manages annotated tag objects with tag peeling support.
 *
 * Reference: jgit/org.eclipse.jgit/src/org/eclipse/jgit/lib/TagBuilder.java
 */

import type { AnnotatedTag, ObjectId, TagStorage } from "@webrun-vcs/storage";
import { ObjectType } from "@webrun-vcs/storage";
import { parseTag, serializeTag } from "./format/tag-format.js";
import type { GitObjectStorage } from "./git-object-storage.js";

/**
 * Git tag storage implementation
 *
 * Implements TagStorage for annotated tags.
 * Lightweight tags are just refs and are not handled here.
 */
export class GitTagStorage implements TagStorage {
  private readonly objectStorage: GitObjectStorage;

  constructor(objectStorage: GitObjectStorage) {
    this.objectStorage = objectStorage;
  }

  /**
   * Store an annotated tag object
   */
  async storeTag(tag: AnnotatedTag): Promise<ObjectId> {
    const content = serializeTag(tag);
    return this.objectStorage.storeTyped(ObjectType.TAG, content);
  }

  /**
   * Load a tag object by ID
   */
  async loadTag(id: ObjectId): Promise<AnnotatedTag> {
    const obj = await this.objectStorage.loadTyped(id);

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
      const obj = await this.objectStorage.loadTyped(currentId);

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
    if ((await this.objectStorage.getInfo(id)) === null) {
      return false;
    }

    // Verify it's actually a tag object
    try {
      const obj = await this.objectStorage.loadTyped(id);
      return obj.type === ObjectType.TAG;
    } catch {
      return false;
    }
  }
}
