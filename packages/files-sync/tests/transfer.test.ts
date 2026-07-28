import { describe, expect, it, vi } from "vitest";
import { createStreamingTransfer, plan } from "../src/index.js";
import { readText, sha256, sync, tree } from "./helpers.js";

describe("transfer capability seam", () => {
  it("streams across distinct backends (no server-side copy available)", async () => {
    const a = tree({ "/f.txt": "F" });
    const b = tree();
    const aCopy = vi.spyOn(a, "copy");
    const bWrite = vi.spyOn(b, "write");

    const p = await plan(a, b, "copy", { hashContent: sha256 });
    await sync(p, a, b, { hashContent: sha256 });

    expect(bWrite).toHaveBeenCalled(); // streaming fallback taken
    expect(aCopy).not.toHaveBeenCalled(); // no cross-backend server-side copy
    expect(await readText(b, "/f.txt")).toBe("F");
  });

  it("uses native server-side copy when source and destination are the same backend", async () => {
    const m = tree({ "/f.txt": "F" });
    const copySpy = vi.spyOn(m, "copy");

    await createStreamingTransfer().run({ kind: "copy", path: "/f.txt", from: "a" }, m, m);

    expect(copySpy).toHaveBeenCalledWith("/f.txt", "/f.txt");
  });
});
