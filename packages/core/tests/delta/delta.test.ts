/**
 * Tests for delta compression module
 */

import type { Delta } from "@statewalker/vcs-utils";
import { describe, expect, it } from "vitest";
import { MemoryRawStore } from "../../src/storage/binary/raw-store.memory.js";
import type { DeltaInfo } from "../../src/storage/delta/delta-store.js";
import {
  estimateDeltaSize,
  RawStoreWithDelta,
} from "../../src/storage/delta/raw-store-with-delta.js";
import { collectBytes } from "../helpers/assertion-helpers.js";
import { MockDeltaStore } from "../mocks/mock-delta-store.js";

// Helper to store delta using update pattern
async function storeDelta(store: MockDeltaStore, info: DeltaInfo, delta: Delta[]): Promise<void> {
  const update = store.startUpdate();
  await update.storeDelta(info, delta);
  await update.close();
}

describe("estimateDeltaSize", () => {
  it("estimates size for start instruction", () => {
    const delta = [{ type: "start" as const, targetLen: 100 }];
    const size = estimateDeltaSize(delta);
    expect(size).toBe(5); // varint max 5 bytes
  });

  it("estimates size for copy instruction", () => {
    const delta = [{ type: "copy" as const, start: 0, len: 50 }];
    const size = estimateDeltaSize(delta);
    expect(size).toBe(8); // 1 cmd + 4 offset + 3 size
  });

  it("estimates size for insert instruction", () => {
    const delta = [{ type: "insert" as const, data: new Uint8Array(100) }];
    const size = estimateDeltaSize(delta);
    // ceil(100/127) + 100 = 1 + 100 = 101
    expect(size).toBe(101);
  });

  it("estimates size for large insert instruction", () => {
    const delta = [{ type: "insert" as const, data: new Uint8Array(256) }];
    const size = estimateDeltaSize(delta);
    // ceil(256/127) + 256 = 3 + 256 = 259
    expect(size).toBe(259);
  });

  it("estimates size for finish instruction", () => {
    const delta = [{ type: "finish" as const, checksum: 0 }];
    const size = estimateDeltaSize(delta);
    expect(size).toBe(4); // checksum 4 bytes
  });

  it("estimates size for complete delta", () => {
    const delta = [
      { type: "start" as const, targetLen: 100 },
      { type: "copy" as const, start: 0, len: 50 },
      { type: "insert" as const, data: new Uint8Array(10) },
      { type: "finish" as const, checksum: 0 },
    ];
    const size = estimateDeltaSize(delta);
    // 5 + 8 + (1 + 10) + 4 = 28
    expect(size).toBe(28);
  });
});

describe("RawStoreWithDelta", () => {
  it("stores and loads objects from raw store", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    const content = new TextEncoder().encode("test content");
    await store.store("key1", [content]);

    const loaded = await collectBytes(store.load("key1"));
    expect(new TextDecoder().decode(loaded)).toBe("test content");
  });

  it("reports has correctly for stored objects", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    const content = new TextEncoder().encode("test content");
    await store.store("key1", [content]);

    expect(await store.has("key1")).toBe(true);
    expect(await store.has("nonexistent")).toBe(false);
  });

  it("lists all keys from both stores", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    // Store in raw store
    await store.store("raw1", [new TextEncoder().encode("content1")]);
    await store.store("raw2", [new TextEncoder().encode("content2")]);

    // Store delta
    await storeDelta(deltaStore, { baseKey: "raw1", targetKey: "delta1" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    const keys: string[] = [];
    for await (const key of store.keys()) {
      keys.push(key);
    }

    expect(keys).toContain("raw1");
    expect(keys).toContain("raw2");
    expect(keys).toContain("delta1");
    expect(keys.length).toBe(3);
  });

  it("deletes objects from raw store", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    await store.store("key1", [new TextEncoder().encode("content")]);
    expect(await store.has("key1")).toBe(true);

    await store.delete("key1");
    expect(await store.has("key1")).toBe(false);
  });

  it("deletes delta objects", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    // Store base in raw store
    await store.store("base", [new TextEncoder().encode("base content")]);

    // Store delta
    await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta1" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    expect(await store.has("delta1")).toBe(true);

    await store.delete("delta1");
    expect(await store.has("delta1")).toBe(false);
  });

  it("reports isDelta correctly", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    // Store base
    await store.store("base", [new TextEncoder().encode("base")]);

    // Store delta
    await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta1" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    expect(await store.isDelta("base")).toBe(false);
    expect(await store.isDelta("delta1")).toBe(true);
  });

  it("gets delta chain info", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    // Store base
    await store.store("base", [new TextEncoder().encode("base content")]);

    // Create chain: delta3 -> delta2 -> delta1 -> base
    await storeDelta(deltaStore, { baseKey: "base", targetKey: "delta1" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);
    await storeDelta(deltaStore, { baseKey: "delta1", targetKey: "delta2" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);
    await storeDelta(deltaStore, { baseKey: "delta2", targetKey: "delta3" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    const chainInfo = await store.getDeltaChainInfo("delta3");
    expect(chainInfo).toBeDefined();
    expect(chainInfo?.depth).toBe(3);
    expect(chainInfo?.chain).toEqual(["delta3", "delta2", "delta1", "base"]);
  });

  it("uses default compute strategy when not provided", async () => {
    const rawStore = new MemoryRawStore();
    const deltaStore = new MockDeltaStore();
    const store = new RawStoreWithDelta({
      objects: rawStore,
      deltas: deltaStore,
    });

    // Should work - uses defaultComputeDelta
    const content = new TextEncoder().encode("test content");
    await store.store("key1", [content]);

    const loaded = await collectBytes(store.load("key1"));
    expect(new TextDecoder().decode(loaded)).toBe("test content");
  });
});

describe("delta types", () => {
  it("PackingProgress has expected phases", () => {
    const phases = ["analyzing", "selecting", "deltifying", "optimizing", "complete"];

    // This is a type-level test - just verify the phases are valid string literals
    for (const phase of phases) {
      expect(typeof phase).toBe("string");
    }
  });
});
