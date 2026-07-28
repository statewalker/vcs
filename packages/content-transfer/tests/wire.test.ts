import { describe, expect, it } from "vitest";
import { remoteStore, serveStore, transfer } from "../src/index.js";
import { collect, collectEvents, memContentStore, prng, sha256, streamOf } from "./helpers.js";

describe("client/server symmetry", () => {
  it("proxies hasChunks / getChunk / putChunk / getManifest / capabilities over a loopback Duplex", async () => {
    const mem = memContentStore();
    const { id } = await mem.put(streamOf(prng(60000, 10)));
    const manifest = await mem.getManifest(id);
    if (!manifest) throw new Error("no manifest");

    // The server handler IS the client's Duplex — no transport needed.
    const proxy = remoteStore(serveStore(mem));

    // capabilities
    expect((await proxy.capabilities()).protocol).toBe("content-transfer/1");

    // getManifest
    expect(await proxy.getManifest(id)).toEqual(manifest);
    expect(await proxy.getManifest("sha256:absent")).toBeUndefined();

    // hasChunks — one present id + one absent id → only the absent is missing
    const present = manifest.chunks[0].id;
    expect(await proxy.hasChunks([present, "sha256:absent"])).toEqual(["sha256:absent"]);

    // getChunk roundtrips the underlying bytes
    expect(await collect(proxy.getChunk(present))).toEqual(await collect(mem.getChunk(present)));

    // putChunk lands in the underlying store
    const newBytes = prng(1234, 11);
    const newId = await sha256(streamOf(newBytes));
    await proxy.putChunk(newId, streamOf(newBytes));
    expect(await collect(mem.getChunk(newId))).toEqual(newBytes);
  });

  it("transfers to a remote destination store over the wire", async () => {
    const content = prng(60000, 12);
    const from = memContentStore();
    const { id } = await from.put(streamOf(content));

    const remoteMem = memContentStore();
    const to = remoteStore(serveStore(remoteMem));

    await collectEvents(transfer([id], from, to, { hashContent: sha256 }));

    // The underlying remote store now reconstructs the identical object.
    expect(await collect(remoteMem.read(id))).toEqual(content);
  });
});
