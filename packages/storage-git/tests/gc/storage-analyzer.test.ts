/**
 * Tests for StorageAnalyzer
 *
 * Tests the storage analysis functionality for GC and packing.
 */

import type { CommitStore, ObjectId, TreeStore } from "@webrun-vcs/core";
import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  RawStore,
} from "@webrun-vcs/vcs/binary-storage";
import { describe, expect, it } from "vitest";

import { DeltaStorageImpl } from "../../src/delta/index.js";
import { StorageAnalyzer } from "../../src/gc/storage-analyzer.js";
import type { PackingContext } from "../../src/gc/types.js";

const encoder = new TextEncoder();

/**
 * Mock RawStore implementation
 */
class MockRawStore implements RawStore {
  private readonly data = new Map<string, Uint8Array>();

  addObject(key: string, content: Uint8Array): void {
    this.data.set(key, content);
  }

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    this.data.set(key, result);
    return result.length;
  }

  async *load(key: string): AsyncIterable<Uint8Array> {
    const content = this.data.get(key);
    if (!content) {
      throw new Error(`Key not found: ${key}`);
    }
    yield content;
  }

  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }

  async *keys(): AsyncIterable<string> {
    for (const key of this.data.keys()) {
      yield key;
    }
  }

  async size(key: string): Promise<number | undefined> {
    return this.data.get(key)?.length;
  }
}

/**
 * Mock DeltaStore implementation
 */
class MockDeltaStore implements DeltaStore {
  private readonly deltas = new Map<
    string,
    { baseKey: string; targetKey: string; delta: Delta[]; ratio: number }
  >();

  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number> {
    this.deltas.set(info.targetKey, {
      baseKey: info.baseKey,
      targetKey: info.targetKey,
      delta,
      ratio: 0.5,
    });
    return 1;
  }

  async loadDelta(
    key: string,
  ): Promise<{ baseKey: string; targetKey: string; delta: Delta[]; ratio: number } | undefined> {
    return this.deltas.get(key);
  }

  async isDelta(key: string): Promise<boolean> {
    return this.deltas.has(key);
  }

  async removeDelta(targetKey: string, _keepAsBase?: boolean): Promise<boolean> {
    return this.deltas.delete(targetKey);
  }

  async *listDeltas(): AsyncIterable<DeltaInfo> {
    for (const [targetKey, value] of this.deltas) {
      yield { baseKey: value.baseKey, targetKey };
    }
  }

  async getDeltaChainInfo(key: string): Promise<DeltaChainDetails | undefined> {
    const delta = this.deltas.get(key);
    if (!delta) return undefined;

    return {
      baseKey: delta.baseKey,
      targetKey: key,
      depth: 1,
      originalSize: 100,
      compressedSize: 50,
      chain: [delta.baseKey, key],
    };
  }
}

/**
 * Mock VolatileStore (TempStore) implementation
 */
class MockVolatileStore {
  async store(
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<{ size: number; read(): AsyncIterable<Uint8Array>; dispose(): Promise<void> }> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of content) {
      chunks.push(chunk);
    }
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }

    return {
      size: totalLength,
      read: async function* () {
        yield result;
      },
      dispose: async () => {},
    };
  }
}

/**
 * Mock TreeStore implementation
 */
class MockTreeStore implements TreeStore {
  async *loadTree(_treeId: ObjectId): AsyncIterable<{ name: string; mode: number; id: ObjectId }> {
    // Empty tree for testing
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async storeTree(
    _entries: AsyncIterable<{ name: string; mode: number; id: ObjectId }>,
  ): Promise<ObjectId> {
    return "tree0000000000000000000000000000000000000" as ObjectId;
  }
}

/**
 * Mock CommitStore implementation
 */
class MockCommitStore implements CommitStore {
  async *walkAncestry(_commitId: ObjectId): AsyncIterable<ObjectId> {
    // Empty ancestry for testing
  }

  async getTree(_commitId: ObjectId): Promise<ObjectId> {
    return "tree0000000000000000000000000000000000000" as ObjectId;
  }

  async storeCommit(_commit: {
    treeId: ObjectId;
    parentIds: ObjectId[];
    message: string;
    author: { name: string; email: string; timestamp: Date };
    committer: { name: string; email: string; timestamp: Date };
  }): Promise<ObjectId> {
    return "commit0000000000000000000000000000000000" as ObjectId;
  }

  async loadCommit(_commitId: ObjectId): Promise<{
    treeId: ObjectId;
    parentIds: ObjectId[];
    message: string;
    author: { name: string; email: string; timestamp: Date };
    committer: { name: string; email: string; timestamp: Date };
  }> {
    return {
      treeId: "tree0000000000000000000000000000000000000" as ObjectId,
      parentIds: [],
      message: "Test commit",
      author: { name: "Test", email: "test@test.com", timestamp: new Date() },
      committer: { name: "Test", email: "test@test.com", timestamp: new Date() },
    };
  }
}

/**
 * Create a test packing context
 */
function createTestContext(): {
  context: PackingContext;
  rawStore: MockRawStore;
  deltaStore: MockDeltaStore;
  storage: DeltaStorageImpl;
} {
  const rawStore = new MockRawStore();
  const deltaStore = new MockDeltaStore();
  const volatileStore = new MockVolatileStore();
  const storage = new DeltaStorageImpl(rawStore, deltaStore, volatileStore);

  const context: PackingContext = {
    objects: storage,
    trees: new MockTreeStore(),
    commits: new MockCommitStore(),
  };

  return { context, rawStore, deltaStore, storage };
}

/**
 * Create async generator from content
 */
async function* contentGenerator(content: Uint8Array): AsyncGenerator<Uint8Array> {
  yield content;
}

describe("StorageAnalyzer", () => {
  describe("analyzeAll", () => {
    it("returns empty report for empty storage", async () => {
      const { context } = createTestContext();
      const analyzer = new StorageAnalyzer();

      const report = await analyzer.analyzeAll(context);

      expect(report.totalObjects).toBe(0);
      expect(report.fullObjects).toBe(0);
      expect(report.deltaObjects).toBe(0);
      expect(report.packingCandidates).toHaveLength(0);
    });

    it("counts full objects correctly", async () => {
      const { context, storage } = createTestContext();
      const analyzer = new StorageAnalyzer();

      // Store some objects (minimum 50 bytes to be considered)
      await storage.store("blob", contentGenerator(encoder.encode("A".repeat(60))));
      await storage.store("blob", contentGenerator(encoder.encode("B".repeat(60))));
      await storage.store("blob", contentGenerator(encoder.encode("C".repeat(60))));

      const report = await analyzer.analyzeAll(context);

      expect(report.totalObjects).toBe(3);
      expect(report.fullObjects).toBe(3);
      expect(report.deltaObjects).toBe(0);
    });

    it("includes objects in packing candidates when above minSize", async () => {
      const { context, storage } = createTestContext();
      const analyzer = new StorageAnalyzer();

      // Store objects of different sizes
      await storage.store("blob", contentGenerator(encoder.encode("Small"))); // 5 bytes - too small
      await storage.store("blob", contentGenerator(encoder.encode("A".repeat(100)))); // 100 bytes - included

      const report = await analyzer.analyzeAll(context, { minSize: 50 });

      // One object is above minSize
      expect(report.packingCandidates.length).toBe(1);
      expect(report.packingCandidates[0].size).toBe(100);
    });

    it("calculates storage size correctly", async () => {
      const { context, storage } = createTestContext();
      const analyzer = new StorageAnalyzer();

      await storage.store("blob", contentGenerator(encoder.encode("A".repeat(100))));
      await storage.store("blob", contentGenerator(encoder.encode("B".repeat(200))));

      const report = await analyzer.analyzeAll(context);

      expect(report.totalStorageSize).toBe(300);
    });

    it("handles abort signal", async () => {
      const { context, storage } = createTestContext();
      const analyzer = new StorageAnalyzer();

      // Store some objects
      await storage.store("blob", contentGenerator(encoder.encode("A".repeat(60))));
      await storage.store("blob", contentGenerator(encoder.encode("B".repeat(60))));

      const controller = new AbortController();
      controller.abort(); // Abort immediately

      await expect(analyzer.analyzeAll(context, { signal: controller.signal })).rejects.toThrow(
        "Analysis aborted",
      );
    });

    it("tracks progress via callback", async () => {
      const { context, storage } = createTestContext();
      const analyzer = new StorageAnalyzer();

      await storage.store("blob", contentGenerator(encoder.encode("A".repeat(60))));
      await storage.store("blob", contentGenerator(encoder.encode("B".repeat(60))));

      const progressCalls: number[] = [];
      await analyzer.analyzeAll(context, {
        onProgress: (processed) => {
          progressCalls.push(processed);
        },
      });

      expect(progressCalls.length).toBeGreaterThan(0);
    });

    it("estimates savings for full objects", async () => {
      const { context, storage } = createTestContext();
      const analyzer = new StorageAnalyzer();

      // Store large objects that could potentially be compressed
      await storage.store("blob", contentGenerator(encoder.encode("A".repeat(1000))));

      const report = await analyzer.analyzeAll(context, { minSize: 50 });

      // Estimated savings should be positive for large objects
      expect(report.estimatedSavings).toBeGreaterThan(0);
    });
  });

  describe("analyzeFromRoots", () => {
    it("returns empty report for empty roots", async () => {
      const { context } = createTestContext();
      const analyzer = new StorageAnalyzer();

      const report = await analyzer.analyzeFromRoots(context, []);

      expect(report.totalObjects).toBe(0);
      expect(report.packingCandidates).toHaveLength(0);
    });
  });

  describe("findOrphanedObjects", () => {
    it("returns all objects as orphans when no roots given", async () => {
      const { context, storage } = createTestContext();
      const analyzer = new StorageAnalyzer();

      const id1 = await storage.store("blob", contentGenerator(encoder.encode("Object 1")));
      const id2 = await storage.store("blob", contentGenerator(encoder.encode("Object 2")));

      const orphans = await analyzer.findOrphanedObjects(context, []);

      expect(orphans).toContain(id1);
      expect(orphans).toContain(id2);
    });
  });
});
