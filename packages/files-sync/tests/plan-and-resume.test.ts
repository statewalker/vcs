import { describe, expect, it } from "vitest";
import type { SyncAction, Transfer } from "../src/index.js";
import { createStreamingTransfer, execute, plan } from "../src/index.js";
import { fingerprint, MemCheckpoint, readText, sha256, sync, tree } from "./helpers.js";

describe("plan purity and serializability", () => {
  it("plan() mutates neither endpoint (dry run)", async () => {
    const a = tree({ "/x.txt": "x" });
    const b = tree({ "/y.txt": "y" });
    const beforeA = await fingerprint(a);
    const beforeB = await fingerprint(b);

    await plan(a, b, "sync", { hashContent: sha256 });

    expect(await fingerprint(a)).toEqual(beforeA);
    expect(await fingerprint(b)).toEqual(beforeB);
  });

  it("SyncPlan round-trips through JSON", async () => {
    const a = tree({ "/new.txt": "n", "/changed.txt": "v2" });
    const b = tree({ "/changed.txt": "v1", "/gone.txt": "g" });

    const p = await plan(a, b, "sync", { hashContent: sha256 });
    const roundTripped = JSON.parse(JSON.stringify(p));

    expect(roundTripped).toEqual(p);
  });
});

describe("resumable execute", () => {
  it("resumes after interruption with no duplicate work", async () => {
    const a = tree({ "/f1.txt": "1", "/f2.txt": "2", "/f3.txt": "3" });
    const b = tree();
    const checkpoint = new MemCheckpoint();

    // Count transfers to prove no action runs twice.
    const runs: string[] = [];
    const counting: Transfer = {
      async run(action: SyncAction, from, to) {
        if (action.kind === "copy" || action.kind === "update") runs.push(action.path);
        await createStreamingTransfer().run(action, from, to);
      },
    };
    const opts = { hashContent: sha256, checkpoint, transfer: counting };

    const p = await plan(a, b, "copy", opts);

    // Interrupt after the first done event.
    let doneSeen = 0;
    for await (const e of execute(p, a, b, opts)) {
      if (e.type === "done" && ++doneSeen === 1) break;
    }
    // Resume to completion.
    await sync(p, a, b, opts);

    expect(await readText(b, "/f1.txt")).toBe("1");
    expect(await readText(b, "/f2.txt")).toBe("2");
    expect(await readText(b, "/f3.txt")).toBe("3");
    // Exactly one transfer per file — no duplicated work across the two runs.
    expect(runs.sort()).toEqual(["/f1.txt", "/f2.txt", "/f3.txt"]);
  });
});
