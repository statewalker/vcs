/**
 * Tests for GitFilesTreeDeltaApi
 */

import { createMemoryObjectStores } from "@statewalker/vcs-store-mem";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PackDeltaStore } from "../../src/backend/git/pack/index.js";
import { GitFilesDeltaApi } from "../../src/backend/git-files-storage-backend.js";
import type { DeltaChainDetails, DeltaStoreUpdate } from "../../src/storage/delta/delta-store.js";
import { GitFilesTreeDeltaApi } from "../../src/storage/delta/git-tree-delta-api.js";

/** Create a fake 40-char hex SHA-1 from a short seed */
function oid(seed: string): string {
  return seed.padStart(40, "0");
}

async function* toStream(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

function createMockDeltaStoreUpdate(): DeltaStoreUpdate {
  return {
    storeObject: vi.fn().mockResolvedValue(undefined),
    storeDelta: vi.fn().mockResolvedValue(0),
    close: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockPackDeltaStore(overrides: Partial<PackDeltaStore> = {}): PackDeltaStore {
  const mockUpdate = createMockDeltaStoreUpdate();

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    startUpdate: vi.fn().mockReturnValue(mockUpdate),
    loadDelta: vi.fn().mockResolvedValue(undefined),
    isDelta: vi.fn().mockResolvedValue(false),
    removeDelta: vi.fn().mockResolvedValue(false),
    getDeltaChainInfo: vi.fn().mockResolvedValue(undefined),
    listDeltas: vi.fn().mockReturnValue((async function* () {})()),
    findDependents: vi.fn().mockResolvedValue([]),
    isBase: vi.fn().mockResolvedValue(false),
    buildReverseIndex: vi.fn().mockResolvedValue(undefined),
    invalidateReverseIndex: vi.fn(),
    getPackDirectory: vi.fn(),
    getReverseIndex: vi.fn().mockReturnValue(null),
    loadObject: vi.fn().mockResolvedValue(undefined),
    hasObject: vi.fn().mockResolvedValue(false),
    ...overrides,
  } as unknown as PackDeltaStore;
}

describe("GitFilesTreeDeltaApi", () => {
  let trees: ReturnType<typeof createMemoryObjectStores>["trees"];

  beforeEach(() => {
    const stores = createMemoryObjectStores();
    trees = stores.trees;
  });

  it("findTreeDelta returns null", async () => {
    const store = createMockPackDeltaStore();
    const api = new GitFilesTreeDeltaApi(store, trees);

    async function* empty(): AsyncIterable<string> {}
    const result = await api.findTreeDelta(oid("abc"), empty());
    expect(result).toBeNull();
  });

  it("isTreeDelta delegates to packDeltaStore.isDelta", async () => {
    const store = createMockPackDeltaStore({
      isDelta: vi.fn().mockResolvedValue(true),
    });
    const api = new GitFilesTreeDeltaApi(store, trees);

    const result = await api.isTreeDelta(oid("abc"));
    expect(result).toBe(true);
    expect(store.isDelta).toHaveBeenCalledWith(oid("abc"));
  });

  it("isTreeDelta returns false for non-delta", async () => {
    const store = createMockPackDeltaStore();
    const api = new GitFilesTreeDeltaApi(store, trees);

    const result = await api.isTreeDelta(oid("abc"));
    expect(result).toBe(false);
  });

  it("getTreeDeltaChain returns undefined for non-delta", async () => {
    const store = createMockPackDeltaStore();
    const api = new GitFilesTreeDeltaApi(store, trees);

    const result = await api.getTreeDeltaChain(oid("abc"));
    expect(result).toBeUndefined();
  });

  it("getTreeDeltaChain maps DeltaChainDetails to BlobDeltaChainInfo", async () => {
    const chainDetails: DeltaChainDetails = {
      baseKey: oid("base"),
      targetKey: oid("target"),
      depth: 2,
      originalSize: 100,
      compressedSize: 50,
      chain: [oid("target"), oid("mid"), oid("base")],
    };

    const store = createMockPackDeltaStore({
      getDeltaChainInfo: vi.fn().mockResolvedValue(chainDetails),
    });
    const api = new GitFilesTreeDeltaApi(store, trees);

    const result = await api.getTreeDeltaChain(oid("target"));
    expect(result).toBeDefined();
    expect(result?.depth).toBe(2);
    expect(result?.totalSize).toBe(50);
    expect(result?.baseIds).toEqual([oid("target"), oid("mid"), oid("base")]);
  });

  it("deltifyTree collects delta bytes and stores via packDeltaStore", async () => {
    const mockUpdate = createMockDeltaStoreUpdate();
    const store = createMockPackDeltaStore({
      startUpdate: vi.fn().mockReturnValue(mockUpdate),
    });
    const api = new GitFilesTreeDeltaApi(store, trees);

    // Create a minimal binary delta (base size=5, target size=5, single insert of 5 bytes)
    // Varint encoding: 5 = 0x05
    // Insert instruction: 0x05 means insert next 5 bytes
    const deltaBytes = new Uint8Array([
      0x05, // base size = 5
      0x05, // target size = 5
      0x05, // insert 5 bytes
      0x48,
      0x65,
      0x6c,
      0x6c,
      0x6f, // "Hello"
    ]);

    await api.deltifyTree(oid("target"), oid("base"), toStream(deltaBytes));

    expect(store.startUpdate).toHaveBeenCalled();
    expect(mockUpdate.storeDelta).toHaveBeenCalledWith(
      { baseKey: oid("base"), targetKey: oid("target") },
      expect.any(Array),
    );
    expect(mockUpdate.close).toHaveBeenCalled();
  });

  it("undeltifyTree loads object and removes delta", async () => {
    const store = createMockPackDeltaStore({
      loadObject: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
      removeDelta: vi.fn().mockResolvedValue(true),
    });
    const api = new GitFilesTreeDeltaApi(store, trees);

    await api.undeltifyTree(oid("abc"));
    expect(store.loadObject).toHaveBeenCalledWith(oid("abc"));
    expect(store.removeDelta).toHaveBeenCalledWith(oid("abc"), true);
  });

  it("undeltifyTree throws when object not found", async () => {
    const store = createMockPackDeltaStore({
      loadObject: vi.fn().mockResolvedValue(undefined),
    });
    const api = new GitFilesTreeDeltaApi(store, trees);

    await expect(api.undeltifyTree(oid("missing"))).rejects.toThrow(/not found in pack files/);
  });
});

describe("GitFilesDeltaApi with trees", () => {
  let blobs: ReturnType<typeof createMemoryObjectStores>["blobs"];
  let trees: ReturnType<typeof createMemoryObjectStores>["trees"];

  beforeEach(() => {
    const stores = createMemoryObjectStores();
    blobs = stores.blobs;
    trees = stores.trees;
  });

  it("has trees property when trees provided", () => {
    const store = createMockPackDeltaStore();
    const delta = new GitFilesDeltaApi(store, blobs, trees);
    expect(delta.trees).toBeDefined();
  });

  it("has no trees property when trees not provided", () => {
    const store = createMockPackDeltaStore();
    const delta = new GitFilesDeltaApi(store, blobs);
    expect(delta.trees).toBeUndefined();
  });

  it("getDeltaChain falls through to trees", async () => {
    const chainDetails: DeltaChainDetails = {
      baseKey: oid("base"),
      targetKey: oid("target"),
      depth: 1,
      originalSize: 50,
      compressedSize: 25,
      chain: [oid("target"), oid("base")],
    };

    // isDelta returns false for blobs path, but getDeltaChainInfo returns data
    // to simulate a tree delta
    const store = createMockPackDeltaStore({
      isDelta: vi.fn().mockResolvedValue(false),
      getDeltaChainInfo: vi.fn().mockResolvedValue(chainDetails),
    });
    const delta = new GitFilesDeltaApi(store, blobs, trees);

    const chain = await delta.getDeltaChain(oid("target"));
    expect(chain).toBeDefined();
    expect(chain?.depth).toBe(1);
  });
});
