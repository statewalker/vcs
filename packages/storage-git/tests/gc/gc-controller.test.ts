/**
 * Tests for GCController
 *
 * Tests the garbage collection controller and its scheduling logic.
 */

import type { ObjectId } from "@webrun-vcs/core";
import type { Delta } from "@webrun-vcs/utils";
import type {
  DeltaChainDetails,
  DeltaInfo,
  DeltaStore,
  RawStore,
} from "@webrun-vcs/vcs/binary-storage";
import { beforeEach, describe, expect, it } from "vitest";

import { DeltaStorageImpl } from "../../src/delta/index.js";
import { GCController } from "../../src/gc/gc-controller.js";

const encoder = new TextEncoder();

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
 * Create async generator from content
 */
async function* contentGenerator(content: Uint8Array): AsyncGenerator<Uint8Array> {
  yield content;
}

describe("GCController", () => {
  let storage: DeltaStorageImpl;

  beforeEach(() => {
    const rawStore = new MockRawStore();
    const deltaStore = new MockDeltaStore();
    const volatileStore = new MockVolatileStore();
    storage = new DeltaStorageImpl(rawStore, deltaStore, volatileStore);
  });

  describe("constructor", () => {
    it("creates controller with default options", () => {
      const gc = new GCController(storage);
      expect(gc).toBeDefined();
    });

    it("accepts custom options", () => {
      const gc = new GCController(storage, {
        looseObjectThreshold: 50,
        chainDepthThreshold: 25,
        minInterval: 5000,
        quickPackThreshold: 10,
      });

      const options = gc.getOptions();
      expect(options.looseObjectThreshold).toBe(50);
      expect(options.chainDepthThreshold).toBe(25);
    });
  });

  describe("pending commits tracking", () => {
    it("starts with zero pending commits", () => {
      const gc = new GCController(storage);
      expect(gc.getPendingCommitsCount()).toBe(0);
    });

    it("tracks pending commits", async () => {
      const gc = new GCController(storage, { quickPackThreshold: 100 });

      await gc.onCommit("commit1" as ObjectId);
      expect(gc.getPendingCommitsCount()).toBe(1);

      await gc.onCommit("commit2" as ObjectId);
      expect(gc.getPendingCommitsCount()).toBe(2);
    });

    it("triggers quick pack at threshold", async () => {
      const gc = new GCController(storage, { quickPackThreshold: 2 });

      await gc.onCommit("commit1" as ObjectId);
      expect(gc.getPendingCommitsCount()).toBe(1);

      // Second commit should trigger quick pack and reset counter
      await gc.onCommit("commit2" as ObjectId);
      expect(gc.getPendingCommitsCount()).toBe(0);
    });
  });

  describe("GC timing", () => {
    it("returns -1 for time since last GC when never run", () => {
      const gc = new GCController(storage);
      expect(gc.getTimeSinceLastGC()).toBe(-1);
    });

    it("tracks time since last GC after running", async () => {
      const gc = new GCController(storage, { minInterval: 0 });

      await gc.runGC();
      const timeSince = gc.getTimeSinceLastGC();

      expect(timeSince).toBeGreaterThanOrEqual(0);
      expect(timeSince).toBeLessThan(1000);
    });

    it("respects minimum interval", async () => {
      const gc = new GCController(storage, {
        minInterval: 10000, // 10 seconds
        looseObjectThreshold: 1,
      });

      await storage.store("blob", contentGenerator(encoder.encode("test")));

      // First check should return true (never run)
      expect(await gc.shouldRunGC()).toBe(true);

      // Run GC
      await gc.runGC();

      // Immediately after should return false due to interval
      expect(await gc.shouldRunGC()).toBe(false);
    });
  });

  describe("shouldRunGC", () => {
    it("returns true when loose object threshold exceeded", async () => {
      const gc = new GCController(storage, {
        looseObjectThreshold: 2,
        minInterval: 0,
      });

      // Store objects
      await storage.store("blob", contentGenerator(encoder.encode("Object 1")));
      await storage.store("blob", contentGenerator(encoder.encode("Object 2")));
      await storage.store("blob", contentGenerator(encoder.encode("Object 3")));

      expect(await gc.shouldRunGC()).toBe(true);
    });

    it("returns false when below threshold and after interval", async () => {
      const gc = new GCController(storage, {
        looseObjectThreshold: 100,
        minInterval: 0,
      });

      // Run once to set lastGC time
      await gc.runGC();

      // Single object below threshold
      await storage.store("blob", contentGenerator(encoder.encode("Object 1")));

      expect(await gc.shouldRunGC()).toBe(false);
    });
  });

  describe("runGC", () => {
    it("runs and returns result", async () => {
      const gc = new GCController(storage, { minInterval: 0 });

      // Store some objects
      await storage.store("blob", contentGenerator(encoder.encode("Object 1")));
      await storage.store("blob", contentGenerator(encoder.encode("Object 2")));

      const result = await gc.runGC();

      expect(result).toBeDefined();
      expect(result.objectsProcessed).toBeGreaterThanOrEqual(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("accepts packing options", async () => {
      const gc = new GCController(storage, { minInterval: 0 });

      await storage.store("blob", contentGenerator(encoder.encode("A".repeat(100))));

      const result = await gc.runGC({ windowSize: 5 });

      expect(result).toBeDefined();
    });
  });

  describe("getOptions", () => {
    it("returns current options", () => {
      const gc = new GCController(storage, {
        looseObjectThreshold: 50,
        chainDepthThreshold: 25,
        minInterval: 5000,
      });

      const options = gc.getOptions();

      expect(options.looseObjectThreshold).toBe(50);
      expect(options.chainDepthThreshold).toBe(25);
      expect(options.minInterval).toBe(5000);
    });

    it("returns default values for unspecified options", () => {
      const gc = new GCController(storage);
      const options = gc.getOptions();

      // Should have default values
      expect(options.looseObjectThreshold).toBeDefined();
      expect(options.chainDepthThreshold).toBeDefined();
      expect(options.minInterval).toBeDefined();
    });
  });
});
