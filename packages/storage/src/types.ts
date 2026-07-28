/**
 * Public contract for the domain-neutral byte-persistence seam.
 *
 * Two low-level primitives — an immutable content-addressed {@link BlobStore}
 * and a mutable {@link KvStore} with atomic compare-and-set — plus thin typed
 * facades built over them. The seam stores bytes: it knows nothing of git
 * objects, chunks, or hashing. The caller owns every id (storage is
 * hash-agnostic).
 */

/** A stream of bytes, as produced by {@link import("@statewalker/webrun-files").FilesApi.read}. */
export type ByteStream = AsyncIterable<Uint8Array>;

/**
 * Immutable, content-addressed byte store keyed by a caller-supplied id.
 *
 * `put` is idempotent for a given id: because the id names the content, a
 * re-put of the same id overwrites with identical bytes and never errors.
 */
export interface BlobStore {
  /**
   * Store `bytes` under `id`. Streaming and bounded-memory — the payload is
   * never buffered into one contiguous allocation. When `opts.verify` is given,
   * the re-derived id must equal `id`, otherwise `put` rejects and stores nothing.
   */
  put(
    id: string,
    bytes: ByteStream,
    opts?: { verify?: (bytes: ByteStream) => Promise<string> },
  ): Promise<void>;
  /** Read the blob's bytes. Yields an empty stream if the id is absent (FilesApi convention). */
  get(id: string): ByteStream;
  has(id: string): Promise<boolean>;
  /** Remove the blob; resolves `true` if something was removed, `false` if absent. */
  remove(id: string): Promise<boolean>;
  /** Ids currently stored, optionally filtered by prefix. */
  list(prefix?: string): AsyncIterable<string>;
}

/**
 * `BlobStore` keyed by a git object id. The seam adds no git semantics, so this
 * is a plain alias; `content-store` callers use {@link BlobStore} directly.
 */
export type ObjectStore = BlobStore;

/** Mutable keyed byte store with an atomic compare-and-set. */
export interface KvStore {
  get(key: string): Promise<Uint8Array | undefined>;
  put(key: string, value: Uint8Array): Promise<void>;
  /**
   * Atomic compare-and-set. Writes `next` and returns `true` iff the current
   * value deep-equals `expected` (both-undefined counts as a match, i.e. create).
   * On mismatch returns `false` and writes nothing. `next === undefined` deletes.
   */
  cas(
    key: string,
    expected: Uint8Array | undefined,
    next: Uint8Array | undefined,
  ): Promise<boolean>;
  remove(key: string): Promise<boolean>;
  list(prefix?: string): AsyncIterable<{ key: string; value: Uint8Array }>;
}

/** Thin facade over a {@link KvStore} that stores string ids as UTF-8 bytes. */
export interface RefStore {
  read(name: string): Promise<string | undefined>;
  compareAndSet(
    name: string,
    expected: string | undefined,
    next: string | undefined,
  ): Promise<boolean>;
  list(prefix?: string): AsyncIterable<{ name: string; id: string }>;
}
