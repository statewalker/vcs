import type { BlobStore } from "@statewalker/storage";
import { describe, expect, it } from "vitest";
import { createContentStore } from "../src/index.js";
import { backends, collect, insertAt, prng, sha256, streamOf } from "./helpers.js";

/** Wrap a BlobStore to count `put` invocations (dedup assertions). */
function countingChunks(inner: BlobStore): { store: BlobStore; puts: () => number } {
  let puts = 0;
  const store: BlobStore = {
    put: (id, bytes, opts) => {
      puts++;
      return inner.put(id, bytes, opts);
    },
    get: (id) => inner.get(id),
    has: (id) => inner.has(id),
    remove: (id) => inner.remove(id),
    list: (prefix) => inner.list(prefix),
  };
  return { store, puts: () => puts };
}

// Small CDC params so a few KB yields many chunks; threshold below chunk sizes.
const opts = { chunkThreshold: 64, cdc: { min: 64, avg: 256, max: 1024 } };

for (const backend of backends) {
  describe(`content-store over ${backend.name} storage`, () => {
    const hashContent = sha256;

    it("roundtrips content and slices arbitrary ranges across chunk boundaries", async () => {
      const { chunks, manifests } = backend.make();
      const store = createContentStore({ chunks, manifests, hashContent }, opts);
      const content = prng(8192, 1);

      const d = await store.put(streamOf(content));
      expect(d.size).toBe(content.length);
      expect(await collect(store.read(d.id))).toEqual(content);

      // A range that starts inside one chunk and ends inside a later one.
      const offset = 3000;
      const length = 2500;
      const slice = await collect(store.read(d.id, { offset, length }));
      expect(slice).toEqual(content.subarray(offset, offset + length));

      // A tail range with no explicit length runs to the end.
      const tail = await collect(store.read(d.id, { offset: 8000 }));
      expect(tail).toEqual(content.subarray(8000));

      // Absent object → empty stream.
      expect(await collect(store.read("sha256:nope"))).toEqual(new Uint8Array(0));
    });

    it("derives id from hashContent and stores each chunk once (dedup)", async () => {
      const { chunks: rawChunks, manifests } = backend.make();
      const { store: chunks, puts } = countingChunks(rawChunks);
      const store = createContentStore({ chunks, manifests, hashContent }, opts);
      const content = prng(8192, 2);

      const d1 = await store.put(streamOf(content));
      expect(d1.id).toBe(await hashContent(streamOf(content)));
      const putsAfterFirst = puts();
      expect(putsAfterFirst).toBe(d1.chunks.length); // every distinct chunk stored once

      // Identical content → identical id, and no new chunk stores.
      const d2 = await store.put(streamOf(content));
      expect(d2.id).toBe(d1.id);
      expect(puts()).toBe(putsAfterFirst); // second put deduped entirely
    });

    it("shares most chunks across a mid-file insert (CDC, not fixed-size)", async () => {
      const { chunks, manifests } = backend.make();
      const store = createContentStore({ chunks, manifests, hashContent }, opts);

      const a = prng(16384, 3);
      const b = insertAt(a, 8000, prng(200, 99)); // single-region insert mid-file

      const da = await store.put(streamOf(a));

      // Compute B's chunk ids without polluting the store.
      const tmp = backend.make();
      const bStore = createContentStore(
        { chunks: tmp.chunks, manifests: tmp.manifests, hashContent },
        opts,
      );
      const db = await bStore.put(streamOf(b));

      const missing = await store.hasChunks(db.chunks.map((c) => c.id));
      // Fixed-size chunking would re-chunk the whole tail → ~half missing.
      // CDC resyncs shortly after the insert → only a couple boundary chunks differ.
      expect(missing.length).toBeLessThanOrEqual(3);
      expect(db.chunks.length - missing.length).toBeGreaterThan(db.chunks.length / 2);
      // Sanity: A itself was chunked into many pieces (CDC engaged).
      expect(da.chunks.length).toBeGreaterThan(4);
    });

    it("stores sub-threshold content as a single direct blob", async () => {
      const { chunks, manifests } = backend.make();
      const store = createContentStore({ chunks, manifests, hashContent }, opts);

      const small = prng(40, 4); // < threshold (64)
      const ds = await store.put(streamOf(small));
      expect(ds.chunks.length).toBe(1);
      expect(ds.chunks[0].offset).toBe(0);
      expect(ds.chunks[0].size).toBe(small.length);
      expect(await collect(store.read(ds.id))).toEqual(small);

      const big = prng(8192, 5); // >= threshold → CDC
      const db = await store.put(streamOf(big));
      expect(db.chunks.length).toBeGreaterThan(1);
    });

    it("transfers missing chunks: hasChunks → putChunk → read reconstructs", async () => {
      const { chunks, manifests } = backend.make();
      const store = createContentStore({ chunks, manifests, hashContent }, opts);
      const content = prng(8192, 6);
      const d = await store.put(streamOf(content));

      // Simulate a target missing two interior chunks: save then delete them.
      const gone = [d.chunks[1].id, d.chunks[3].id];
      const saved = new Map<string, Uint8Array>();
      for (const id of gone) {
        saved.set(id, await collect(store.getChunk(id)));
        await chunks.remove(id);
      }

      const missing = await store.hasChunks(d.chunks.map((c) => c.id));
      expect(new Set(missing)).toEqual(new Set(gone)); // exactly the missing ids

      for (const id of missing) await store.putChunk(id, streamOf(saved.get(id)!));
      expect(await store.hasChunks(d.chunks.map((c) => c.id))).toEqual([]);
      expect(await collect(store.read(d.id))).toEqual(content);
      // getChunk roundtrips a known chunk.
      const first = d.chunks[0];
      expect((await collect(store.getChunk(first.id))).length).toBe(first.size);
    });

    it("tiles the manifest chunk refs contiguously over [0, size)", async () => {
      const { chunks, manifests } = backend.make();
      const store = createContentStore({ chunks, manifests, hashContent }, opts);
      const content = prng(12000, 7);
      const d = await store.put(streamOf(content));

      const m = await store.getManifest(d.id);
      expect(m).toBeDefined();
      let cursor = 0;
      for (const ref of m!.chunks) {
        expect(ref.offset).toBe(cursor); // contiguous, non-overlapping
        expect(ref.size).toBeGreaterThan(0);
        cursor += ref.size;
      }
      expect(cursor).toBe(m!.size); // covers the whole range
      expect(await store.getManifest("sha256:absent")).toBeUndefined();
    });

    it("gc keeps chunks reachable from live roots and sweeps the rest", async () => {
      const { chunks, manifests } = backend.make();
      const store = createContentStore({ chunks, manifests, hashContent }, opts);

      // A and B share a common prefix → shared prefix chunks.
      const common = prng(6000, 8);
      const a = new Uint8Array([...common, ...prng(4000, 81)]);
      const b = new Uint8Array([...common, ...prng(4000, 82)]);
      const da = await store.put(streamOf(a));
      const db = await store.put(streamOf(b));

      const aIds = new Set(da.chunks.map((c) => c.id));
      const bIds = new Set(db.chunks.map((c) => c.id));
      const shared = [...aIds].filter((id) => bIds.has(id));
      const bOnly = [...bIds].filter((id) => !aIds.has(id));
      expect(shared.length).toBeGreaterThan(0); // prefix actually shared
      expect(bOnly.length).toBeGreaterThan(0);

      const res = await store.gc([da.id]);
      expect(res.removedObjects).toBe(1); // B's entry swept
      expect(res.removedChunks).toBe(bOnly.length); // B-exclusive chunks swept

      // Live object intact; shared chunk survives; B gone.
      expect(await collect(store.read(da.id))).toEqual(a);
      expect(await store.hasChunks(shared)).toEqual([]); // shared survived
      expect(await store.hasChunks(bOnly)).toEqual(bOnly); // B-only gone
      expect(await store.getManifest(db.id)).toBeUndefined();

      // remove(A) then gc([]) reclaims A's now-exclusive chunks.
      expect(await store.remove(da.id)).toBe(true);
      const res2 = await store.gc([]);
      expect(res2.removedChunks).toBe(da.chunks.length);
      const leftover: string[] = [];
      for await (const id of chunks.list()) leftover.push(id);
      expect(leftover).toEqual([]);
    });
  });
}
