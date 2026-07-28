import { describe, expect, it } from "vitest";
import type { Resolution, SyncConflict } from "../src/index.js";
import { buildAnchor, plan } from "../src/index.js";
import { fingerprint, MemAnchorStore, readText, sha256, sync, tree } from "./helpers.js";

describe("bisync", () => {
  it("propagates disjoint changes both ways with zero conflicts and updates the anchor", async () => {
    const anchorStore = new MemAnchorStore();
    // Establish the base (last successful sync) as a single shared file.
    await anchorStore.write("default", await buildAnchor(tree({ "/base.txt": "base" }), sha256));

    const a = tree({ "/base.txt": "base", "/a-only.txt": "AA" });
    const b = tree({ "/base.txt": "base", "/b-only.txt": "BB" });
    const opts = { hashContent: sha256, anchorStore };

    const p = await plan(a, b, "bisync", opts);
    await sync(p, a, b, opts);

    expect(p.conflicts).toEqual([]);
    expect(await readText(b, "/a-only.txt")).toBe("AA");
    expect(await readText(a, "/b-only.txt")).toBe("BB");
    expect(await fingerprint(a)).toEqual(await fingerprint(b)); // converged
    // Anchor refreshed to the merged state.
    const updated = await anchorStore.read("default");
    expect(Object.keys(updated?.entries ?? {}).sort()).toEqual([
      "/a-only.txt",
      "/b-only.txt",
      "/base.txt",
    ]);
  });

  it("surfaces a both-modified file as a conflict, never silently overwriting", async () => {
    const anchorStore = new MemAnchorStore();
    await anchorStore.write("default", await buildAnchor(tree({ "/f.txt": "base" }), sha256));

    const a = tree({ "/f.txt": "AAA" });
    const b = tree({ "/f.txt": "BBB" });
    const opts = { hashContent: sha256, anchorStore };

    const p = await plan(a, b, "bisync", opts);

    expect(p.conflicts.map((c) => c.path)).toContain("/f.txt");
    // Nothing overwritten by the plan alone (plan is pure).
    expect(await readText(a, "/f.txt")).toBe("AAA");
    expect(await readText(b, "/f.txt")).toBe("BBB");
  });

  it("applies an injected resolve() to a both-modified conflict", async () => {
    const anchorStore = new MemAnchorStore();
    await anchorStore.write("default", await buildAnchor(tree({ "/f.txt": "base" }), sha256));

    const a = tree({ "/f.txt": "AAA" });
    const b = tree({ "/f.txt": "BBB" });
    // Resolution policy: take A's ("left") version.
    const resolve = (_c: SyncConflict): Resolution => ({
      operations: [
        { op: "modify", path: "/f.txt", kind: "file", source: { side: "left", path: "/f.txt" } },
      ],
    });
    const opts = { hashContent: sha256, anchorStore, resolve };

    const p = await plan(a, b, "bisync", opts);
    await sync(p, a, b, opts);

    expect(p.conflicts).toEqual([]); // folded away by resolve
    expect(await readText(b, "/f.txt")).toBe("AAA");
  });

  it("propagates a deletion instead of resurrecting the file", async () => {
    const anchorStore = new MemAnchorStore();
    await anchorStore.write(
      "default",
      await buildAnchor(tree({ "/f.txt": "F", "/g.txt": "G" }), sha256),
    );

    const a = tree({ "/g.txt": "G" }); // f.txt deleted on A
    const b = tree({ "/f.txt": "F", "/g.txt": "G" });
    const opts = { hashContent: sha256, anchorStore };

    const p = await plan(a, b, "bisync", opts);
    await sync(p, a, b, opts);

    expect(await b.exists("/f.txt")).toBe(false); // deletion propagated
    expect(await a.exists("/f.txt")).toBe(false); // not resurrected on A
    expect(await readText(a, "/g.txt")).toBe("G");
  });

  it("first bisync with no anchor is a conservative union (additions only, no deletions)", async () => {
    const anchorStore = new MemAnchorStore();
    const a = tree({ "/x.txt": "X", "/both.txt": "A-version-longer" });
    const b = tree({ "/y.txt": "Y", "/both.txt": "B" });
    const opts = { hashContent: sha256, anchorStore };

    const p = await plan(a, b, "bisync", opts);
    const events = await sync(p, a, b, opts);

    expect(events.some((e) => e.type === "warning")).toBe(true);
    // Additions propagate both ways.
    expect(await readText(b, "/x.txt")).toBe("X");
    expect(await readText(a, "/y.txt")).toBe("Y");
    // Divergent both-present file is a conflict, not overwritten.
    expect(p.conflicts.map((c) => c.path)).toContain("/both.txt");
    expect(await readText(a, "/both.txt")).toBe("A-version-longer");
    expect(await readText(b, "/both.txt")).toBe("B");
  });
});
