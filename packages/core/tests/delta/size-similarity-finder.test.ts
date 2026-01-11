/**
 * Tests for SizeSimilarityCandidateFinder
 */

import { describe, expect, it } from "vitest";
import { SizeSimilarityCandidateFinder } from "../../src/delta/candidate-finder/size-similarity-finder.js";
import type { DeltaTarget } from "../../src/delta/candidate-finder.js";
import { ObjectType } from "../../src/objects/object-types.js";
import type {
  RepositoryAccess,
  RepositoryObjectInfo,
} from "../../src/repository-access/repository-access.js";

/**
 * Create a mock RepositoryAccess for testing
 */
function createMockRepository(objects: RepositoryObjectInfo[]): RepositoryAccess {
  const objectMap = new Map(objects.map((o) => [o.id, o]));

  return {
    has: async (id) => objectMap.has(id),
    getInfo: async (id) => objectMap.get(id) ?? null,
    load: async () => null,
    store: async () => "",
    enumerate: async function* () {
      for (const id of objectMap.keys()) {
        yield id;
      }
    },
    enumerateWithInfo: async function* () {
      for (const obj of objectMap.values()) {
        yield obj;
      }
    },
    loadWireFormat: async () => null,
  };
}

describe("SizeSimilarityCandidateFinder", () => {
  describe("findCandidates", () => {
    it("finds candidates with similar sizes within tolerance", async () => {
      const objects: RepositoryObjectInfo[] = [
        { id: "obj100", type: ObjectType.BLOB, size: 100 },
        { id: "obj105", type: ObjectType.BLOB, size: 105 },
        { id: "obj110", type: ObjectType.BLOB, size: 110 },
        { id: "obj200", type: ObjectType.BLOB, size: 200 },
      ];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, { tolerance: 0.2 });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push(c.id);
      }

      // Within 20% of 100: 80-120
      expect(candidates).toContain("obj100");
      expect(candidates).toContain("obj105");
      expect(candidates).toContain("obj110");
      expect(candidates).not.toContain("obj200");
    });

    it("excludes objects outside tolerance range", async () => {
      const objects: RepositoryObjectInfo[] = [
        { id: "obj50", type: ObjectType.BLOB, size: 50 },
        { id: "obj100", type: ObjectType.BLOB, size: 100 },
        { id: "obj200", type: ObjectType.BLOB, size: 200 },
      ];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, { tolerance: 0.1 });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push(c.id);
      }

      // Within 10% of 100: 90-110
      expect(candidates).toContain("obj100");
      expect(candidates).not.toContain("obj50");
      expect(candidates).not.toContain("obj200");
    });

    it("calculates similarity based on size difference", async () => {
      const objects: RepositoryObjectInfo[] = [
        { id: "exact", type: ObjectType.BLOB, size: 100 },
        { id: "close", type: ObjectType.BLOB, size: 105 },
        { id: "far", type: ObjectType.BLOB, size: 140 },
      ];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, { tolerance: 0.5 });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: { id: string; similarity: number }[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push({ id: c.id, similarity: c.similarity });
      }

      // Exact match should have highest similarity (1.0)
      const exact = candidates.find((c) => c.id === "exact");
      expect(exact?.similarity).toBe(1.0);

      // Close match should have high similarity
      const close = candidates.find((c) => c.id === "close");
      expect(close?.similarity).toBeGreaterThan(0.9);

      // Far match should have lower similarity
      const far = candidates.find((c) => c.id === "far");
      expect(far?.similarity).toBeLessThan(close?.similarity ?? 0);
    });

    it("respects maxCandidates limit", async () => {
      const objects: RepositoryObjectInfo[] = Array.from({ length: 20 }, (_, i) => ({
        id: `obj${i}`,
        type: ObjectType.BLOB,
        size: 100 + i,
      }));

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, {
        tolerance: 0.5,
        maxCandidates: 5,
      });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push(c.id);
      }

      expect(candidates).toHaveLength(5);
    });

    it("returns candidates sorted by similarity", async () => {
      const objects: RepositoryObjectInfo[] = [
        { id: "far", type: ObjectType.BLOB, size: 150 },
        { id: "exact", type: ObjectType.BLOB, size: 100 },
        { id: "close", type: ObjectType.BLOB, size: 105 },
      ];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, { tolerance: 0.5 });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidateIds: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidateIds.push(c.id);
      }

      // Should be sorted: exact, close, far
      expect(candidateIds[0]).toBe("exact");
      expect(candidateIds[1]).toBe("close");
      expect(candidateIds[2]).toBe("far");
    });

    it("sets reason to 'similar-size'", async () => {
      const objects: RepositoryObjectInfo[] = [{ id: "obj100", type: ObjectType.BLOB, size: 100 }];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, { tolerance: 0.5 });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      for await (const c of finder.findCandidates(target)) {
        expect(c.reason).toBe("similar-size");
      }
    });

    it("handles empty storage", async () => {
      const repo = createMockRepository([]);
      const finder = new SizeSimilarityCandidateFinder(repo, { tolerance: 0.5 });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push(c.id);
      }

      expect(candidates).toHaveLength(0);
    });

    it("excludes target object from candidates", async () => {
      const objects: RepositoryObjectInfo[] = [
        { id: "target", type: ObjectType.BLOB, size: 100 },
        { id: "other", type: ObjectType.BLOB, size: 100 },
      ];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, { tolerance: 0.5 });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push(c.id);
      }

      expect(candidates).not.toContain("target");
      expect(candidates).toContain("other");
    });

    it("respects allowedTypes filter", async () => {
      const objects: RepositoryObjectInfo[] = [
        { id: "blob1", type: ObjectType.BLOB, size: 100 },
        { id: "tree1", type: ObjectType.TREE, size: 100 },
        { id: "commit1", type: ObjectType.COMMIT, size: 100 },
      ];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, {
        tolerance: 0.5,
        allowedTypes: [ObjectType.BLOB],
      });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push(c.id);
      }

      expect(candidates).toContain("blob1");
      expect(candidates).not.toContain("tree1");
      expect(candidates).not.toContain("commit1");
    });

    it("respects minSimilarity threshold", async () => {
      const objects: RepositoryObjectInfo[] = [
        { id: "exact", type: ObjectType.BLOB, size: 100 },
        { id: "far", type: ObjectType.BLOB, size: 140 }, // 60% similarity
      ];

      const repo = createMockRepository(objects);
      const finder = new SizeSimilarityCandidateFinder(repo, {
        tolerance: 0.5,
        minSimilarity: 0.7,
      });

      const target: DeltaTarget = { id: "target", type: ObjectType.BLOB, size: 100 };
      const candidates: string[] = [];
      for await (const c of finder.findCandidates(target)) {
        candidates.push(c.id);
      }

      expect(candidates).toContain("exact");
      expect(candidates).not.toContain("far");
    });
  });
});
