/**
 * Public contract for the resumable, chunk-aware content transfer.
 *
 * The mover copies the chunks a destination is MISSING from a source
 * {@link ContentStore} to a destination store, over the domain-neutral
 * `@statewalker/webrun-streams` {@link Duplex} substrate. It is symmetric:
 * either endpoint may be a {@link remoteStore} proxy (upload = remote `to`,
 * download = remote `from`). It knows nothing of git, LFS, Xet, or sync — it
 * moves opaque chunks between two content stores and verifies them by re-hash.
 */

import type {
  ByteStream,
  ChunkId,
  ContentStore,
  ObjectDescriptor,
  ObjectId,
} from "@statewalker/content-store";

export type { ByteStream, ChunkId, ContentStore, ObjectId };

/** Bounds on the transfer pipeline. */
export interface TransferLimits {
  /** Max chunks fetched + verified + written concurrently. Default 4. */
  concurrency?: number;
  /** Ceiling on the bytes of in-flight (fetched-but-not-yet-written) chunks. Default 8 MiB. */
  maxBufferedBytes?: number;
  /** Max chunk ids per `hasChunks` negotiation request. Default 256. */
  batchSize?: number;
}

/**
 * Serializable resume point. `done` are chunk ids already delivered to the
 * destination; `pending` is advisory (the still-missing set at checkpoint time).
 * Resume re-verifies the source still holds every object before continuing.
 */
export interface TransferCheckpoint {
  objectIds: ObjectId[];
  done: ChunkId[];
  pending: ChunkId[];
}

/** Injected identity — the SAME function the content stores use. Re-hash of a
 * received chunk must equal its id, or the chunk is rejected and the transfer
 * fails loudly. */
export type HashContent = (bytes: ByteStream) => Promise<string>;

/** Progress events streamed by {@link transfer}. */
export type TransferEvent =
  | { type: "resumed"; done: number }
  | { type: "negotiated"; objects: number; chunks: number; missing: number; protocol?: string }
  | { type: "chunk-sent"; chunkId: ChunkId; size: number }
  | { type: "object-done"; objectId: ObjectId };

export interface TransferOptions {
  limits?: TransferLimits;
  checkpoint?: TransferCheckpoint;
  hashContent?: HashContent;
}

/** Peer capabilities exchanged before transfer over a {@link remoteStore}. */
export interface Capabilities {
  protocol: string;
}

/**
 * A {@link ContentStore} that can register an object's manifest from chunks it
 * already holds — the "assemble" step, without shipping the object's bytes.
 * A local store lacks it (transfer falls back to {@link ContentStore.put}); the
 * wire {@link remoteStore} proxy provides it so assemble costs only the manifest.
 */
export interface AssemblingStore extends ContentStore {
  putManifest(manifest: ObjectDescriptor): Promise<void>;
  capabilities(): Promise<Capabilities>;
}
