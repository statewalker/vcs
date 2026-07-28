/**
 * The transfer pipeline: negotiate → queue → bounded workers → verify → assemble.
 *
 * For the whole set of object ids it (1) fetches each manifest from the source,
 * (2) negotiates the missing chunks against the destination in bounded batches,
 * (3) streams each missing chunk through a concurrency- and byte-bounded pool,
 * re-hashing it before it is written, and (4) registers each object's manifest
 * at the destination once all its chunks are present.
 */

import type { ChunkRef, ContentStore, ObjectDescriptor } from "@statewalker/content-store";
import type {
  AssemblingStore,
  ByteStream,
  Capabilities,
  TransferEvent,
  TransferLimits,
  TransferOptions,
} from "./types.js";

const DEFAULT_LIMITS: Required<TransferLimits> = {
  concurrency: 4,
  maxBufferedBytes: 8 * 1024 * 1024,
  batchSize: 256,
};

/** A fresh single-shot stream over one buffer (streams are consumed once). */
async function* one(bytes: Uint8Array): ByteStream {
  yield bytes;
}

async function collect(stream: ByteStream): Promise<Uint8Array> {
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

/** Re-stream a store's own chunks in manifest order — feeds `put` without buffering. */
async function* reassembleFromStore(store: ContentStore, manifest: ObjectDescriptor): ByteStream {
  for (const ref of manifest.chunks) yield* store.getChunk(ref.id);
}

/**
 * Register `manifest` at `to`, so `to.read(id)` reconstructs the object. When
 * `to` is a wire proxy it assembles server-side from chunks it already holds
 * (only the manifest crosses the wire); otherwise it re-`put`s a local
 * reassembly (cheap, same-process) and verifies the resulting id.
 */
export async function registerManifest(
  to: ContentStore,
  manifest: ObjectDescriptor,
): Promise<void> {
  const proxy = to as Partial<AssemblingStore>;
  if (typeof proxy.putManifest === "function") {
    await proxy.putManifest(manifest);
    return;
  }
  const descriptor = await to.put(reassembleFromStore(to, manifest));
  if (descriptor.id !== manifest.id) {
    throw new Error(`content-transfer: assemble id mismatch ${descriptor.id} != ${manifest.id}`);
  }
}

async function maybeCapabilities(to: ContentStore): Promise<Capabilities | undefined> {
  const proxy = to as Partial<AssemblingStore>;
  if (typeof proxy.capabilities === "function") return proxy.capabilities();
  return undefined;
}

/**
 * Run `work` over `refs` with at most `concurrency` in flight and never more
 * than `maxBufferedBytes` of chunk bytes buffered (a single over-budget chunk is
 * allowed alone, to guarantee progress). Yields each result as it settles.
 */
async function* pipeline<R>(
  refs: ChunkRef[],
  limits: Required<TransferLimits>,
  work: (ref: ChunkRef) => Promise<R>,
): AsyncGenerator<R> {
  interface Entry {
    ref: ChunkRef;
    value: R;
    promise: Promise<Entry>;
  }
  const inflight = new Set<Promise<Entry>>();
  let buffered = 0;
  let idx = 0;

  const canLaunch = (): boolean =>
    idx < refs.length &&
    inflight.size < limits.concurrency &&
    (inflight.size === 0 || buffered + refs[idx].size <= limits.maxBufferedBytes);

  while (idx < refs.length || inflight.size > 0) {
    while (canLaunch()) {
      const ref = refs[idx++];
      buffered += ref.size;
      const entry = { ref } as Entry;
      entry.promise = work(ref).then((value) => {
        entry.value = value;
        return entry;
      });
      inflight.add(entry.promise);
    }
    const settled = await Promise.race(inflight);
    inflight.delete(settled.promise);
    buffered -= settled.ref.size;
    yield settled.value;
  }
}

export async function* transfer(
  objectIds: string[],
  from: ContentStore,
  to: ContentStore,
  opts?: TransferOptions,
): AsyncGenerator<TransferEvent> {
  const limits: Required<TransferLimits> = { ...DEFAULT_LIMITS, ...opts?.limits };
  const hashContent = opts?.hashContent;

  const caps = await maybeCapabilities(to);

  if (opts?.checkpoint) {
    yield { type: "resumed", done: opts.checkpoint.done.length };
  }

  // 1. Gather manifests + the union of their chunk refs. This also re-verifies
  //    the source still holds every requested object (a resume precondition).
  const manifests = new Map<string, ObjectDescriptor>();
  const refById = new Map<string, ChunkRef>();
  for (const id of objectIds) {
    const manifest = await from.getManifest(id);
    if (!manifest) throw new Error(`content-transfer: source is missing object ${id}`);
    manifests.set(id, manifest);
    for (const ref of manifest.chunks) if (!refById.has(ref.id)) refById.set(ref.id, ref);
  }

  // 2. Batched negotiation: many ids per request, not one request per id.
  const allIds = [...refById.keys()];
  const missing: ChunkRef[] = [];
  for (let i = 0; i < allIds.length; i += limits.batchSize) {
    const batch = allIds.slice(i, i + limits.batchSize);
    for (const cid of await to.hasChunks(batch)) {
      const ref = refById.get(cid);
      if (ref) missing.push(ref);
    }
  }
  yield {
    type: "negotiated",
    objects: objectIds.length,
    chunks: allIds.length,
    missing: missing.length,
    protocol: caps?.protocol,
  };

  // 3. Bounded pipeline: fetch from source, re-hash, write to destination.
  for await (const sent of pipeline(missing, limits, async (ref) => {
    const bytes = await collect(from.getChunk(ref.id));
    if (hashContent) {
      const actual = await hashContent(one(bytes));
      if (actual !== ref.id) {
        throw new Error(
          `content-transfer: integrity check failed for chunk ${ref.id} (re-hash ${actual})`,
        );
      }
    }
    await to.putChunk(ref.id, one(bytes));
    return { id: ref.id, size: bytes.length };
  })) {
    yield { type: "chunk-sent", chunkId: sent.id, size: sent.size };
  }

  // 4. Assemble: every object's chunks are present — register its manifest.
  for (const id of objectIds) {
    const manifest = manifests.get(id);
    if (!manifest) continue;
    await registerManifest(to, manifest);
    yield { type: "object-done", objectId: id };
  }
}
