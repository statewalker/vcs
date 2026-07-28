/**
 * @statewalker/files-sync
 *
 * rclone-like file-synchronisation engine (copy / sync / bisync / move / check)
 * over two `@statewalker/webrun-files` endpoints. Plan-then-execute: {@link plan}
 * is pure and produces a serializable {@link SyncPlan}; {@link execute} applies
 * it, verifying and resuming. Bidirectional sync is a three-way merge over a
 * sync-owned anchor, delegated to `@statewalker/merge-core`.
 *
 * Domain-neutral: this package imports ONLY webrun-files + merge-core and knows
 * nothing about git or versioning (Axis A / Axis B ban).
 */

export { buildAnchor } from "./anchor.js";
export { isChanged, snapshot } from "./change-detection.js";
export { execute } from "./execute.js";
export { plan } from "./plan.js";
export { createStreamingTransfer } from "./transfer.js";
export type {
  AnchorStore,
  ByteStream,
  CheckpointStore,
  FilesApi,
  PathFilter,
  Resolution,
  SyncAction,
  SyncAnchor,
  SyncConflict,
  SyncEvent,
  SyncOp,
  SyncOptions,
  SyncPlan,
  Transfer,
  VerificationMode,
} from "./types.js";
