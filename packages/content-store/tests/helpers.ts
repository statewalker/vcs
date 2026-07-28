import { createHash } from "node:crypto";
import { type BlobStore, filesBlobStore, memBlobStore } from "@statewalker/storage";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import type { ByteStream } from "../src/index.js";

/** SHA-256 hex over a byte stream, prefixed — the injected `hashContent`. */
export async function sha256(input: ByteStream): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of input) h.update(chunk);
  return `sha256:${h.digest("hex")}`;
}

/** Collect a byte stream into one contiguous Uint8Array (test-side only). */
export async function collect(stream: ByteStream): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of stream) parts.push(chunk);
  return concat(parts);
}

export function concat(parts: Uint8Array[]): Uint8Array {
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

/** Splice `insert` into `base` at `at`, returning a new buffer. */
export function insertAt(base: Uint8Array, at: number, insert: Uint8Array): Uint8Array {
  return concat([base.subarray(0, at), insert, base.subarray(at)]);
}

export interface Backend {
  name: string;
  make(): { chunks: BlobStore; manifests: BlobStore };
}

/** The two storage backends the whole suite runs over: mem + files (MemFilesApi). */
export const backends: Backend[] = [
  {
    name: "mem",
    make: () => ({ chunks: memBlobStore(), manifests: memBlobStore() }),
  },
  {
    name: "files",
    make: () => ({
      chunks: filesBlobStore(new MemFilesApi(), { root: "/chunks" }),
      manifests: filesBlobStore(new MemFilesApi(), { root: "/manifests" }),
    }),
  },
];
