import { describe, expect, it } from "vitest";
import { memKvStore, refStore } from "../src/index.js";

describe("RefStore facade (over KvStore)", () => {
  it("read/compareAndSet store string ids as UTF-8 over the kv", async () => {
    const kv = memKvStore();
    const refs = refStore(kv);
    expect(await refs.read("main")).toBeUndefined();
    expect(await refs.compareAndSet("main", undefined, "commit-1")).toBe(true);
    expect(await refs.read("main")).toBe("commit-1");
    // and the underlying kv really holds the UTF-8 bytes
    expect(await kv.get("main")).toEqual(new TextEncoder().encode("commit-1"));
  });

  it("compareAndSet maps onto cas — stale expected is rejected", async () => {
    const kv = memKvStore();
    const refs = refStore(kv);
    await refs.compareAndSet("main", undefined, "commit-1");
    expect(await refs.compareAndSet("main", "commit-0", "commit-2")).toBe(false);
    expect(await refs.read("main")).toBe("commit-1");
  });

  it("prevents a lost update between two concurrent ref writers", async () => {
    const kv = memKvStore();
    const refs = refStore(kv);
    await refs.compareAndSet("main", undefined, "base");
    // both readers see "base" and try to advance it
    const [a, b] = await Promise.all([
      refs.compareAndSet("main", "base", "from-A"),
      refs.compareAndSet("main", "base", "from-B"),
    ]);
    expect([a, b].filter(Boolean).length).toBe(1); // exactly one winner
    const winner = await refs.read("main");
    expect(["from-A", "from-B"]).toContain(winner);
  });

  it("compareAndSet with next undefined deletes the ref", async () => {
    const kv = memKvStore();
    const refs = refStore(kv);
    await refs.compareAndSet("tmp", undefined, "x");
    expect(await refs.compareAndSet("tmp", "x", undefined)).toBe(true);
    expect(await refs.read("tmp")).toBeUndefined();
  });

  it("list(prefix) surfaces name/id pairs", async () => {
    const kv = memKvStore();
    const refs = refStore(kv);
    await refs.compareAndSet("heads/main", undefined, "c1");
    await refs.compareAndSet("heads/dev", undefined, "c2");
    const seen: Record<string, string> = {};
    for await (const { name, id } of refs.list("heads/")) seen[name] = id;
    expect(seen).toEqual({ "heads/main": "c1", "heads/dev": "c2" });
  });
});
