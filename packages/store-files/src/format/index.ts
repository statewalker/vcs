/**
 * Git object format serialization
 *
 * Implements Git object format for:
 * - Blobs (raw content)
 * - Trees (directory entries)
 * - Commits (commit metadata)
 * - Tags (annotated tags)
 */

export * from "./commit-format.js";
export * from "./object-header.js";
export * from "./person-ident.js";
export * from "./tag-format.js";
export * from "./tree-format.js";
