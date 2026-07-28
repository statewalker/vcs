/**
 * @statewalker/merge-core
 *
 * Domain-neutral three-way merge/diff engine over the webrun-files FilesApi.
 * Knows nothing about git, sync, or any specific domain. {@link merge} returns
 * a pure descriptor of reconciliation operations and conflicts — it never
 * writes to any input tree.
 */

export { createTextContentMerger } from "./content-merger.js";
export { merge } from "./merge.js";
export { threeWayMergeLines } from "./text-merge.js";
export type {
  ByteStream,
  Conflict,
  ConflictKind,
  ContentMergeInput,
  ContentMergeOutput,
  ContentMerger,
  EntryRef,
  FileKind,
  FilesApi,
  MergeOp,
  MergeOpKind,
  MergeOptions,
  MergeResult,
  RenameCandidates,
  Resolution,
  Side,
} from "./types.js";
