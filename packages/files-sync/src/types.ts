/**
 * Public contract for the rclone-like file-synchronisation engine.
 *
 * The engine plans-then-executes over two {@link FilesApi} endpoints. {@link plan}
 * is pure (mutates neither endpoint) and returns a serializable {@link SyncPlan};
 * {@link execute} applies it, emitting {@link SyncEvent}s and resuming from an
 * optional checkpoint after interruption.
 */

// merge-core is the authority for the three-way merge result and conflict shapes.
// It exports the conflict type as `Conflict`; we surface it under the sync name.
import type { Resolution, Conflict as SyncConflict } from "@statewalker/merge-core";
import type { FilesApi } from "@statewalker/webrun-files";

export type { FilesApi, SyncConflict, Resolution };

/** A stream of bytes, as produced by {@link FilesApi.read}. */
export type ByteStream = AsyncIterable<Uint8Array>;

/**
 * Path predicate: return `true` to INCLUDE a path in the sync, `false` to skip.
 * `webrun-files` does not export a `PathFilter`, so it is defined here.
 */
export type PathFilter = (path: string) => boolean;

export type SyncOp = "copy" | "sync" | "bisync" | "move" | "check";

/**
 * How a transferred file is verified at the destination.
 * `size` compares byte counts (cheap default); `content-hash`/`backend-hash`/
 * `read-after-write` re-hash the destination bytes; `mtime` falls back to size
 * (cross-endpoint mtime is not comparable).
 */
export type VerificationMode =
  | "size"
  | "mtime"
  | "backend-hash"
  | "content-hash"
  | "read-after-write";

/**
 * A single typed step of a {@link SyncPlan}. Serializable by construction.
 * `copy`/`update` read `path` from the `from` endpoint and write it to the other;
 * `move` renames within one `side`; `delete` removes `path` from one `side`;
 * `mkdir` creates an (empty) directory on the destination of a one-way op.
 *
 * (The grilled note also listed a `metadata` action; it is intentionally omitted
 * — the same note puts "arbitrary metadata beyond FilesApi size/mtime" out of
 * scope, and MemFilesApi exposes no metadata setter, so it would be dead code.)
 */
export type SyncAction =
  | { kind: "mkdir"; path: string }
  | { kind: "copy"; path: string; from: "a" | "b" }
  | { kind: "update"; path: string; from: "a" | "b" }
  | { kind: "move"; from: string; to: string; side: "a" | "b" }
  | { kind: "delete"; path: string; side: "a" | "b" };

/** A serializable, dry-runnable, auditable plan. */
export interface SyncPlan {
  op: SyncOp;
  actions: SyncAction[];
  conflicts: SyncConflict[];
  /** Non-fatal notices raised while planning (e.g. first bisync with no anchor). */
  warnings?: string[];
}

/** Events streamed by {@link execute}. */
export type SyncEvent =
  | { type: "warning"; message: string }
  | { type: "conflict"; conflict: SyncConflict }
  | { type: "start"; index: number; action: SyncAction }
  | { type: "done"; index: number; action: SyncAction }
  | { type: "skipped"; index: number; action: SyncAction; reason: string }
  | { type: "failed"; index: number; action: SyncAction; reason: string };

/**
 * Executes a single copy/update. Injected so a later phase can plug a
 * chunk-dedup transfer into the SAME seam; the default streams whole files.
 */
export interface Transfer {
  run(action: SyncAction, from: FilesApi, to: FilesApi): Promise<void>;
}

/** Content-id + metadata manifest of the last successful sync (bisync base). */
export interface SyncAnchor {
  entries: Record<string, { contentId: string; size: number; mtime: number }>;
}

/** Persistence for the {@link SyncAnchor} of an endpoint pair (bisync). */
export interface AnchorStore {
  read(pairKey: string): Promise<SyncAnchor | undefined>;
  write(pairKey: string, anchor: SyncAnchor): Promise<void>;
}

/**
 * Progress checkpoint enabling resume: records the indices of completed actions.
 * `execute` skips completed indices and records each new one before yielding its
 * `done` event, so an interrupted run resumes with no duplicate work.
 */
export interface CheckpointStore {
  read(): Promise<Set<number>>;
  add(index: number): Promise<void>;
}

export interface SyncOptions {
  /** Content identity — the ladder terminal and the id shared with merge-core. */
  hashContent: (input: ByteStream) => Promise<string>;
  filter?: PathFilter;
  /** Copy/update executor; defaults to whole-file streaming copy. */
  transfer?: Transfer;
  /** Destination verification mode; defaults to `size`. */
  verify?: VerificationMode;
  /** SyncAnchor persistence (bisync only). */
  anchorStore?: AnchorStore;
  /** Identifies the endpoint pair for the anchor store (bisync); defaults to "default". */
  pairKey?: string;
  /** Injected conflict-resolution policy (bisync). */
  resolve?: (c: SyncConflict) => Resolution | undefined;
  /** Enable the head/tail sample rung of the change-detection ladder. */
  quickFingerprint?: boolean;
  /** Resume support for {@link execute}. */
  checkpoint?: CheckpointStore;
}
