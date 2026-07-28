import { afterEach, describe, expect, it, vi } from "vitest";
import { plan } from "../src/index.js";
import { sha256, tree } from "./helpers.js";

// MemFilesApi stamps `lastModified` with Date.now() on every write, so fake
// timers give us full control over the mtime rung of the ladder.
afterEach(() => vi.useRealTimers());

function spyHash() {
  return vi.fn(sha256);
}

describe("change-detection ladder", () => {
  it("skips hashing when size and mtime are equal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a = tree({ "/f.txt": "hello" });
    const b = tree({ "/f.txt": "hello" });
    const hashContent = spyHash();

    const p = await plan(a, b, "copy", { hashContent });

    expect(hashContent).not.toHaveBeenCalled();
    expect(p.actions.find((x) => "path" in x && x.path === "/f.txt")).toBeUndefined();
  });

  it("marks a size difference changed without hashing", async () => {
    const a = tree({ "/f.txt": "hello world" });
    const b = tree({ "/f.txt": "hi" });
    const hashContent = spyHash();

    const p = await plan(a, b, "copy", { hashContent });

    expect(hashContent).not.toHaveBeenCalled();
    expect(p.actions).toContainEqual({ kind: "update", path: "/f.txt", from: "a" });
  });

  it("hashes only at the ambiguous rung (equal size, differing mtime)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a = tree({ "/f.txt": "abc" });
    vi.setSystemTime(2000);
    const b = tree({ "/f.txt": "xyz" }); // same size, different content + mtime
    const hashContent = spyHash();

    const p = await plan(a, b, "copy", { hashContent });

    expect(hashContent).toHaveBeenCalled();
    expect(p.actions).toContainEqual({ kind: "update", path: "/f.txt", from: "a" });
  });

  it("hashes the ambiguous rung and skips when content is equal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a = tree({ "/f.txt": "abc" });
    vi.setSystemTime(2000);
    const b = tree({ "/f.txt": "abc" }); // identical content, different mtime
    const hashContent = spyHash();

    const p = await plan(a, b, "copy", { hashContent });

    expect(hashContent).toHaveBeenCalled();
    expect(p.actions.find((x) => "path" in x && x.path === "/f.txt")).toBeUndefined();
  });

  it("quick fingerprint decides a difference without a full hash", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const a = tree({ "/f.txt": "abc" });
    vi.setSystemTime(2000);
    const b = tree({ "/f.txt": "xyz" });
    const hashContent = spyHash();

    const p = await plan(a, b, "copy", { hashContent, quickFingerprint: true });

    expect(hashContent).not.toHaveBeenCalled(); // fingerprint sample already differs
    expect(p.actions).toContainEqual({ kind: "update", path: "/f.txt", from: "a" });
  });
});
