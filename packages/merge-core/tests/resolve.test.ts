import { describe, expect, it } from "vitest";
import { merge } from "../src/index.js";
import { op, sha256, tree } from "./helpers.js";

describe("injected resolve", () => {
  it("folds a chosen resolution into operations; unresolved conflicts remain", async () => {
    const base = tree({ "/a.txt": "a\n", "/b.txt": "b\n" });
    // Both files become same-line conflicts.
    const left = tree({ "/a.txt": "LEFT-A\n", "/b.txt": "LEFT-B\n" });
    const right = tree({ "/a.txt": "RIGHT-A\n", "/b.txt": "RIGHT-B\n" });

    const { operations, conflicts } = await merge(base, left, right, {
      hashContent: sha256,
      // Resolve only /a.txt (take left); leave /b.txt unresolved.
      resolve: (c) =>
        c.path === "/a.txt"
          ? { operations: [{ op: "modify", path: c.path, kind: "file", source: { side: "left", path: c.path } }] }
          : undefined,
    });

    expect(op(operations, "/a.txt")).toMatchObject({ op: "modify", source: { side: "left" } });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "content", path: "/b.txt" });
  });

  it("leaves every conflict in place when no resolver is supplied", async () => {
    const base = tree({ "/a.txt": "a\n" });
    const left = tree({ "/a.txt": "LEFT\n" });
    const right = tree({ "/a.txt": "RIGHT\n" });

    const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });
    expect(operations).toEqual([]);
    expect(conflicts).toHaveLength(1);
  });
});
