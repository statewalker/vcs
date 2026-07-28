import { describe, expect, it } from "vitest";
import type { Transfer } from "../src/index.js";
import { execute, plan } from "../src/index.js";
import { MemCheckpoint, readText, sha256, sync, tree } from "./helpers.js";

describe("move safety", () => {
  it("moves files and clears the source once the destination is verified", async () => {
    const a = tree({ "/f1.txt": "one", "/f2.txt": "two" });
    const b = tree();

    const p = await plan(a, b, "move", { hashContent: sha256 });
    await sync(p, a, b, { hashContent: sha256 });

    expect(await readText(b, "/f1.txt")).toBe("one");
    expect(await readText(b, "/f2.txt")).toBe("two");
    expect(await a.exists("/f1.txt")).toBe(false);
    expect(await a.exists("/f2.txt")).toBe(false);
  });

  it("retains the source when the destination fails verification", async () => {
    const a = tree({ "/f.txt": "payload" });
    const b = tree();
    // A transfer that writes nothing → destination never appears → verify fails.
    const noop: Transfer = { async run() {} };

    const p = await plan(a, b, "move", { hashContent: sha256, transfer: noop });
    const events = await sync(p, a, b, { hashContent: sha256, transfer: noop });

    expect(await a.exists("/f.txt")).toBe(true); // source NOT lost
    expect(await b.exists("/f.txt")).toBe(false);
    expect(events.some((e) => e.type === "skipped")).toBe(true);
  });

  it("resumes an interrupted move with no data loss", async () => {
    const a = tree({ "/f1.txt": "one", "/f2.txt": "two" });
    const b = tree();
    const checkpoint = new MemCheckpoint();
    const opts = { hashContent: sha256, checkpoint };

    const p = await plan(a, b, "move", opts);

    // Interrupt after the first completed action.
    let doneSeen = 0;
    for await (const e of execute(p, a, b, opts)) {
      if (e.type === "done" && ++doneSeen === 1) break;
    }
    // Resume.
    await sync(p, a, b, opts);

    expect(await readText(b, "/f1.txt")).toBe("one");
    expect(await readText(b, "/f2.txt")).toBe("two");
    expect(await a.exists("/f1.txt")).toBe(false);
    expect(await a.exists("/f2.txt")).toBe(false);
  });
});
