import { describe, expect, it } from "vitest";
import { merge } from "../src/index.js";
import { op, sha256, tree } from "./helpers.js";

describe("rename detection", () => {
  it("detects an exact (move-only) rename as a single rename op, not delete+add", async () => {
    const base = tree({ "/old.txt": "same content\n" });
    const left = tree({ "/new.txt": "same content\n" }); // moved
    const right = tree({ "/old.txt": "same content\n" }); // unchanged

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(conflicts).toEqual([]);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ op: "rename", from: "/old.txt", path: "/new.txt" });
  });

  it("consults renameStrategy for non-exact leftovers", async () => {
    const base = tree({ "/old.txt": "hello world\n" });
    const left = tree({ "/renamed.txt": "hello world changed\n" }); // moved + edited
    const right = tree({ "/old.txt": "hello world\n" });

    const { operations, conflicts } = await merge(base, left, right, {
      hashContent: sha256,
      renameStrategy: ({ deleted, added }) =>
        deleted.length === 1 && added.length === 1
          ? [{ from: deleted[0].path, to: added[0].path }]
          : [],
    });
    expect(conflicts).toEqual([]);
    expect(operations).toEqual([
      { op: "rename", from: "/old.txt", path: "/renamed.txt", kind: "file" },
    ]);
  });
});

describe("conflict taxonomy", () => {
  it("rename-rename: both sides move the same file to different targets", async () => {
    const base = tree({ "/f.txt": "content\n" });
    const left = tree({ "/left.txt": "content\n" });
    const right = tree({ "/right.txt": "content\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "rename-rename", path: "/f.txt" });
    expect(conflicts[0].paths?.sort()).toEqual(["/left.txt", "/right.txt"]);
  });

  it("rename-modify: one side moves, the other edits in place", async () => {
    const base = tree({ "/f.txt": "content\n" });
    const left = tree({ "/moved.txt": "content\n" }); // rename
    const right = tree({ "/f.txt": "content edited\n" }); // modify

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "rename-modify", path: "/f.txt", paths: ["/moved.txt"] });
  });

  it("modify-delete: one side edits, the other deletes", async () => {
    const base = tree({ "/f.txt": "content\n" });
    const left = tree({ "/f.txt": "content edited\n" });
    const right = tree({});

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "modify-delete", path: "/f.txt" });
  });

  it("add-add: both sides add the same path with different content", async () => {
    const base = tree({});
    const left = tree({ "/n.txt": "from left\n" });
    const right = tree({ "/n.txt": "from right\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "add-add", path: "/n.txt" });
  });

  it("add-add collapses when both sides add identical content", async () => {
    const base = tree({});
    const left = tree({ "/n.txt": "same\n" });
    const right = tree({ "/n.txt": "same\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(conflicts).toEqual([]);
    expect(operations).toEqual([{ op: "add", path: "/n.txt", kind: "file", source: { side: "left", path: "/n.txt" } }]);
  });

  it("type-change: a path is a file on one side and a directory on the other", async () => {
    const base = tree({ "/x": "i am a file\n" });
    const left = tree({ "/x/inner.txt": "now a directory\n" }); // /x becomes a directory
    const right = tree({ "/x": "i am a file\n" }); // unchanged

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(op(operations, "/x")).toBeUndefined();
    expect(conflicts.some((c) => c.kind === "type-change" && c.path === "/x")).toBe(true);
  });
});
