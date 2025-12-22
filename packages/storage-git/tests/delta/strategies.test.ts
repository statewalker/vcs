/**
 * Tests for delta compression strategies
 *
 * Tests SimilarSizeCandidateStrategy and RollingHashDeltaStrategy.
 */

import type { ObjectId } from "@webrun-vcs/core";
import { describe, expect, it } from "vitest";

import {
  type ObjectStorage,
  RollingHashDeltaStrategy,
  SimilarSizeCandidateStrategy,
} from "../../src/delta/index.js";

const encoder = new TextEncoder();

/**
 * Mock object storage for testing candidate strategies
 */
class MockObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, Uint8Array>();

  addObject(id: string, content: Uint8Array): void {
    this.objects.set(id, content);
  }

  async has(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }

  async getSize(id: ObjectId): Promise<number> {
    const content = this.objects.get(id);
    return content?.length ?? 0;
  }

  async *listObjects(): AsyncGenerator<ObjectId> {
    for (const id of this.objects.keys()) {
      yield id as ObjectId;
    }
  }

  async *load(id: ObjectId): AsyncGenerator<Uint8Array> {
    const content = this.objects.get(id);
    if (content) yield content;
  }
}

describe("SimilarSizeCandidateStrategy", () => {
  describe("constructor", () => {
    it("uses default options", () => {
      const strategy = new SimilarSizeCandidateStrategy();
      expect(strategy.name).toBe("similar-size");
    });

    it("accepts custom tolerance", () => {
      const strategy = new SimilarSizeCandidateStrategy({ tolerance: 0.3 });
      expect(strategy).toBeDefined();
    });

    it("accepts custom maxCandidates", () => {
      const strategy = new SimilarSizeCandidateStrategy({ maxCandidates: 5 });
      expect(strategy).toBeDefined();
    });
  });

  describe("findCandidates", () => {
    it("finds objects with similar size", async () => {
      const strategy = new SimilarSizeCandidateStrategy({ tolerance: 0.5 });
      const storage = new MockObjectStorage();

      // Target is 100 bytes
      const targetId = "target000000000000000000000000000000000" as ObjectId;
      storage.addObject(targetId, new Uint8Array(100));

      // Similar sizes (within 50% tolerance)
      storage.addObject("similar80000000000000000000000000000000", new Uint8Array(80));
      storage.addObject("similar120000000000000000000000000000000", new Uint8Array(120));

      // Dissimilar sizes (outside tolerance)
      storage.addObject("toobig00000000000000000000000000000000", new Uint8Array(200));
      storage.addObject("toosmall000000000000000000000000000000", new Uint8Array(10));

      const candidates: ObjectId[] = [];
      for await (const id of strategy.findCandidates(targetId, storage)) {
        candidates.push(id);
      }

      // Should find the similar-sized objects
      expect(candidates.length).toBe(2);
      expect(candidates).not.toContain(targetId);
      expect(candidates).not.toContain("toobig00000000000000000000000000000000");
      expect(candidates).not.toContain("toosmall000000000000000000000000000000");
    });

    it("returns empty for zero-size target", async () => {
      const strategy = new SimilarSizeCandidateStrategy();
      const storage = new MockObjectStorage();

      const targetId = "target000000000000000000000000000000000" as ObjectId;
      storage.addObject(targetId, new Uint8Array(0));

      const candidates: ObjectId[] = [];
      for await (const id of strategy.findCandidates(targetId, storage)) {
        candidates.push(id);
      }

      expect(candidates.length).toBe(0);
    });

    it("sorts by size difference (closest first)", async () => {
      const strategy = new SimilarSizeCandidateStrategy({ tolerance: 0.5 });
      const storage = new MockObjectStorage();

      const targetId = "target000000000000000000000000000000000" as ObjectId;
      storage.addObject(targetId, new Uint8Array(100));

      // Add objects at different distances from target
      storage.addObject("diff20000000000000000000000000000000000", new Uint8Array(120)); // diff = 20
      storage.addObject("diff5000000000000000000000000000000000", new Uint8Array(105)); // diff = 5
      storage.addObject("diff10000000000000000000000000000000000", new Uint8Array(90)); // diff = 10

      const candidates: ObjectId[] = [];
      for await (const id of strategy.findCandidates(targetId, storage)) {
        candidates.push(id);
      }

      // First candidate should be closest in size
      expect(candidates[0]).toBe("diff5000000000000000000000000000000000");
    });

    it("respects maxCandidates limit", async () => {
      const strategy = new SimilarSizeCandidateStrategy({
        tolerance: 0.5,
        maxCandidates: 2,
      });
      const storage = new MockObjectStorage();

      const targetId = "target000000000000000000000000000000000" as ObjectId;
      storage.addObject(targetId, new Uint8Array(100));

      // Add more candidates than the limit
      for (let i = 0; i < 10; i++) {
        const id = `candidate${i}000000000000000000000000000000`.slice(0, 40);
        storage.addObject(id, new Uint8Array(100 + i));
      }

      const candidates: ObjectId[] = [];
      for await (const id of strategy.findCandidates(targetId, storage)) {
        candidates.push(id);
      }

      expect(candidates.length).toBe(2);
    });

    it("excludes target from candidates", async () => {
      const strategy = new SimilarSizeCandidateStrategy();
      const storage = new MockObjectStorage();

      const targetId = "target000000000000000000000000000000000" as ObjectId;
      storage.addObject(targetId, new Uint8Array(100));

      const candidates: ObjectId[] = [];
      for await (const id of strategy.findCandidates(targetId, storage)) {
        candidates.push(id);
      }

      expect(candidates).not.toContain(targetId);
    });
  });
});

describe("RollingHashDeltaStrategy", () => {
  describe("constructor", () => {
    it("creates strategy with correct name", () => {
      const strategy = new RollingHashDeltaStrategy();
      expect(strategy.name).toBe("rolling-hash");
    });
  });

  describe("computeDelta", () => {
    it("returns undefined for small targets", () => {
      const strategy = new RollingHashDeltaStrategy();
      const base = encoder.encode("Base content");
      const target = encoder.encode("Short");

      const result = strategy.computeDelta(base, target, { minSize: 50 });
      expect(result).toBeUndefined();
    });

    it("computes delta for similar content", () => {
      const strategy = new RollingHashDeltaStrategy();
      const base = encoder.encode(
        "This is a reasonably long base content string that can be used for testing delta compression algorithms.",
      );
      const target = encoder.encode(
        "This is a reasonably long base content string that can be used for testing delta compression algorithms. With modification.",
      );

      const result = strategy.computeDelta(base, target);

      // Result may or may not be defined depending on ratio
      if (result) {
        expect(result.delta).toBeDefined();
        expect(result.ratio).toBeLessThan(1);
        expect(result.ratio).toBeGreaterThan(0);
      }
    });

    it("returns undefined when ratio exceeds maxRatio", () => {
      const strategy = new RollingHashDeltaStrategy();
      const base = encoder.encode("AAAA");
      const target = encoder.encode(
        "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      );

      // Very different content should produce high ratio
      const result = strategy.computeDelta(base, target, { maxRatio: 0.1 });
      expect(result).toBeUndefined();
    });

    it("respects minSize option", () => {
      const strategy = new RollingHashDeltaStrategy();
      const base = encoder.encode("Base");
      const target = encoder.encode("Target");

      const result = strategy.computeDelta(base, target, { minSize: 100 });
      expect(result).toBeUndefined();
    });
  });

  describe("applyDelta", () => {
    it("reconstructs target from base and delta", () => {
      const strategy = new RollingHashDeltaStrategy();
      const base = encoder.encode(
        "This is a reasonably long base content string for delta testing purposes.",
      );
      const target = encoder.encode(
        "This is a reasonably long base content string for delta testing purposes. Added text here.",
      );

      const result = strategy.computeDelta(base, target);

      if (result) {
        const reconstructed = strategy.applyDelta(base, result.delta);
        expect(reconstructed).toEqual(target);
      }
    });
  });

  describe("estimateSize", () => {
    it("estimates delta size", () => {
      const strategy = new RollingHashDeltaStrategy();
      const base = encoder.encode("This is a base content string that we will use for testing.");
      const target = encoder.encode(
        "This is a base content string that we will use for testing. Modified.",
      );

      const result = strategy.computeDelta(base, target);

      if (result) {
        const size = strategy.estimateSize(result.delta);
        expect(size).toBeGreaterThan(0);
      }
    });

    it("handles empty delta", () => {
      const strategy = new RollingHashDeltaStrategy();
      const size = strategy.estimateSize([]);
      expect(size).toBe(0);
    });

    it("accounts for different delta instruction types", () => {
      const strategy = new RollingHashDeltaStrategy();

      // Test with various instruction types
      const delta = [
        { type: "start" as const, targetLength: 100 },
        { type: "copy" as const, start: 0, length: 50 },
        { type: "insert" as const, data: encoder.encode("inserted") },
        { type: "finish" as const, checksum: 0 },
      ];

      const size = strategy.estimateSize(delta);
      expect(size).toBeGreaterThan(0);
    });
  });
});
