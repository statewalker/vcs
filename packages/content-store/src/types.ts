/**
 * Public contract for the content-addressed large-object store.
 *
 * The store persists large byte streams as deduplicated, content-defined chunks
 * over the domain-neutral {@link BlobStore} seam. It is algorithm-agnostic: the
 * whole-object and per-chunk identities are computed by an injected
 * `hashContent`, and every id is treated as an OPAQUE string (it carries
 * whatever prefix the hasher produces). The store knows nothing of git, LFS,
 * SHA-256, commits, or sync.
 */

import type { BlobStore, ByteStream } from "@statewalker/storage";

export type { ByteStream };

/** Opaque id of a single content-defined chunk (produced by `hashContent`). */
export type ChunkId = string;

/** Opaque id of a whole stored object (produced by `hashContent`). */
export type ObjectId = string;

/** Where one chunk sits inside its object. Refs tile `[0, size)` exactly. */
export interface ChunkRef {
  id: ChunkId;
  offset: number;
  size: number;
}

/** Serialized recipe for reassembling an object from its chunks. */
export interface ObjectDescriptor {
  id: ObjectId;
  size: number;
  /** One entry for a direct blob; many for a CDC-chunked object. */
  chunks: ChunkRef[];
}

/** Injected backing stores + identity function. */
export interface ContentStoreDeps {
  /** Stores chunk bytes, keyed by {@link ChunkId}. */
  chunks: BlobStore;
  /** Stores serialized {@link ObjectDescriptor}s, keyed by {@link ObjectId}. */
  manifests: BlobStore;
  /** REQUIRED — the injected, algorithm-agnostic identity. Ids are opaque. */
  hashContent: (bytes: ByteStream) => Promise<string>;
}

/** Content-defined chunker tuning. */
export interface CdcParams {
  min: number;
  avg: number;
  max: number;
}

export interface ContentStoreOptions {
  /** Content strictly smaller than this is stored as a single direct blob (no CDC). */
  chunkThreshold?: number;
  /** Gear/FastCDC parameters. */
  cdc?: CdcParams;
}

export interface ContentStore {
  // object level
  /** Chunk + hash `content` in a bounded-memory pass, storing chunks + manifest. */
  put(content: ByteStream): Promise<ObjectDescriptor>;
  has(id: ObjectId): Promise<boolean>;
  /** Stream the object's bytes, optionally sliced; empty stream if absent. */
  read(id: ObjectId, range?: { offset?: number; length?: number }): ByteStream;
  getManifest(id: ObjectId): Promise<ObjectDescriptor | undefined>;
  /** Drop the object entry; its chunks are reclaimed later by {@link ContentStore.gc}. */
  remove(id: ObjectId): Promise<boolean>;
  // chunk level (transfer / dedup)
  /** Return exactly the ids NOT present in the chunk store. */
  hasChunks(ids: ChunkId[]): Promise<ChunkId[]>;
  putChunk(id: ChunkId, bytes: ByteStream): Promise<void>;
  getChunk(id: ChunkId): ByteStream;
  // maintenance
  /** Sweep every object not in `liveRoots` and every chunk they alone referenced. */
  gc(liveRoots: ObjectId[]): Promise<{ removedObjects: number; removedChunks: number }>;
}
