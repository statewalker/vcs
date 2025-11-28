import type { ObjectId, ObjectTypeCode, PersonIdent } from "./types.js";
/**
 * Annotated tag object
 *
 * Following Git's tag format (JGit RevTag):
 * - object: SHA-1 of the tagged object
 * - type: Type of the tagged object (usually "commit")
 * - tag: Tag name
 * - tagger: Person who created the tag (optional for lightweight tags)
 * - message: Tag message
 *
 * Note: Lightweight tags are just refs pointing to commits,
 * not stored as tag objects. This interface handles annotated tags only.
 */
export interface AnnotatedTag {
    /** ObjectId of the tagged object */
    object: ObjectId;
    /** Type of the tagged object */
    objectType: ObjectTypeCode;
    /** Tag name */
    tag: string;
    /** Tagger identity (optional) */
    tagger?: PersonIdent;
    /** Tag message */
    message: string;
    /** Character encoding (optional, defaults to UTF-8) */
    encoding?: string;
    /** GPG signature (optional) */
    gpgSignature?: string;
}
/**
 * Tag storage interface
 *
 * Manages annotated tag objects. Lightweight tags (refs only)
 * are handled separately by a refs/reference system.
 *
 * Implementation notes (JGit patterns):
 * - Tags are text-based like commits
 * - Format: "object <hex>\ntype <type>\ntag <name>\ntagger <ident>\n\n<message>"
 * - The "type" field is the string name of the object type
 */
export interface TagStorage {
    /**
     * Store an annotated tag object
     *
     * @param tag Tag data
     * @returns ObjectId of the stored tag
     */
    storeTag(tag: AnnotatedTag): Promise<ObjectId>;
    /**
     * Load a tag object by ID
     *
     * @param id ObjectId of the tag
     * @returns Parsed tag object
     * @throws Error if tag not found or invalid format
     */
    loadTag(id: ObjectId): Promise<AnnotatedTag>;
    /**
     * Get the tagged object ID
     *
     * Follows tag chains if the tag points to another tag.
     *
     * @param id ObjectId of the tag
     * @param peel If true, follow tag chains to the final non-tag object
     * @returns ObjectId of the (peeled) target object
     */
    getTarget(id: ObjectId, peel?: boolean): Promise<ObjectId>;
    /**
     * Check if tag exists
     *
     * @param id ObjectId of the tag
     * @returns True if tag exists
     */
    hasTag(id: ObjectId): Promise<boolean>;
}
