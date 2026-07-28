import type { SyncAction, Transfer } from "@statewalker/files-sync";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { chunkTransfer } from "../src/index.js";
import { collect, memContentStore, prng, spyStore, streamOf } from "./helpers.js";

describe("files-sync adapter", () => {
  it("moves a file's bytes via content-store dedup and dedups a shared file", async () => {
    const content = prng(60000, 20);
    const fromFiles = new MemFilesApi();
    const toFiles = new MemFilesApi();
    await fromFiles.write("/a.bin", streamOf(content));

    const local = memContentStore();
    const { store: remote, spy } = spyStore(memContentStore());

    // Structurally a files-sync Transfer.
    const t: Transfer = chunkTransfer(local, remote);

    const copyA: SyncAction = { kind: "copy", path: "/a.bin", from: "a" };
    await t.run(copyA, fromFiles, toFiles);

    expect(await collect(toFiles.read("/a.bin"))).toEqual(content);
    const afterA = spy.putChunkIds.length;
    expect(afterA).toBeGreaterThan(1);

    // A second file with identical content transfers zero new chunks (full dedup).
    await fromFiles.write("/b.bin", streamOf(content));
    await t.run({ kind: "copy", path: "/b.bin", from: "a" }, fromFiles, toFiles);

    expect(spy.putChunkIds.length).toBe(afterA);
    expect(await collect(toFiles.read("/b.bin"))).toEqual(content);
  });
});
