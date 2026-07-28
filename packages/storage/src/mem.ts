import { assertVerified, toStream } from "./blob-store.js";
import type { BlobStore, ByteStream, KvStore } from "./types.js";

/** In-memory {@link BlobStore}. Chunks are kept as a list (never one big concat). */
export function memBlobStore(): BlobStore {
  const store = new Map<string, Uint8Array[]>();
  return {
    async put(id, bytes, opts) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of bytes) chunks.push(chunk);
      await assertVerified(id, chunks, opts?.verify);
      store.set(id, chunks);
    },
    get(id, range): ByteStream {
      const chunks = store.get(id) ?? [];
      return toStream(range ? sliceChunks(chunks, range) : chunks);
    },
    async has(id) {
      return store.has(id);
    },
    async size(id) {
      const chunks = store.get(id);
      if (chunks === undefined) return -1;
      return chunks.reduce((n, c) => n + c.length, 0);
    },
    async remove(id) {
      return store.delete(id);
    },
    async *list(prefix) {
      for (const id of store.keys()) {
        if (prefix === undefined || id.startsWith(prefix)) yield id;
      }
    },
  };
}

/**
 * Return the `[start, end)` slice of a chunk list (end exclusive, start default
 * 0, end default total length) as a new chunk list — mirrors RawStorage.load.
 */
function sliceChunks(
  chunks: Uint8Array[],
  range: { start?: number; end?: number },
): Uint8Array[] {
  const start = range.start ?? 0;
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const end = range.end ?? total;
  const out: Uint8Array[] = [];
  let pos = 0;
  for (const chunk of chunks) {
    const chunkStart = pos;
    const chunkEnd = pos + chunk.length;
    pos = chunkEnd;
    if (chunkEnd <= start || chunkStart >= end) continue;
    const from = Math.max(start, chunkStart) - chunkStart;
    const to = Math.min(end, chunkEnd) - chunkStart;
    out.push(chunk.subarray(from, to));
  }
  return out;
}

function bytesEqual(a: Uint8Array | undefined, b: Uint8Array | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** In-memory {@link KvStore} with a natively-atomic compare-and-set. */
export function memKvStore(): KvStore {
  const store = new Map<string, Uint8Array>();
  return {
    async get(key) {
      const v = store.get(key);
      return v === undefined ? undefined : v.slice();
    },
    async put(key, value) {
      store.set(key, value.slice());
    },
    async cas(key, expected, next) {
      // Single-threaded JS: compare-then-set with no intervening await is
      // atomic, so two concurrent cas with the same `expected` run sequentially
      // on the event loop and exactly one wins. Backends without native
      // conditional writes (sql/kv) will need a lease/lock shim — deferred to
      // that adapter slice; it is unnecessary for this natively-atomic store.
      if (!bytesEqual(store.get(key), expected)) return false;
      if (next === undefined) store.delete(key);
      else store.set(key, next.slice());
      return true;
    },
    async remove(key) {
      return store.delete(key);
    },
    async *list(prefix) {
      for (const [key, value] of store) {
        if (prefix === undefined || key.startsWith(prefix)) yield { key, value: value.slice() };
      }
    },
  };
}
