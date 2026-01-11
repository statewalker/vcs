/**
 * Tests for mock implementations
 */

import type { Delta } from "@statewalker/vcs-utils";
import { describe, expect, it } from "vitest";
import { MemoryRawStore } from "../../src/storage/binary/raw-store.memory.js";
import type { DeltaInfo } from "../../src/storage/delta/delta-store.js";
import { CommitGraphBuilder, MockCommitStore } from "./mock-commit-store.js";
import { MockDeltaStore } from "./mock-delta-store.js";

// Helper to store delta using update pattern
async function storeDelta(store: MockDeltaStore, info: DeltaInfo, delta: Delta[]): Promise<void> {
  const update = store.startUpdate();
  await update.storeDelta(info, delta);
  await update.close();
}

describe("MockDeltaStore", () => {
  it("should store and load deltas", async () => {
    const store = new MockDeltaStore();
    const delta: Delta[] = [
      { type: "start" as const, targetLen: 100 },
      { type: "copy" as const, start: 0, len: 50 },
      { type: "insert" as const, data: new Uint8Array([1, 2, 3]) },
      { type: "finish" as const, checksum: 0 },
    ];

    await storeDelta(store, { baseKey: "base123", targetKey: "target456" }, delta);

    const loaded = await store.loadDelta("target456");
    expect(loaded).toBeDefined();
    expect(loaded?.baseKey).toBe("base123");
    expect(loaded?.delta).toEqual(delta);
  });

  it("should check if object is a delta", async () => {
    const store = new MockDeltaStore();
    await storeDelta(store, { baseKey: "base", targetKey: "target" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    expect(await store.isDelta("target")).toBe(true);
    expect(await store.isDelta("nonexistent")).toBe(false);
  });

  it("should remove deltas", async () => {
    const store = new MockDeltaStore();
    await storeDelta(store, { baseKey: "base", targetKey: "target" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    expect(await store.removeDelta("target")).toBe(true);
    expect(await store.isDelta("target")).toBe(false);
  });

  it("should track delta chain info", async () => {
    const store = new MockDeltaStore();

    // Create a chain: target3 -> target2 -> target1 -> base
    await storeDelta(store, { baseKey: "base", targetKey: "target1" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);
    await storeDelta(store, { baseKey: "target1", targetKey: "target2" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);
    await storeDelta(store, { baseKey: "target2", targetKey: "target3" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    const chainInfo = await store.getDeltaChainInfo("target3");
    expect(chainInfo).toBeDefined();
    expect(chainInfo?.depth).toBe(3);
    expect(chainInfo?.chain).toEqual(["target3", "target2", "target1", "base"]);
  });

  it("should list all deltas", async () => {
    const store = new MockDeltaStore();
    await storeDelta(store, { baseKey: "base1", targetKey: "target1" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);
    await storeDelta(store, { baseKey: "base2", targetKey: "target2" }, [
      { type: "start", targetLen: 10 },
      { type: "finish", checksum: 0 },
    ]);

    const deltas: Array<{ baseKey: string; targetKey: string }> = [];
    for await (const delta of store.listDeltas()) {
      deltas.push(delta);
    }

    expect(deltas).toHaveLength(2);
  });
});

describe("MockCommitStore", () => {
  it("should store and load commits", async () => {
    const store = new MockCommitStore();
    const commit = {
      tree: "tree123",
      parents: [],
      author: {
        name: "Test",
        email: "test@test.com",
        timestamp: 1234567890,
        tzOffset: "+0000",
      },
      committer: {
        name: "Test",
        email: "test@test.com",
        timestamp: 1234567890,
        tzOffset: "+0000",
      },
      message: "Test commit",
    };

    const id = await store.storeCommit(commit);
    const loaded = await store.loadCommit(id);

    expect(loaded.tree).toBe("tree123");
    expect(loaded.message).toBe("Test commit");
  });

  it("should walk ancestry", async () => {
    const store = new MockCommitStore();
    const person = {
      name: "Test",
      email: "test@test.com",
      timestamp: 1234567890,
      tzOffset: "+0000",
    };

    // Create a chain: c3 -> c2 -> c1
    const c1 = await store.storeCommit({
      tree: "t1",
      parents: [],
      author: person,
      committer: person,
      message: "First",
    });
    const c2 = await store.storeCommit({
      tree: "t2",
      parents: [c1],
      author: person,
      committer: person,
      message: "Second",
    });
    const c3 = await store.storeCommit({
      tree: "t3",
      parents: [c2],
      author: person,
      committer: person,
      message: "Third",
    });

    const ancestry: string[] = [];
    for await (const id of store.walkAncestry(c3)) {
      ancestry.push(id);
    }

    expect(ancestry).toEqual([c3, c2, c1]);
  });

  it("should check isAncestor", async () => {
    const store = new MockCommitStore();
    const person = {
      name: "Test",
      email: "test@test.com",
      timestamp: 1234567890,
      tzOffset: "+0000",
    };

    const c1 = await store.storeCommit({
      tree: "t1",
      parents: [],
      author: person,
      committer: person,
      message: "First",
    });
    const c2 = await store.storeCommit({
      tree: "t2",
      parents: [c1],
      author: person,
      committer: person,
      message: "Second",
    });

    expect(await store.isAncestor(c1, c2)).toBe(true);
    expect(await store.isAncestor(c2, c1)).toBe(false);
  });
});

describe("CommitGraphBuilder", () => {
  it("should build linear commit chain", async () => {
    const builder = new CommitGraphBuilder();
    const tip = await builder.linearChain("a", "b", "c", "d");

    expect(tip).toBe(builder.getId("d"));

    const store = builder.getStore();
    const parents = await store.getParents(tip);
    expect(parents).toEqual([builder.getId("c")]);
  });

  it("should build commits with specified parents", async () => {
    const builder = new CommitGraphBuilder();

    await builder.commit("a");
    await builder.commit("b");
    const merge = await builder.commit("merge", "a", "b");

    const store = builder.getStore();
    const parents = await store.getParents(merge);

    expect(parents).toContain(builder.getId("a"));
    expect(parents).toContain(builder.getId("b"));
  });
});

describe("MemoryRawStore", () => {
  it("should store and load data", async () => {
    const store = new MemoryRawStore();
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    await store.store("key1", [data]);
    const chunks: Uint8Array[] = [];
    for await (const chunk of store.load("key1")) {
      chunks.push(chunk);
    }

    const loaded = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      loaded.set(chunk, offset);
      offset += chunk.length;
    }

    expect(loaded).toEqual(data);
  });

  it("should check key existence", async () => {
    const store = new MemoryRawStore();
    await store.store("exists", [new Uint8Array([1])]);

    expect(await store.has("exists")).toBe(true);
    expect(await store.has("nonexistent")).toBe(false);
  });

  it("should delete keys", async () => {
    const store = new MemoryRawStore();
    await store.store("key", [new Uint8Array([1])]);

    expect(await store.delete("key")).toBe(true);
    expect(await store.has("key")).toBe(false);
  });
});
