import { createHash } from "node:crypto";
import { createContentStore } from "@statewalker/content-store";
import type { ByteStream, ChunkId, ContentStore, ObjectId } from "@statewalker/content-store";
import { memBlobStore } from "@statewalker/storage";

/** SHA-256 hex over a byte stream, prefixed — the injected `hashContent`. */
export async function sha256(input: ByteStream): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of input) h.update(chunk);
  return `sha256:${h.digest("hex")}`;
}

/** A fresh in-memory content store over the shared sha256 hasher. */
export function memContentStore(): ContentStore {
  return createContentStore({
    chunks: memBlobStore(),
    manifests: memBlobStore(),
    hashContent: sha256,
  });
}

/** Collect a byte stream into one contiguous Uint8Array. */
export async function collect(stream: ByteStream): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** A single-shot byte stream over the given bytes. */
export async function* streamOf(bytes: Uint8Array): ByteStream {
  yield bytes;
}

/** Deterministic pseudo-random bytes (xorshift32) — varied enough for CDC boundaries. */
export function prng(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}

/** Drain a transfer event stream into an array (throws on integrity/other error). */
export async function collectEvents<T>(events: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of events) out.push(e);
  return out;
}

/** Records per-method call activity so tests can assert dedup / batching / caps. */
export interface StoreSpy {
  putChunkIds: ChunkId[];
  hasChunksCalls: number;
  peakGetChunkConcurrency: number;
}

/**
 * Wrap a store, counting `putChunk` ids, `hasChunks` calls, and the peak number
 * of `getChunk` streams alive at once. `getChunk` yields on a microtask so that
 * a synchronous launch batch registers before any stream completes.
 */
export function spyStore(inner: ContentStore): { store: ContentStore; spy: StoreSpy } {
  const spy: StoreSpy = { putChunkIds: [], hasChunksCalls: 0, peakGetChunkConcurrency: 0 };
  let live = 0;
  const store: ContentStore = {
    ...inner,
    async hasChunks(ids) {
      spy.hasChunksCalls++;
      return inner.hasChunks(ids);
    },
    async putChunk(id, bytes) {
      spy.putChunkIds.push(id);
      await inner.putChunk(id, bytes);
    },
    getChunk(id) {
      return (async function* () {
        live++;
        spy.peakGetChunkConcurrency = Math.max(spy.peakGetChunkConcurrency, live);
        try {
          await Promise.resolve();
          yield* inner.getChunk(id);
        } finally {
          live--;
        }
      })();
    },
  };
  return { store, spy };
}

export type { ChunkId, ContentStore, ObjectId };
