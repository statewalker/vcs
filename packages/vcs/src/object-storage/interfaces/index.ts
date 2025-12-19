/**
 * Object storage interfaces
 *
 * Re-exports the typed store interfaces from the main interfaces folder.
 * These are kept in sync during the migration period.
 */

export type { BlobStore } from "../../interfaces/blob-store.js";
export type { AncestryOptions, Commit, CommitStore } from "../../interfaces/commit-store.js";
export { RefStoreLocation } from "../../interfaces/ref-store.js";
export type { Ref, RefStore, RefUpdateResult, SymbolicRef } from "../../interfaces/ref-store.js";
export type { AnnotatedTag, TagStore } from "../../interfaces/tag-store.js";
export type { TreeEntry, TreeStore } from "../../interfaces/tree-store.js";
