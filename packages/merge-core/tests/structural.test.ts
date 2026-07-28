import { describe, expect, it } from "vitest";
import { merge } from "../src/index.js";
import { fingerprint, op, sha256, tree } from "./helpers.js";

describe("structural three-way merge", () => {
  it("classifies add / modify / delete per side with zero conflicts (clean 3-way)", async () => {
    const base = tree({ "/a.txt": "a\n", "/b.txt": "b\n", "/c.txt": "c\n" });
    // left modifies a, deletes c, adds d
    const left = tree({ "/a.txt": "a2\n", "/b.txt": "b\n", "/d.txt": "d\n" });
    // right modifies b, deletes c, adds e
    const right = tree({ "/a.txt": "a\n", "/b.txt": "b2\n", "/e.txt": "e\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });

    expect(conflicts).toEqual([]);

    expect(op(operations, "/a.txt")).toMatchObject({ op: "modify", source: { side: "left" } });
    expect(op(operations, "/b.txt")).toMatchObject({ op: "modify", source: { side: "right" } });
    expect(op(operations, "/c.txt")).toMatchObject({ op: "delete" });
    expect(op(operations, "/d.txt")).toMatchObject({ op: "add", source: { side: "left" } });
    expect(op(operations, "/e.txt")).toMatchObject({ op: "add", source: { side: "right" } });
    // b.txt unchanged by left -> only right's modify lands
    expect(operations.filter((o) => o.path === "/b.txt")).toHaveLength(1);
  });

  it("collapses identical changes on both sides to a single op, no conflict", async () => {
    const base = tree({ "/x.txt": "x\n" });
    const left = tree({ "/x.txt": "y\n" });
    const right = tree({ "/x.txt": "y\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(conflicts).toEqual([]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: "modify", path: "/x.txt" });
  });

  it("produces no operations when nothing changed", async () => {
    const base = tree({ "/a.txt": "a\n" });
    const left = tree({ "/a.txt": "a\n" });
    const right = tree({ "/a.txt": "a\n" });
    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toEqual([]);
  });

  it("does not write to any input (purity)", async () => {
    const base = tree({ "/a.txt": "a\n", "/b.txt": "b\n" });
    const left = tree({ "/a.txt": "a2\n", "/b.txt": "b\n" });
    const right = tree({ "/a.txt": "a\n", "/c.txt": "c\n" });

    const before = await Promise.all([fingerprint(base), fingerprint(left), fingerprint(right)]);
    await merge(base, left, right, { hashContent: sha256 });
    const after = await Promise.all([fingerprint(base), fingerprint(left), fingerprint(right)]);

    expect(after).toEqual(before);
  });

  it("is deterministic across repeated runs", async () => {
    const mk = () => ({
      base: tree({ "/a.txt": "a\n", "/b.txt": "b\n", "/c.txt": "c\n" }),
      left: tree({ "/a.txt": "a2\n", "/z.txt": "z\n" }),
      right: tree({ "/b.txt": "b2\n", "/y.txt": "y\n" }),
    });
    const r1 = await (async () => {
      const t = mk();
      return merge(t.base, t.left, t.right, { hashContent: sha256 });
    })();
    const r2 = await (async () => {
      const t = mk();
      return merge(t.base, t.left, t.right, { hashContent: sha256 });
    })();
    expect(JSON.stringify(r2)).toEqual(JSON.stringify(r1));
  });
});
