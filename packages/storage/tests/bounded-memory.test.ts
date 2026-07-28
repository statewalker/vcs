import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { type ByteStream, filesBlobStore } from "../src/index.js";

/**
 * `put` must stream: it hands the source stream to the backend and lets the
 * backend drive iteration, rather than draining (buffering) the whole payload
 * up front. We prove this by observing that, at the moment the backend's
 * `write` is invoked, the source has NOT yet been consumed.
 */
describe("BlobStore bounded memory (files, no verify)", () => {
  it("does not pre-buffer the payload before writing", async () => {
    const inner = new MemFilesApi();
    let chunksPulled = 0;
    let consumedBeforeWrite = -1;

    async function* source(): ByteStream {
      for (let i = 0; i < 100; i++) {
        chunksPulled++;
        yield new Uint8Array(1024).fill(i % 256);
      }
    }

    const spy: FilesApi = new Proxy(inner, {
      get(target, prop, receiver) {
        if (prop === "write") {
          return (path: string, content: AsyncIterable<Uint8Array>) => {
            consumedBeforeWrite = chunksPulled; // snapshot at write-time
            return target.write(path, content);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });

    const store = filesBlobStore(spy);
    await store.put("big", source());

    // If put had concatenated the stream first, chunksPulled would already be
    // 100 when write was called. Streaming pass-through means 0.
    expect(consumedBeforeWrite).toBe(0);
    expect(chunksPulled).toBe(100); // the backend still drained it fully
  });
});
