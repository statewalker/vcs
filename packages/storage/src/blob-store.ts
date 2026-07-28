import type { ByteStream } from "./types.js";

/** Wrap already-collected chunks as a re-readable byte stream. */
export async function* toStream(chunks: Uint8Array[]): ByteStream {
  yield* chunks;
}

/**
 * Run the optional integrity check for a blob `put`. Rejects when the caller's
 * `verify` re-derives an id that differs from the supplied one. Shared by every
 * {@link import("./types.js").BlobStore} adapter so the flag behaves identically.
 */
export async function assertVerified(
  id: string,
  chunks: Uint8Array[],
  verify?: (bytes: ByteStream) => Promise<string>,
): Promise<void> {
  if (!verify) return;
  const computed = await verify(toStream(chunks));
  if (computed !== id) {
    throw new Error(`blob id mismatch: supplied "${id}", verify computed "${computed}"`);
  }
}
