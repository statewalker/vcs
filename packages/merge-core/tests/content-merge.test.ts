import { describe, expect, it } from "vitest";
import { merge } from "../src/index.js";
import { op, sha256, tree } from "./helpers.js";

const dec = new TextDecoder();

describe("content merge", () => {
  it("merges disjoint-line edits into a single merged op", async () => {
    const base = tree({ "/f.txt": "one\ntwo\nthree\n" });
    const left = tree({ "/f.txt": "ONE\ntwo\nthree\n" });
    const right = tree({ "/f.txt": "one\ntwo\nTHREE\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(conflicts).toEqual([]);
    const m = op(operations, "/f.txt");
    expect(m).toMatchObject({ op: "modify", kind: "file" });
    expect(m?.content).toBeInstanceOf(Uint8Array);
    expect(dec.decode(m?.content)).toBe("ONE\ntwo\nTHREE\n");
  });

  it("reports a content conflict for overlapping same-line edits", async () => {
    const base = tree({ "/f.txt": "one\ntwo\nthree\n" });
    const left = tree({ "/f.txt": "one\nLEFT\nthree\n" });
    const right = tree({ "/f.txt": "one\nRIGHT\nthree\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "content", path: "/f.txt" });
  });

  it("never line-merges binary files; divergent bytes => content conflict", async () => {
    const base = tree({ "/b.bin": new Uint8Array([1, 0, 2]) });
    const left = tree({ "/b.bin": new Uint8Array([1, 0, 3]) });
    const right = tree({ "/b.bin": new Uint8Array([1, 0, 4]) });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toEqual([{ kind: "content", path: "/b.bin", base: expect.anything(), left: expect.anything(), right: expect.anything() }]);
  });

  it("treats files above textMergeMaxBytes as hash-compare only", async () => {
    const base = tree({ "/big.txt": "aaaa\nbbbb\n" });
    const left = tree({ "/big.txt": "AAAA\nbbbb\n" });
    const right = tree({ "/big.txt": "aaaa\nBBBB\n" });

    const { operations, conflicts } = await merge(base, left, right, {
      hashContent: sha256,
      textMergeMaxBytes: 4,
    });
    // Disjoint edits that WOULD merge below threshold are a conflict above it.
    expect(operations).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "content", path: "/big.txt" });
  });

  it("identical bytes on both sides (same hash) => no op", async () => {
    const base = tree({ "/b.bin": new Uint8Array([1, 0, 2]) });
    const same = new Uint8Array([9, 0, 9]);
    const left = tree({ "/b.bin": same });
    const right = tree({ "/b.bin": same });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(conflicts).toEqual([]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: "modify", path: "/b.bin" });
  });
});
