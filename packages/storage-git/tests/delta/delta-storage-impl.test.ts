/**
 * Tests for DeltaStorageImpl
 *
 * Tests the delta-aware object storage implementation.
 */

import type { ObjectId } from "@webrun-vcs/core";
import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  RawStore,
  VolatileStore,
} from "@webrun-vcs/vcs/binary-storage";
import { beforeEach, describe, expect, it } from "vitest";

import {
  type DeltaComputeOptions,
  type DeltaComputeResult,
  type DeltaComputeStrategy,
  DeltaStorageImpl,
  type DeltaStorageOptions,
  RollingHashDeltaStrategy,
  SimilarSizeCandidateStrategy,
} from "../../src/delta/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Mock RawStore implementation
 */
class MockRawStore implements RawStore {
  private readonly data = new Map<string, Uint8Array>();

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
 * Mock VolatileStore implementation
 *
 * The VolatileStore interface stores content temporarily and returns
 * a handle with size and ability to re-read the content.
 */
class MockVolatileStore implements VolatileStore {
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
 * Create async generator from content
 */
async function* contentGenerator(content: Uint8Array): AsyncGenerator<Uint8Array> {
  yield content;
}

/**
 * Collect async iterable into single Uint8Array
 */
async function collectBytes(stream: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Simple test compute strategy
 */
const testComputeStrategy: DeltaComputeStrategy = {
  computeDelta(
    base: Uint8Array,
    target: Uint8Array,
    options?: DeltaComputeOptions,
  ): DeltaComputeResult | undefined {
    const maxRatio = options?.maxRatio ?? 0.75;

    // If target is very similar to base, create a simple delta
    if (base.length > 0 && Math.abs(target.length - base.length) < base.length * 0.5) {
      return {
        delta: [
          { type: "start", targetLength: target.length },
          { type: "insert", data: target },
          { type: "finish", checksum: 0 },
        ],
        ratio: 0.5,
      };
    }

    return maxRatio > 0.5 ? undefined : undefined;
  },
};

describe("DeltaStorageImpl", () => {
  let rawStore: MockRawStore;
  let deltaStore: MockDeltaStore;
  let volatileStore: MockVolatileStore;
  let storage: DeltaStorageImpl;

  beforeEach(() => {
    rawStore = new MockRawStore();
    deltaStore = new MockDeltaStore();
    volatileStore = new MockVolatileStore();
    storage = new DeltaStorageImpl(rawStore, deltaStore, volatileStore);
  });

  describe("basic operations", () => {
    it("stores and loads blob content", async () => {
      const content = encoder.encode("Hello, World!");
      const id = await storage.store("blob", contentGenerator(content));

      expect(id).toMatch(/^[0-9a-f]{40}$/);
      expect(await storage.has(id)).toBe(true);

      const loaded = await collectBytes(storage.load(id));
      expect(decoder.decode(loaded)).toBe("Hello, World!");
    });

    it("stores and loads tree content", async () => {
      const content = new Uint8Array([1, 2, 3, 4, 5]);
      const id = await storage.store("tree", contentGenerator(content));

      expect(await storage.has(id)).toBe(true);
      const loaded = await collectBytes(storage.load(id));
      expect(loaded).toEqual(content);
    });

    it("stores and loads commit content", async () => {
      const content = encoder.encode("tree abc\nauthor test\n");
      const id = await storage.store("commit", contentGenerator(content));

      expect(await storage.has(id)).toBe(true);
    });

    it("returns correct size", async () => {
      const content = encoder.encode("Test content with specific length");
      const id = await storage.store("blob", contentGenerator(content));

      const size = await storage.getSize(id);
      expect(size).toBe(content.length);
    });

    it("deletes objects", async () => {
      const content = encoder.encode("To be deleted");
      const id = await storage.store("blob", contentGenerator(content));

      expect(await storage.has(id)).toBe(true);
      const deleted = await storage.delete(id);
      expect(deleted).toBe(true);
      expect(await storage.has(id)).toBe(false);
    });

    it("returns false when deleting non-existent object", async () => {
      const fakeId = "0".repeat(40) as ObjectId;
      const deleted = await storage.delete(fakeId);
      expect(deleted).toBe(false);
    });

    it("lists all stored objects", async () => {
      const contents = ["First", "Second", "Third"];
      const ids: ObjectId[] = [];

      for (const text of contents) {
        const id = await storage.store("blob", contentGenerator(encoder.encode(text)));
        ids.push(id);
      }

      const listed: ObjectId[] = [];
      for await (const id of storage.listObjects()) {
        listed.push(id);
      }

      expect(listed.sort()).toEqual(ids.sort());
    });

    it("handles empty content", async () => {
      const content = new Uint8Array(0);
      const id = await storage.store("blob", contentGenerator(content));

      expect(await storage.has(id)).toBe(true);
      const loaded = await collectBytes(storage.load(id));
      expect(loaded.length).toBe(0);
    });

    it("handles binary content", async () => {
      const content = new Uint8Array(256);
      for (let i = 0; i < 256; i++) content[i] = i;

      const id = await storage.store("blob", contentGenerator(content));
      const loaded = await collectBytes(storage.load(id));

      expect(loaded).toEqual(content);
    });
  });

  describe("raw object loading", () => {
    it("loads raw object with Git header", async () => {
      const content = encoder.encode("Test content");
      const id = await storage.store("blob", contentGenerator(content));

      const raw = await collectBytes(storage.loadRaw(id));
      const rawStr = decoder.decode(raw);

      // Should start with "blob <size>\0"
      expect(rawStr).toMatch(/^blob \d+\0/);
      expect(rawStr).toContain("Test content");
    });
  });

  describe("strategy configuration", () => {
    it("sets and gets strategies", () => {
      const candidateStrategy = new SimilarSizeCandidateStrategy();
      const computeStrategy = new RollingHashDeltaStrategy();

      storage.setCandidateStrategy(candidateStrategy);
      storage.setComputeStrategy(computeStrategy);

      const strategies = storage.getStrategies();
      expect(strategies.candidate).toBe(candidateStrategy);
      expect(strategies.compute).toBe(computeStrategy);
    });

    it("starts with no strategies configured", () => {
      const strategies = storage.getStrategies();
      expect(strategies.candidate).toBeUndefined();
      expect(strategies.compute).toBeUndefined();
    });
  });

  describe("delta operations", () => {
    it("isDelta returns false for non-delta objects", async () => {
      const content = encoder.encode("Regular object");
      const id = await storage.store("blob", contentGenerator(content));

      expect(await storage.isDelta(id)).toBe(false);
    });

    it("getDeltaChainInfo returns undefined for non-delta objects", async () => {
      const content = encoder.encode("Regular object");
      const id = await storage.store("blob", contentGenerator(content));

      const info = await storage.getDeltaChainInfo(id);
      expect(info).toBeUndefined();
    });

    it("deltify throws without candidate strategy", async () => {
      storage.setComputeStrategy(testComputeStrategy);

      const content = encoder.encode("Test content");
      const id = await storage.store("blob", contentGenerator(content));

      await expect(storage.deltify(id)).rejects.toThrow("No candidate strategy configured");
    });

    it("deltifyWith throws without compute strategy", async () => {
      const content = encoder.encode("Test content");
      const id = await storage.store("blob", contentGenerator(content));

      await expect(storage.deltifyWith(id, [])).rejects.toThrow("No compute strategy configured");
    });

    it("deltifyWith returns false for empty candidates", async () => {
      storage.setComputeStrategy(testComputeStrategy);

      const content = encoder.encode("Test content");
      const id = await storage.store("blob", contentGenerator(content));

      const result = await storage.deltifyWith(id, []);
      expect(result).toBe(false);
    });
  });

  describe("constructor options", () => {
    it("accepts maxChainDepth option", () => {
      const options: DeltaStorageOptions = { maxChainDepth: 5 };
      const customStorage = new DeltaStorageImpl(rawStore, deltaStore, volatileStore, options);

      expect(customStorage).toBeDefined();
    });

    it("accepts maxRatio option", () => {
      const options: DeltaStorageOptions = { maxRatio: 0.5 };
      const customStorage = new DeltaStorageImpl(rawStore, deltaStore, volatileStore, options);

      expect(customStorage).toBeDefined();
    });

    it("accepts initial strategies", () => {
      const candidateStrategy = new SimilarSizeCandidateStrategy();
      const computeStrategy = new RollingHashDeltaStrategy();

      const options: DeltaStorageOptions = {
        candidateStrategy,
        computeStrategy,
      };

      const customStorage = new DeltaStorageImpl(rawStore, deltaStore, volatileStore, options);

      const strategies = customStorage.getStrategies();
      expect(strategies.candidate).toBe(candidateStrategy);
      expect(strategies.compute).toBe(computeStrategy);
    });
  });

  describe("gitObjects interface", () => {
    it("exposes gitObjects property", () => {
      expect(storage.gitObjects).toBeDefined();
    });

    it("gitObjects.store produces correct hash", async () => {
      const content = encoder.encode("Hello, World!");
      const id = await storage.gitObjects.store("blob", contentGenerator(content));

      // b45ef6fec89518d314f546fd6c3025367b721684 is the well-known hash
      expect(id).toBe("b45ef6fec89518d314f546fd6c3025367b721684");
    });
  });

  describe("edge cases", () => {
    it("handles multiple stores of same content", async () => {
      const content = encoder.encode("Duplicate content");

      const id1 = await storage.store("blob", contentGenerator(content));
      const id2 = await storage.store("blob", contentGenerator(content));

      // Same content should produce same ID
      expect(id1).toBe(id2);
    });

    it("handles very long content", async () => {
      const content = encoder.encode("x".repeat(100000));
      const id = await storage.store("blob", contentGenerator(content));

      expect(await storage.has(id)).toBe(true);
      const loaded = await collectBytes(storage.load(id));
      expect(loaded.length).toBe(100000);
    });
  });
});
