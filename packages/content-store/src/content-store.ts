import { chunkContent } from "./chunker.js";
import { parseManifest, serializeManifest } from "./manifest.js";
import type {
  ByteStream,
  ChunkId,
  ChunkRef,
  ContentStore,
  ContentStoreDeps,
  ContentStoreOptions,
  ObjectDescriptor,
  ObjectId,
} from "./types.js";

const DEFAULT_THRESHOLD = 4096;
const DEFAULT_CDC = { min: 2048, avg: 8192, max: 32768 };

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

export function createContentStore(
  deps: ContentStoreDeps,
  opts?: ContentStoreOptions,
): ContentStore {
  const { chunks, manifests, hashContent } = deps;
  const threshold = opts?.chunkThreshold ?? DEFAULT_THRESHOLD;
  const cdc = opts?.cdc ?? DEFAULT_CDC;

  async function getManifest(id: ObjectId): Promise<ObjectDescriptor | undefined> {
    if (!(await manifests.has(id))) return undefined;
    return parseManifest(await collect(manifests.get(id)));
  }

  /** Re-stream stored chunks in order — feeds the whole-object hash without buffering. */
  async function* restream(refs: ChunkRef[]): ByteStream {
    for (const ref of refs) yield* chunks.get(ref.id);
  }

  const store: ContentStore = {
    async put(content) {
      const refs: ChunkRef[] = [];
      let offset = 0;
      for await (const bytes of chunkContent(content, cdc, threshold)) {
        const id = await hashContent(one(bytes));
        if (!(await chunks.has(id))) await chunks.put(id, one(bytes));
        refs.push({ id, offset, size: bytes.length });
        offset += bytes.length;
      }
      const objectId = await hashContent(restream(refs));
      const descriptor: ObjectDescriptor = { id: objectId, size: offset, chunks: refs };
      await manifests.put(objectId, one(serializeManifest(descriptor)));
      return descriptor;
    },

    has(id) {
      return manifests.has(id);
    },

    read(id, range) {
      return (async function* (): ByteStream {
        const descriptor = await getManifest(id);
        if (!descriptor) return;
        const start = range?.offset ?? 0;
        const end = range?.length === undefined ? descriptor.size : start + range.length;
        for (const ref of descriptor.chunks) {
          if (ref.offset + ref.size <= start) continue; // entirely before the range
          if (ref.offset >= end) break; // chunks are ordered — nothing left overlaps
          let pos = ref.offset;
          for await (const piece of chunks.get(ref.id)) {
            const pieceStart = pos;
            pos += piece.length;
            const from = Math.max(start, pieceStart);
            const to = Math.min(end, pos);
            if (from < to) yield piece.subarray(from - pieceStart, to - pieceStart);
          }
        }
      })();
    },

    getManifest,

    remove(id) {
      return manifests.remove(id);
    },

    async hasChunks(ids) {
      const missing: ChunkId[] = [];
      for (const id of ids) {
        if (!(await chunks.has(id))) missing.push(id);
      }
      return missing;
    },

    async putChunk(id, bytes) {
      await chunks.put(id, bytes);
    },

    getChunk(id) {
      return chunks.get(id);
    },

    async gc(liveRoots) {
      const live = new Set(liveRoots);
      const liveChunks = new Set<ChunkId>();
      for (const root of liveRoots) {
        const d = await getManifest(root);
        if (d) for (const ref of d.chunks) liveChunks.add(ref.id);
      }
      let removedObjects = 0;
      let removedChunks = 0;
      for await (const objId of manifests.list()) {
        if (!live.has(objId) && (await manifests.remove(objId))) removedObjects++;
      }
      for await (const chunkId of chunks.list()) {
        if (!liveChunks.has(chunkId) && (await chunks.remove(chunkId))) removedChunks++;
      }
      return { removedObjects, removedChunks };
    },
  };

  return store;
}
