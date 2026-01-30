/**
 * Tags - New interface for annotated tag storage
 *
 * This is the new interface with bare naming convention (Tags instead of TagStore)
 * and consistent method names (remove instead of delete).
 */

import type { ObjectId, ObjectStorage } from "../object-storage.js";
import type { AnnotatedTag } from "./tag-store.js";

// Re-export types from existing module
export type { AnnotatedTag };

/**
 * Alias for AnnotatedTag - shorter name for common usage
 */
export type Tag = AnnotatedTag;

/**
 * Tag object store for annotated tags
 *
 * Annotated tags are objects that point to another object (usually
 * a commit) with additional metadata like tagger, date, and message.
 *
 * Lightweight tags are just refs and don't use this store.
 */
export interface Tags extends ObjectStorage<Tag> {
  /**
   * Store an annotated tag
   *
   * @param tag Tag data
   * @returns ObjectId of the stored tag
   */
  store(tag: Tag): Promise<ObjectId>;

  /**
   * Load a tag by ID
   *
   * @param id Tag object ID
   * @returns Tag data if found, undefined otherwise
   */
  load(id: ObjectId): Promise<Tag | undefined>;

  /**
   * Get the target object ID
   *
   * Convenience method to get what the tag points to without
   * loading the full tag object.
   *
   * @param tagId Tag object ID
   * @param peel If true, follow tag chains to the final non-tag object
   * @returns Target object ID if tag exists, undefined otherwise
   */
  getTarget(tagId: ObjectId, peel?: boolean): Promise<ObjectId | undefined>;
}

/**
 * Extended queries for native Tags implementations
 *
 * These methods are optional and only available in implementations
 * that support advanced queries (e.g., SQL with indexes).
 */
export interface TagsExtended extends Tags {
  /**
   * Find tags by tagger
   *
   * @param tagger Tagger name or email pattern
   * @returns AsyncIterable of matching tag IDs
   */
  findByTagger?(tagger: string): AsyncIterable<ObjectId>;

  /**
   * Find tags by target type
   *
   * @param targetType Target object type (commit, tree, blob, tag)
   * @returns AsyncIterable of matching tag IDs
   */
  findByTargetType?(targetType: string): AsyncIterable<ObjectId>;
}
