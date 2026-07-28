/**
 * Public contract for the domain-neutral three-way merge engine.
 *
 * The engine compares three {@link FilesApi} trees (base / left / right) and
 * emits a *pure descriptor* of how to reconcile them. It performs NO writes to
 * any input — the caller materializes {@link MergeResult.operations} itself.
 */

import type { FileKind, FilesApi } from "@statewalker/webrun-files";

export type { FileKind, FilesApi };

/** A stream of bytes, as produced by {@link FilesApi.read}. */
export type ByteStream = AsyncIterable<Uint8Array>;

/** Which of the three inputs a piece of content comes from. */
export type Side = "base" | "left" | "right";

/** A snapshot reference to a single node in one of the input trees. */
export interface EntryRef {
  path: string;
  kind: FileKind;
  /** Content identity for files (via the injected hash); absent for directories. */
  hash?: string;
}

export type MergeOpKind = "add" | "modify" | "delete" | "rename";

/**
 * A single reconciliation step. Exactly one content carrier is present for
 * `add`/`modify`: either inline `content` (a computed text merge) or a `source`
 * reference the caller streams from. `rename` carries `from`; `delete` carries
 * only `path`.
 */
export interface MergeOp {
  op: MergeOpKind;
  /** Resulting path in the merged tree. */
  path: string;
  /** Source path for a `rename`. */
  from?: string;
  /** Resulting node kind for `add`/`modify`/`rename`. */
  kind?: FileKind;
  /** Inline bytes (used for computed text merges). */
  content?: Uint8Array;
  /** A reference to stream the resulting content from one of the inputs. */
  source?: { side: Side; path: string };
}

export type ConflictKind =
  | "content"
  | "modify-delete"
  | "add-add"
  | "rename-rename"
  | "rename-modify"
  | "type-change";

/** An unreconciled divergence. */
export interface Conflict {
  kind: ConflictKind;
  /** Primary path the conflict is about. */
  path: string;
  /** Additional involved paths (e.g. rename targets). */
  paths?: string[];
  base?: EntryRef;
  left?: EntryRef;
  right?: EntryRef;
}

export interface MergeResult {
  operations: MergeOp[];
  conflicts: Conflict[];
}

/** Input handed to a {@link ContentMerger}. */
export interface ContentMergeInput {
  /** Common-ancestor bytes (absent if the file did not exist in base). */
  base?: Uint8Array;
  left: Uint8Array;
  right: Uint8Array;
  /** The path being merged (informational). */
  path: string;
}

/** Result of a content merge attempt. */
export interface ContentMergeOutput {
  /** Merged bytes when the merge was clean. */
  merged?: Uint8Array;
  /** True when the two sides could not be reconciled. */
  conflict: boolean;
}

/** Pluggable per-file content reconciliation. */
export interface ContentMerger {
  merge(input: ContentMergeInput): ContentMergeOutput;
}

/**
 * A resolution folded back into {@link MergeResult.operations}. Returning
 * `undefined` from {@link MergeOptions.resolve} leaves the conflict unresolved.
 */
export interface Resolution {
  operations: MergeOp[];
}

/** Proposed non-exact rename pairs for one side. */
export interface RenameCandidates {
  /** Base files deleted on this side. */
  deleted: EntryRef[];
  /** Files added on this side. */
  added: EntryRef[];
}

export interface MergeOptions {
  /**
   * Injected content identity. Consumes a byte stream and returns a stable
   * digest. Equality, exact-rename detection, and same-change collapse all key
   * off this value. Required — the engine depends on no hashing package.
   */
  hashContent: (input: ByteStream) => Promise<string>;
  /** Per-file content reconciliation. Defaults to a line-based 3-way text merge. */
  contentMerger?: ContentMerger;
  /**
   * Heuristic rename detection for the deleted/added leftovers on each side,
   * consulted after built-in exact (hash-equal) rename matching.
   */
  renameStrategy?: (candidates: RenameCandidates) => Array<{ from: string; to: string }>;
  /** Optional conflict resolver. The engine owns no resolution policy. */
  resolve?: (conflict: Conflict) => Resolution | undefined;
  /**
   * Files whose byte size (on either side) exceeds this are never line-merged;
   * they are reconciled by hash only (equal ⇒ no op, differ ⇒ content conflict).
   */
  textMergeMaxBytes?: number;
}
