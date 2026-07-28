/**
 * @statewalker/content-transfer
 *
 * Resumable, chunk-aware byte mover. Given the object ids a destination needs,
 * it transfers only the chunks the destination is MISSING from a source
 * {@link ContentStore} to a destination store, over the domain-neutral
 * `@statewalker/webrun-streams` {@link Duplex} substrate. It is symmetric —
 * either endpoint may be a wire {@link remoteStore} proxy in front of a
 * {@link serveStore} handler. Every received chunk is verified by re-hash before
 * it is written; a serializable checkpoint makes an interrupted transfer
 * resumable. It knows nothing of git, LFS, or sync.
 */

export { chunkTransfer } from "./chunk-transfer.js";
export type { FileSyncAction, FileTransfer } from "./chunk-transfer.js";
export { remoteStore } from "./remote-store.js";
export { serveStore } from "./serve-store.js";
export { transfer } from "./transfer.js";
export type {
  AssemblingStore,
  Capabilities,
  HashContent,
  TransferCheckpoint,
  TransferEvent,
  TransferLimits,
  TransferOptions,
} from "./types.js";
