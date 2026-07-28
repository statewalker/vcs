import { describe, expect, it, vi } from "vitest";
import { plan } from "../src/index.js";
import { fingerprint, readText, sha256, sync, tree } from "./helpers.js";

describe("copy", () => {
  it("lands new/changed A files in B and keeps extraneous B files", async () => {
    const a = tree({ "/new.txt": "new", "/changed.txt": "version-two" });
    const b = tree({ "/changed.txt": "v1", "/extra.txt": "keep" });

    const p = await plan(a, b, "copy", { hashContent: sha256 });
    await sync(p, a, b, { hashContent: sha256 });

    expect(await readText(b, "/new.txt")).toBe("new");
    expect(await readText(b, "/changed.txt")).toBe("version-two");
    expect(await readText(b, "/extra.txt")).toBe("keep"); // never deleted by copy
  });

  it("skips byte-identical files without hashing", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a = tree({ "/same.txt": "identical" });
    const b = tree({ "/same.txt": "identical" });
    const hashContent = vi.fn(sha256);

    const p = await plan(a, b, "copy", { hashContent });

    expect(hashContent).not.toHaveBeenCalled();
    expect(p.actions).toEqual([]);
    vi.useRealTimers();
  });

  it("reproduces an empty directory as a mkdir", async () => {
    const a = tree();
    await a.mkdir("/emptydir");
    const b = tree();

    const p = await plan(a, b, "copy", { hashContent: sha256 });
    await sync(p, a, b, { hashContent: sha256 });

    expect(p.actions).toContainEqual({ kind: "mkdir", path: "/emptydir" });
    expect(await b.exists("/emptydir")).toBe(true);
  });
});

describe("sync", () => {
  it("copies like copy and deletes extraneous B files", async () => {
    const a = tree({ "/keep.txt": "k" });
    const b = tree({ "/keep.txt": "k", "/gone.txt": "x" });

    const p = await plan(a, b, "sync", { hashContent: sha256 });
    await sync(p, a, b, { hashContent: sha256 });

    expect(await b.exists("/gone.txt")).toBe(false);
    expect(await readText(b, "/keep.txt")).toBe("k");
  });
});

describe("check", () => {
  it("reports differences but transfers nothing and mutates neither endpoint", async () => {
    const a = tree({ "/x.txt": "x", "/changed.txt": "AAA-longer" });
    const b = tree({ "/changed.txt": "B", "/only-b.txt": "b" });

    const beforeA = await fingerprint(a);
    const beforeB = await fingerprint(b);

    const p = await plan(a, b, "check", { hashContent: sha256 });
    const events = await sync(p, a, b, { hashContent: sha256 });

    // Differences reported as a diff plan.
    expect(p.actions).toContainEqual({ kind: "copy", path: "/x.txt", from: "a" });
    expect(p.actions).toContainEqual({ kind: "update", path: "/changed.txt", from: "a" });
    // Nothing executed.
    expect(events.filter((e) => e.type === "done")).toEqual([]);
    // Neither endpoint mutated.
    expect(await fingerprint(a)).toEqual(beforeA);
    expect(await fingerprint(b)).toEqual(beforeB);
  });
});
