import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { describe, expect, it } from "vitest";
import { type BlobStore, filesBlobStore, memBlobStore } from "../src/index.js";
import { bytes, collect, collectText, sha256, streamOf } from "./helpers.js";

/**
 * One suite, run against every BlobStore adapter. The seam is backend-agnostic,
 * so the same behaviour must hold over `mem` and over `files` (MemFilesApi).
 */
function runBlobStoreSuite(name: string, make: () => BlobStore): void {
  describe(`BlobStore: ${name}`, () => {
    it("put/get roundtrip", async () => {
      const store = make();
      await store.put("a1", streamOf("hello ", "world"));
      expect(await collectText(store.get("a1"))).toBe("hello world");
    });

    it("has reflects presence", async () => {
      const store = make();
      expect(await store.has("a1")).toBe(false);
      await store.put("a1", streamOf("x"));
      expect(await store.has("a1")).toBe(true);
    });

    it("remove deletes and reports whether anything was removed", async () => {
      const store = make();
      await store.put("a1", streamOf("x"));
      expect(await store.remove("a1")).toBe(true);
      expect(await store.has("a1")).toBe(false);
      expect(await store.remove("a1")).toBe(false);
    });

    it("re-put of the same id is idempotent (no error, content preserved)", async () => {
      const store = make();
      await store.put("a1", streamOf("payload"));
      await store.put("a1", streamOf("payload"));
      expect(await collectText(store.get("a1"))).toBe("payload");
    });

    it("get of an absent id yields an empty stream, not an error", async () => {
      const store = make();
      const out = await collect(store.get("missing"));
      expect(out.length).toBe(0);
    });

    it("list(prefix) returns only matching ids", async () => {
      const store = make();
      await store.put("aa11", streamOf("1"));
      await store.put("aa22", streamOf("2"));
      await store.put("bb33", streamOf("3"));
      const all = new Set<string>();
      for await (const id of store.list()) all.add(id);
      expect(all).toEqual(new Set(["aa11", "aa22", "bb33"]));
      const aa = new Set<string>();
      for await (const id of store.list("aa")) aa.add(id);
      expect(aa).toEqual(new Set(["aa11", "aa22"]));
    });

    it("integrity: verify accepts a matching id", async () => {
      const store = make();
      const id = await sha256(streamOf("content"));
      await store.put(id, streamOf("content"), { verify: sha256 });
      expect(await collectText(store.get(id))).toBe("content");
    });

    it("integrity: verify rejects a mismatching id and stores nothing", async () => {
      const store = make();
      await expect(
        store.put("not-the-hash", streamOf("content"), { verify: sha256 }),
      ).rejects.toThrow();
      expect(await store.has("not-the-hash")).toBe(false);
    });
  });
}

runBlobStoreSuite("mem", () => memBlobStore());
runBlobStoreSuite("files", () => filesBlobStore(new MemFilesApi()));

describe("filesBlobStore sharding", () => {
  it("stores under a git-style ab/cdef… path to avoid huge directories", async () => {
    const files = new MemFilesApi();
    const store = filesBlobStore(files, { root: "/objects" });
    await store.put("abcdef123", streamOf("z"));
    expect(await files.exists("/objects/ab/cdef123")).toBe(true);
    expect(await collect(store.get("abcdef123"))).toEqual(bytes("z"));
  });
});
