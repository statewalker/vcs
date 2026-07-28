import type { ContentStore } from "@statewalker/content-store";
import { describe, expect, it } from "vitest";
import type { TransferCheckpoint } from "../src/index.js";
import { transfer } from "../src/index.js";
import {
  collect,
  collectEvents,
  memContentStore,
  prng,
  sha256,
  spyStore,
  streamOf,
} from "./helpers.js";

/** Ingest `bytes` into a fresh source store; return the store + object id. */
async function sourceWith(bytes: Uint8Array): Promise<{ from: ContentStore; id: string }> {
  const from = memContentStore();
  const { id } = await from.put(streamOf(bytes));
  return { from, id };
}

describe("transfer roundtrip + dedup", () => {
  it("reconstructs an identical object at the destination", async () => {
    const content = prng(60000, 1);
    const { from, id } = await sourceWith(content);
    const to = memContentStore();

    const events = await collectEvents(transfer([id], from, to, { hashContent: sha256 }));

    expect(events.at(-1)).toEqual({ type: "object-done", objectId: id });
    expect(await collect(to.read(id))).toEqual(content);
  });

  it("sends only the chunks the destination is missing", async () => {
    const content = prng(60000, 2);
    const { from, id } = await sourceWith(content);
    const manifest = await from.getManifest(id);
    if (!manifest) throw new Error("no manifest");
    expect(manifest.chunks.length).toBeGreaterThan(1); // dedup is meaningful

    // Pre-seed the destination with the object's FIRST chunk.
    const to = memContentStore();
    const seeded = manifest.chunks[0].id;
    await to.putChunk(seeded, from.getChunk(seeded));

    const { store: spiedTo, spy } = spyStore(to);
    await collectEvents(transfer([id], from, spiedTo, { hashContent: sha256 }));

    expect(spy.putChunkIds).not.toContain(seeded);
    expect(spy.putChunkIds).toHaveLength(manifest.chunks.length - 1);
    expect(await collect(to.read(id))).toEqual(content);
  });
});

describe("batched negotiation", () => {
  it("negotiates ids in bounded batches, not one request per id", async () => {
    const from = memContentStore();
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) {
      const { id } = await from.put(streamOf(prng(500, 100 + i))); // < threshold → 1 chunk each
      ids.push(id);
    }

    const { store: spiedTo, spy } = spyStore(memContentStore());
    await collectEvents(
      transfer(ids, from, spiedTo, { limits: { batchSize: 3 }, hashContent: sha256 }),
    );

    expect(spy.hasChunksCalls).toBe(Math.ceil(7 / 3)); // 3, not 7
    expect(spy.hasChunksCalls).toBeLessThan(7);
  });
});

describe("resume", () => {
  it("resumes from a checkpoint without re-sending done chunks", async () => {
    const content = prng(60000, 3);
    const { from, id } = await sourceWith(content);
    const to = memContentStore();

    // Run 1: stop after the first chunk is delivered.
    const done: string[] = [];
    const run1 = transfer([id], from, to, { limits: { concurrency: 1 }, hashContent: sha256 });
    for await (const e of run1) {
      if (e.type === "chunk-sent") {
        done.push(e.chunkId);
        break;
      }
    }
    expect(done).toHaveLength(1);

    // Run 2: resume — the delivered chunk must not be re-sent, the object completes.
    const checkpoint: TransferCheckpoint = { objectIds: [id], done, pending: [] };
    const { store: spiedTo, spy } = spyStore(to);
    const events = await collectEvents(
      transfer([id], from, spiedTo, {
        checkpoint,
        limits: { concurrency: 1 },
        hashContent: sha256,
      }),
    );

    expect(events[0]).toEqual({ type: "resumed", done: 1 });
    expect(spy.putChunkIds).not.toContain(done[0]);
    expect(events).toContainEqual({ type: "object-done", objectId: id });
    expect(await collect(to.read(id))).toEqual(content);
  });

  it("fails loudly when the source no longer holds a resumed object", async () => {
    const content = prng(20000, 4);
    const { from, id } = await sourceWith(content);
    const to = memContentStore();
    await from.remove(id); // source no longer verifies

    const checkpoint: TransferCheckpoint = { objectIds: [id], done: [], pending: [] };
    await expect(collectEvents(transfer([id], from, to, { checkpoint }))).rejects.toThrow(
      /missing object/,
    );
  });
});

describe("integrity", () => {
  it("rejects a corrupted chunk and never assembles the object", async () => {
    const content = prng(60000, 5);
    const { from, id } = await sourceWith(content);
    const manifest = await from.getManifest(id);
    if (!manifest) throw new Error("no manifest");

    const target = manifest.chunks[0].id;
    const corrupt = await collect(from.getChunk(target));
    corrupt[0] ^= 0xff; // flip a byte → re-hash will not match the id

    const badFrom: ContentStore = {
      ...from,
      getChunk: (cid) => (cid === target ? streamOf(corrupt) : from.getChunk(cid)),
    };

    const to = memContentStore();
    await expect(
      collectEvents(transfer([id], badFrom, to, { hashContent: sha256 })),
    ).rejects.toThrow(/integrity check failed/);
    expect(await to.getManifest(id)).toBeUndefined();
  });
});

describe("backpressure", () => {
  async function sourceOfSingleChunkObjects(count: number, size: number, seed: number) {
    const from = memContentStore();
    const ids: string[] = [];
    for (let i = 0; i < count; i++) {
      const { id } = await from.put(streamOf(prng(size, seed + i)));
      ids.push(id);
    }
    return { from, ids };
  }

  it("never buffers more than maxBufferedBytes of chunks", async () => {
    const { from, ids } = await sourceOfSingleChunkObjects(6, 1000, 200);
    const { store: spiedFrom, spy } = spyStore(from);
    const to = memContentStore();

    // Budget 2500 with 1000-byte chunks → at most 2 in flight regardless of concurrency.
    await collectEvents(
      transfer(ids, spiedFrom, to, { limits: { concurrency: 8, maxBufferedBytes: 2500 } }),
    );

    expect(spy.peakGetChunkConcurrency).toBeLessThanOrEqual(2);
    for (const id of ids) expect((await collect(to.read(id))).length).toBe(1000);
  });

  it("caps concurrency", async () => {
    const { from, ids } = await sourceOfSingleChunkObjects(6, 1000, 300);
    const { store: spiedFrom, spy } = spyStore(from);
    const to = memContentStore();

    await collectEvents(
      transfer(ids, spiedFrom, to, { limits: { concurrency: 2, maxBufferedBytes: 1 << 20 } }),
    );

    expect(spy.peakGetChunkConcurrency).toBeLessThanOrEqual(2);
  });
});
