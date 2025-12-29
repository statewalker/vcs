/**
 * Delta chain resolution utilities
 *
 * Resolves delta chains to reconstruct full object content.
 * Handles both streaming and buffered modes.
 */

import type { DeltaStore, RawStore } from "@webrun-vcs/core";
import { applyDelta } from "@webrun-vcs/utils";

/**
 * Resolve a delta chain and stream the result
 *
 * For non-delta objects, streams directly from raw storage.
 * For delta objects, resolves the chain and yields the reconstructed content.
 *
 * Note: Delta resolution requires loading base content into memory to apply
 * the delta instructions. The result is then yielded as a single chunk.
 * For very large objects, consider streaming from raw storage directly.
 *
 * @param objectId Object ID to resolve
 * @param raw Raw storage for base objects
 * @param delta Delta storage for delta relationships
 * @throws Error if object not found or delta chain is broken
 */
export async function* resolveDeltaChain(
  objectId: string,
  raw: RawStore,
  delta: DeltaStore,
): AsyncGenerator<Uint8Array> {
  // Check if it's a delta
  const storedDelta = await delta.loadDelta(objectId);

  if (!storedDelta) {
    // Not a delta - stream directly from raw storage
    if (!(await raw.has(objectId))) {
      throw new Error(`Object not found: ${objectId}`);
    }
    yield* raw.load(objectId);
    return;
  }

  // Resolve base content recursively
  const baseContent = await collectBytes(resolveDeltaChain(storedDelta.baseKey, raw, delta));

  // Apply delta to reconstruct content (applyDelta returns a generator)
  yield* applyDelta(baseContent, storedDelta.delta);
}

/**
 * Resolve delta chain and return as single Uint8Array
 *
 * Convenience function for cases where full content is needed.
 */
export async function resolveDeltaChainToBytes(
  objectId: string,
  raw: RawStore,
  delta: DeltaStore,
): Promise<Uint8Array> {
  return collectBytes(resolveDeltaChain(objectId, raw, delta));
}

/**
 * Check if an object exists (in raw or as delta target)
 */
export async function objectExists(
  objectId: string,
  raw: RawStore,
  delta: DeltaStore,
): Promise<boolean> {
  if (await raw.has(objectId)) {
    return true;
  }
  return delta.isDelta(objectId);
}

/**
 * Collect async iterable into single Uint8Array
 */
async function collectBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of stream) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  if (chunks.length === 0) {
    return new Uint8Array(0);
  }

  if (chunks.length === 1) {
    return chunks[0];
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
