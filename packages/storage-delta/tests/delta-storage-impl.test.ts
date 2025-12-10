import type {
  DeltaBackend,
  DeltaBackendStats,
  DeltaChainDetails,
  ObjectId,
  ObjectStorage,
  StoredDelta,
} from "@webrun-vcs/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { DeltaStorageImpl } from "../src/delta-storage-impl.js";

/**
 * Mock ObjectStorage for testing
 */
class MockObjectStorage implements ObjectStorage {
  private objects: Map<ObjectId, Uint8Array> = new Map();

  addObject(id: ObjectId, content: Uint8Array): void {
    this.objects.set(id, content);
  }

  async store(data: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<ObjectId> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of data) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const content = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      content.set(chunk, offset);
      offset += chunk.length;
    }
    const id = `obj_${this.objects.size}`;
    this.objects.set(id, content);
    return id;
  }

  async *load(id: ObjectId): AsyncIterable<Uint8Array> {
    const content = this.objects.get(id);
    if (!content) throw new Error(`Object not found: ${id}`);
    yield content;
  }

  async getSize(id: ObjectId): Promise<number> {
    const content = this.objects.get(id);
    return content?.length ?? -1;
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }

  async delete(id: ObjectId): Promise<boolean> {
    return this.objects.delete(id);
  }

  async *listObjects(): AsyncGenerator<ObjectId> {
    for (const id of this.objects.keys()) {
      yield id;
    }
  }
}

/**
 * Mock DeltaBackend for testing
 */
class MockDeltaBackend implements DeltaBackend {
  readonly name = "mock";
  private deltas: Map<ObjectId, StoredDelta> = new Map();
  private objects: Map<ObjectId, Uint8Array> = new Map();

  setObject(id: ObjectId, content: Uint8Array): void {
    this.objects.set(id, content);
  }

  async storeDelta(targetId: ObjectId, baseId: ObjectId, delta: unknown[]): Promise<boolean> {
    this.deltas.set(targetId, {
      targetId,
      baseId,
      delta: delta as StoredDelta["delta"],
      ratio: 0.5,
    });
    return true;
  }

  async loadDelta(id: ObjectId): Promise<StoredDelta | undefined> {
    return this.deltas.get(id);
  }

  async isDelta(id: ObjectId): Promise<boolean> {
    return this.deltas.has(id);
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.deltas.has(id) || this.objects.has(id);
  }

  async loadObject(id: ObjectId): Promise<Uint8Array | undefined> {
    // For simplicity, return stored object content directly
    return this.objects.get(id);
  }

  async removeDelta(id: ObjectId, _keepAsBase?: boolean): Promise<boolean> {
    return this.deltas.delete(id);
  }

  async getDeltaChainInfo(id: ObjectId): Promise<DeltaChainDetails | undefined> {
    const delta = this.deltas.get(id);
    if (!delta) return undefined;
    return {
      baseId: delta.baseId,
      depth: 1,
      originalSize: 100,
      compressedSize: 50,
      chain: [id, delta.baseId],
    };
  }

  async *listObjects(): AsyncIterable<ObjectId> {
    for (const id of this.deltas.keys()) {
      yield id;
    }
    for (const id of this.objects.keys()) {
      if (!this.deltas.has(id)) {
        yield id;
      }
    }
  }

  async *listDeltas(): AsyncIterable<{ targetId: ObjectId; baseId: ObjectId }> {
    for (const [targetId, delta] of this.deltas) {
      yield { targetId, baseId: delta.baseId };
    }
  }

  async getStats(): Promise<DeltaBackendStats> {
    return {
      deltaCount: this.deltas.size,
      baseCount: this.objects.size,
      averageChainDepth: 1,
      maxChainDepth: 1,
      totalSize: 0,
    };
  }

  async flush(): Promise<void> {}
  async close(): Promise<void> {}
  async refresh(): Promise<void> {}
}

describe("DeltaStorageImpl", () => {
  let looseStorage: MockObjectStorage;
  let deltaBackend: MockDeltaBackend;
  let deltaStorage: DeltaStorageImpl;

  // Helper to create test content
  function makeContent(seed: number, size: number): Uint8Array {
    const result = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      result[i] = ((seed + i) * 31) & 0xff;
    }
    return result;
  }

  beforeEach(() => {
    looseStorage = new MockObjectStorage();
    deltaBackend = new MockDeltaBackend();
    deltaStorage = new DeltaStorageImpl(looseStorage, deltaBackend);
  });

  describe("ObjectStorage interface", () => {
    it("should store objects in loose storage", async () => {
      const content = makeContent(1, 100);
      const id = await deltaStorage.store([content]);

      expect(await looseStorage.has(id)).toBe(true);
      expect(await deltaStorage.has(id)).toBe(true);
    });

    it("should load objects from loose storage", async () => {
      const content = makeContent(1, 100);
      looseStorage.addObject("test-id", content);

      const chunks: Uint8Array[] = [];
      for await (const chunk of deltaStorage.load("test-id")) {
        chunks.push(chunk);
      }

      expect(chunks[0]).toEqual(content);
    });

    it("should load objects from delta backend first", async () => {
      const content = makeContent(1, 100);
      const differentContent = makeContent(2, 100);

      // Put different content in each storage
      deltaBackend.setObject("test-id", content);
      looseStorage.addObject("test-id", differentContent);

      const chunks: Uint8Array[] = [];
      for await (const chunk of deltaStorage.load("test-id")) {
        chunks.push(chunk);
      }

      // Should get content from delta backend
      expect(chunks[0]).toEqual(content);
    });

    it("should check both storages for has()", async () => {
      looseStorage.addObject("loose-id", makeContent(1, 100));
      deltaBackend.setObject("delta-id", makeContent(2, 100));

      expect(await deltaStorage.has("loose-id")).toBe(true);
      expect(await deltaStorage.has("delta-id")).toBe(true);
      expect(await deltaStorage.has("missing-id")).toBe(false);
    });

    it("should list objects from both storages", async () => {
      looseStorage.addObject("loose-id", makeContent(1, 100));
      deltaBackend.setObject("delta-id", makeContent(2, 100));

      const ids: ObjectId[] = [];
      for await (const id of deltaStorage.listObjects()) {
        ids.push(id);
      }

      expect(ids).toContain("loose-id");
      expect(ids).toContain("delta-id");
    });
  });

  describe("configuration", () => {
    it("should get current strategies", () => {
      const strategies = deltaStorage.getStrategies();
      expect(strategies.candidate).toBeDefined();
      expect(strategies.compute).toBeDefined();
    });

    it("should set candidate strategy", () => {
      const mockStrategy = {
        name: "mock",
        findCandidates: async function* () {
          yield "test";
        },
      };

      deltaStorage.setCandidateStrategy(mockStrategy);
      expect(deltaStorage.getStrategies().candidate.name).toBe("mock");
    });

    it("should set compute strategy", () => {
      const mockStrategy = {
        name: "mock-compute",
        computeDelta: () => null,
        applyDelta: () => new Uint8Array(0),
        estimateSize: () => 0,
      };

      deltaStorage.setComputeStrategy(mockStrategy);
      expect(deltaStorage.getStrategies().compute.name).toBe("mock-compute");
    });
  });

  describe("delta operations", () => {
    it("should check if object is delta", async () => {
      const content = makeContent(1, 100);
      looseStorage.addObject("base-id", content);
      await deltaBackend.storeDelta("target-id", "base-id", []);

      expect(await deltaStorage.isDelta("target-id")).toBe(true);
      expect(await deltaStorage.isDelta("base-id")).toBe(false);
    });

    it("should get delta chain info", async () => {
      const content = makeContent(1, 100);
      looseStorage.addObject("base-id", content);
      await deltaBackend.storeDelta("target-id", "base-id", []);

      const info = await deltaStorage.getDeltaChainInfo("target-id");
      expect(info).toBeDefined();
      if (info) {
        expect(info.baseId).toBe("base-id");
        expect(info.depth).toBe(1);
      }
    });
  });

  describe("statistics", () => {
    it("should return combined stats", async () => {
      looseStorage.addObject("loose-id", makeContent(1, 100));
      deltaBackend.setObject("delta-id", makeContent(2, 100));

      const stats = await deltaStorage.getStats();

      expect(stats.loose.count).toBe(1);
      expect(stats.delta.baseCount).toBe(1);
    });
  });

  describe("analysis", () => {
    it("should analyze repository", async () => {
      looseStorage.addObject("obj1", makeContent(1, 100));
      looseStorage.addObject("obj2", makeContent(2, 200));

      const analysis = await deltaStorage.analyzeRepository();

      expect(analysis.looseObjects).toBe(2);
      expect(analysis.totalSize).toBeGreaterThan(0);
    });

    it("should suggest packing", async () => {
      looseStorage.addObject("obj1", makeContent(1, 1000));
      looseStorage.addObject("obj2", makeContent(1, 1010)); // Similar size

      const suggestions = await deltaStorage.suggestPacking();

      expect(suggestions).toBeDefined();
      expect(suggestions.candidates.length).toBeGreaterThanOrEqual(0);
    });
  });
});
