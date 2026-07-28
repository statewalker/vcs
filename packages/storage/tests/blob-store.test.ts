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

    it("get(range): full read with no range is unchanged", async () => {
      const store = make();
      await store.put("a1", streamOf("0123456789"));
      expect(await collectText(store.get("a1"))).toBe("0123456789");
    });

    it("get(range): start+end returns the [start,end) slice (end exclusive)", async () => {
      const store = make();
      await store.put("a1", streamOf("0123456789"));
      expect(await collectText(store.get("a1", { start: 2, end: 5 }))).toBe("234");
    });

    it("get(range): start-only reads from start to end of content", async () => {
      const store = make();
      await store.put("a1", streamOf("0123456789"));
      expect(await collectText(store.get("a1", { start: 7 }))).toBe("789");
    });

    it("get(range): end-only reads from 0 to end (exclusive)", async () => {
      const store = make();
      await store.put("a1", streamOf("0123456789"));
      expect(await collectText(store.get("a1", { end: 4 }))).toBe("0123");
    });

    it("get(range): slice spanning multiple stored chunks", async () => {
      const store = make();
      await store.put("a1", streamOf("012", "345", "678", "9"));
      expect(await collectText(store.get("a1", { start: 2, end: 8 }))).toBe("234567");
    });

    it("size: returns the stored byte length", async () => {
      const store = make();
      await store.put("a1", streamOf("hello ", "world"));
      expect(await store.size("a1")).toBe(11);
    });

    it("size: returns -1 for an absent id", async () => {
      const store = make();
      expect(await store.size("missing")).toBe(-1);
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
