import type { BlobStore, ByteStream } from "@statewalker/storage";
import { memBlobStore } from "@statewalker/storage";
import { describe, expect, it } from "vitest";
import { createContentStore } from "../src/index.js";
import { sha256 } from "./helpers.js";

/**
 * `put` must be bounded-memory: it stores chunks as they emerge from the stream
 * (never draining the whole payload first), and computes the whole-object hash
 * by RE-STREAMING the stored chunks — not by holding all bytes. We prove both by
 * observing the chunk store and the source cursor.
 */
describe("content-store bounded memory", () => {
  it("stores chunks mid-stream and re-streams them for the object hash", async () => {
    const inner = memBlobStore();
    let firstPutAtPulled = -1;
    let getCalled = false;

    const chunks: BlobStore = {
      put: (id, bytes, o) => {
        if (firstPutAtPulled === -1) firstPutAtPulled = pulled; // snapshot at first store
        return inner.put(id, bytes, o);
      },
      get: (id) => {
        getCalled = true; // the re-stream pass reads chunks back out
        return inner.get(id);
      },
      has: (id) => inner.has(id),
      remove: (id) => inner.remove(id),
      list: (prefix) => inner.list(prefix),
    };

    const total = 64 * 128; // 8 KiB across 64 small arrays
    let pulled = 0;
    async function* source(): ByteStream {
      for (let i = 0; i < 64; i++) {
        const a = new Uint8Array(128);
        for (let j = 0; j < 128; j++) a[j] = (i * 131 + j * 17) & 0xff;
        pulled += a.length;
        yield a;
      }
    }

    const store = createContentStore(
      { chunks, manifests: memBlobStore(), hashContent: sha256 },
      { chunkThreshold: 64, cdc: { min: 64, avg: 256, max: 1024 } },
    );
    await store.put(source());

    // Had put buffered the whole content first, the first chunk store would only
    // happen after all 8 KiB were pulled. Streaming → it happens much earlier.
    expect(firstPutAtPulled).toBeGreaterThan(0);
    expect(firstPutAtPulled).toBeLessThan(total);
    // The whole-object hash was computed by re-streaming stored chunks.
    expect(getCalled).toBe(true);
    // And the source was still fully consumed.
    expect(pulled).toBe(total);
  });
});
