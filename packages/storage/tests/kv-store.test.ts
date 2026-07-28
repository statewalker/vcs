import { describe, expect, it } from "vitest";
import { memKvStore } from "../src/index.js";
import { bytes } from "./helpers.js";

describe("KvStore (mem)", () => {
  it("get/put/remove roundtrip", async () => {
    const kv = memKvStore();
    expect(await kv.get("k")).toBeUndefined();
    await kv.put("k", bytes("v"));
    expect(await kv.get("k")).toEqual(bytes("v"));
    expect(await kv.remove("k")).toBe(true);
    expect(await kv.get("k")).toBeUndefined();
    expect(await kv.remove("k")).toBe(false);
  });

  it("cas succeeds when the expected value matches", async () => {
    const kv = memKvStore();
    await kv.put("k", bytes("old"));
    expect(await kv.cas("k", bytes("old"), bytes("new"))).toBe(true);
    expect(await kv.get("k")).toEqual(bytes("new"));
  });

  it("cas returns false and writes nothing when expected is stale", async () => {
    const kv = memKvStore();
    await kv.put("k", bytes("current"));
    expect(await kv.cas("k", bytes("stale"), bytes("new"))).toBe(false);
    expect(await kv.get("k")).toEqual(bytes("current"));
  });

  it("cas create: expected undefined sets only when the key is absent", async () => {
    const kv = memKvStore();
    expect(await kv.cas("k", undefined, bytes("created"))).toBe(true);
    expect(await kv.get("k")).toEqual(bytes("created"));
    // now the key exists, so a create must fail and write nothing
    expect(await kv.cas("k", undefined, bytes("again"))).toBe(false);
    expect(await kv.get("k")).toEqual(bytes("created"));
  });

  it("cas delete: next undefined removes the key on match", async () => {
    const kv = memKvStore();
    await kv.put("k", bytes("v"));
    expect(await kv.cas("k", bytes("v"), undefined)).toBe(true);
    expect(await kv.get("k")).toBeUndefined();
  });

  it("atomicity: two cas with the same stale expected → exactly one succeeds", async () => {
    const kv = memKvStore();
    await kv.put("k", bytes("v0"));
    const [a, b] = await Promise.all([
      kv.cas("k", bytes("v0"), bytes("A")),
      kv.cas("k", bytes("v0"), bytes("B")),
    ]);
    expect([a, b].filter(Boolean).length).toBe(1);
  });

  it("list(prefix) yields matching key/value pairs", async () => {
    const kv = memKvStore();
    await kv.put("ref/a", bytes("1"));
    await kv.put("ref/b", bytes("2"));
    await kv.put("idx/c", bytes("3"));
    const seen: Record<string, string> = {};
    for await (const { key, value } of kv.list("ref/")) {
      seen[key] = new TextDecoder().decode(value);
    }
    expect(seen).toEqual({ "ref/a": "1", "ref/b": "2" });
  });
});
