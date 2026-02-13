/**
 * Tests for GitFilesCommitDeltaApi
 *
 * Uses mock-based testing since PackDeltaStore requires file system setup.
 * Verifies the API correctly delegates to PackDeltaStore methods.
 */

import { describe, expect, it, vi } from "vitest";
import { GitFilesDeltaApi } from "../../src/backend/git-files-storage-backend.js";
import { GitFilesCommitDeltaApi } from "../../src/storage/delta/git-commit-delta-api.js";

/** Create a fake 40-char hex SHA-1 from a short seed */
function oid(seed: string): string {
  return seed.padStart(40, "0");
}

function createMockPackDeltaStore() {
  const mockUpdate = {
    storeObject: vi.fn(),
    storeDelta: vi.fn().mockResolvedValue(0),
    close: vi.fn(),
  };

  const store = {
    isDelta: vi.fn().mockResolvedValue(false),
    getDeltaChainInfo: vi.fn().mockResolvedValue(undefined),
    startUpdate: vi.fn().mockReturnValue(mockUpdate),
    loadObject: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    removeDelta: vi.fn().mockResolvedValue(true),
    listDeltas: vi.fn(),
    findDependents: vi.fn(),
    initialize: vi.fn(),
    close: vi.fn(),
    loadDelta: vi.fn(),
    isBase: vi.fn(),
    hasObject: vi.fn(),
    buildReverseIndex: vi.fn(),
    invalidateReverseIndex: vi.fn(),
    getPackDirectory: vi.fn(),
    getReverseIndex: vi.fn(),
  };

  return { store, mockUpdate };
}

describe("GitFilesCommitDeltaApi", () => {
  it("findCommitDelta returns null", async () => {
    const { store } = createMockPackDeltaStore();
    const api = new GitFilesCommitDeltaApi(store as any);

    async function* empty() {
      // no candidates
    }

    expect(await api.findCommitDelta(oid("abc"), empty())).toBeNull();
  });

  it("isCommitDelta delegates to packDeltaStore.isDelta", async () => {
    const { store } = createMockPackDeltaStore();
    store.isDelta.mockResolvedValue(true);
    const api = new GitFilesCommitDeltaApi(store as any);

    expect(await api.isCommitDelta(oid("abc"))).toBe(true);
    expect(store.isDelta).toHaveBeenCalledWith(oid("abc"));
  });

  it("isCommitDelta returns false for non-delta", async () => {
    const { store } = createMockPackDeltaStore();
    const api = new GitFilesCommitDeltaApi(store as any);

    expect(await api.isCommitDelta(oid("abc"))).toBe(false);
  });

  it("getCommitDeltaChain maps from DeltaChainDetails", async () => {
    const { store } = createMockPackDeltaStore();
    store.getDeltaChainInfo.mockResolvedValue({
      baseKey: oid("base1"),
      targetKey: oid("target1"),
      depth: 2,
      originalSize: 100,
      compressedSize: 50,
      chain: [oid("target1"), oid("base1")],
    });
    const api = new GitFilesCommitDeltaApi(store as any);

    const chain = await api.getCommitDeltaChain(oid("target1"));
    expect(chain).toEqual({
      depth: 2,
      totalSize: 50,
      baseIds: [oid("target1"), oid("base1")],
    });
  });

  it("getCommitDeltaChain returns undefined for non-delta", async () => {
    const { store } = createMockPackDeltaStore();
    const api = new GitFilesCommitDeltaApi(store as any);

    expect(await api.getCommitDeltaChain(oid("abc"))).toBeUndefined();
  });

  it("deltifyCommit calls startUpdate, storeDelta, and close", async () => {
    const { store, mockUpdate } = createMockPackDeltaStore();
    const api = new GitFilesCommitDeltaApi(store as any);

    // Create a minimal binary delta stream
    // parseBinaryDelta expects Git binary delta format: base-size varint, result-size varint, instructions
    // For this test we just verify the delegation pattern - storeDelta is mocked
    const deltaChunk = new Uint8Array([
      5, // base size = 5
      5, // result size = 5
      0x05,
      0x48,
      0x65,
      0x6c,
      0x6c,
      0x6f, // insert 5 bytes: "Hello"
    ]);

    async function* deltaStream() {
      yield deltaChunk;
    }

    await api.deltifyCommit(oid("target"), oid("base"), deltaStream());

    expect(store.startUpdate).toHaveBeenCalled();
    expect(mockUpdate.storeDelta).toHaveBeenCalledWith(
      { baseKey: oid("base"), targetKey: oid("target") },
      expect.any(Array),
    );
    expect(mockUpdate.close).toHaveBeenCalled();
  });

  it("undeltifyCommit calls loadObject and removeDelta", async () => {
    const { store } = createMockPackDeltaStore();
    const api = new GitFilesCommitDeltaApi(store as any);

    await api.undeltifyCommit(oid("abc"));

    expect(store.loadObject).toHaveBeenCalledWith(oid("abc"));
    expect(store.removeDelta).toHaveBeenCalledWith(oid("abc"), true);
  });

  it("undeltifyCommit throws if object not found", async () => {
    const { store } = createMockPackDeltaStore();
    store.loadObject.mockResolvedValue(undefined);
    const api = new GitFilesCommitDeltaApi(store as any);

    await expect(api.undeltifyCommit(oid("missing"))).rejects.toThrow(/not found in pack files/);
  });
});

describe("GitFilesDeltaApi with commits", () => {
  it("has commits property when enableCommitDeltas is true", () => {
    const { store } = createMockPackDeltaStore();
    const mockBlobs = {} as any;
    const api = new GitFilesDeltaApi(store as any, mockBlobs, { enableCommitDeltas: true });

    expect(api.commits).toBeDefined();
  });

  it("has commits property by default (enableCommitDeltas not set)", () => {
    const { store } = createMockPackDeltaStore();
    const mockBlobs = {} as any;
    const api = new GitFilesDeltaApi(store as any, mockBlobs);

    expect(api.commits).toBeDefined();
  });

  it("getDeltaChain falls back to commits when blob chain is undefined", async () => {
    const { store } = createMockPackDeltaStore();
    const mockBlobs = {} as any;
    const api = new GitFilesDeltaApi(store as any, mockBlobs, { enableCommitDeltas: true });

    // packDeltaStore.getDeltaChainInfo returns a chain for the commit
    store.getDeltaChainInfo.mockResolvedValue({
      baseKey: oid("base"),
      targetKey: oid("target"),
      depth: 1,
      originalSize: 200,
      compressedSize: 80,
      chain: [oid("target"), oid("base")],
    });

    const chain = await api.getDeltaChain(oid("target"));
    expect(chain).toEqual({
      depth: 1,
      totalSize: 80,
      baseIds: [oid("target"), oid("base")],
    });
  });
});
