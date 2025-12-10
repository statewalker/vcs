import type { ObjectId, ObjectStorage } from "@webrun-vcs/storage";
import { beforeEach, describe, expect, it } from "vitest";
import { CommitWindowCandidateStrategy } from "../src/strategies/commit-window-candidate.js";
import { SimilarSizeCandidateStrategy } from "../src/strategies/similar-size-candidate.js";

/**
 * Mock ObjectStorage for testing candidate strategies
 */
class MockObjectStorage implements ObjectStorage {
  private objects: Map<ObjectId, Uint8Array> = new Map();

  addObject(id: ObjectId, content: Uint8Array): void {
    this.objects.set(id, content);
  }

  addObjectWithSize(id: ObjectId, size: number): void {
    this.objects.set(id, new Uint8Array(size));
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

describe("SimilarSizeCandidateStrategy", () => {
  let storage: MockObjectStorage;
  let strategy: SimilarSizeCandidateStrategy;

  beforeEach(() => {
    storage = new MockObjectStorage();
    strategy = new SimilarSizeCandidateStrategy();
  });

  it("should have correct name", () => {
    expect(strategy.name).toBe("similar-size");
  });

  it("should find objects with similar sizes", async () => {
    // Add objects with various sizes
    storage.addObjectWithSize("obj100", 100);
    storage.addObjectWithSize("obj105", 105);
    storage.addObjectWithSize("obj110", 110);
    storage.addObjectWithSize("obj500", 500);
    storage.addObjectWithSize("obj1000", 1000);
    storage.addObjectWithSize("target", 100);

    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", storage)) {
      candidates.push(id);
    }

    // Should find objects close to size 100
    expect(candidates).toContain("obj100");
    expect(candidates).toContain("obj105");
    expect(candidates).toContain("obj110");

    // Should not include very different sizes (500, 1000 with 50% tolerance)
    expect(candidates).not.toContain("obj500");
    expect(candidates).not.toContain("obj1000");
  });

  it("should not include target in candidates", async () => {
    storage.addObjectWithSize("target", 100);
    storage.addObjectWithSize("other", 100);

    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", storage)) {
      candidates.push(id);
    }

    expect(candidates).not.toContain("target");
    expect(candidates).toContain("other");
  });

  it("should respect limit from context", async () => {
    // Add many objects with similar sizes
    for (let i = 0; i < 20; i++) {
      storage.addObjectWithSize(`obj${i}`, 100 + i);
    }
    storage.addObjectWithSize("target", 100);

    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", storage, { limit: 5 })) {
      candidates.push(id);
    }

    expect(candidates.length).toBeLessThanOrEqual(5);
  });

  it("should sort by size difference (closest first)", async () => {
    storage.addObjectWithSize("obj90", 90);
    storage.addObjectWithSize("obj100", 100);
    storage.addObjectWithSize("obj120", 120);
    storage.addObjectWithSize("target", 100);

    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", storage)) {
      candidates.push(id);
    }

    // obj100 should be first (same size), then obj90/obj120
    expect(candidates[0]).toBe("obj100");
  });

  it("should return empty for non-existent target", async () => {
    storage.addObjectWithSize("obj1", 100);

    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("nonexistent", storage)) {
      candidates.push(id);
    }

    expect(candidates).toHaveLength(0);
  });

  it("should respect custom tolerance", async () => {
    const strictStrategy = new SimilarSizeCandidateStrategy({ tolerance: 0.1 }); // 10% tolerance

    storage.addObjectWithSize("obj95", 95);
    storage.addObjectWithSize("obj105", 105);
    storage.addObjectWithSize("obj120", 120);
    storage.addObjectWithSize("target", 100);

    const candidates: ObjectId[] = [];
    for await (const id of strictStrategy.findCandidates("target", storage)) {
      candidates.push(id);
    }

    // With 10% tolerance (90-110), should include obj95 and obj105, but not obj120
    expect(candidates).toContain("obj95");
    expect(candidates).toContain("obj105");
    expect(candidates).not.toContain("obj120");
  });
});

describe("CommitWindowCandidateStrategy", () => {
  let strategy: CommitWindowCandidateStrategy;

  beforeEach(() => {
    strategy = new CommitWindowCandidateStrategy({ windowSize: 10 });
  });

  it("should have correct name", () => {
    expect(strategy.name).toBe("commit-window");
  });

  it("should return recently added objects", async () => {
    strategy.addFromCommit(["obj1", "obj2", "obj3"]);

    const mockStorage = new MockObjectStorage();
    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", mockStorage)) {
      candidates.push(id);
    }

    expect(candidates).toContain("obj1");
    expect(candidates).toContain("obj2");
    expect(candidates).toContain("obj3");
  });

  it("should return most recent first", async () => {
    strategy.addObject("old");
    strategy.addObject("medium");
    strategy.addObject("recent");

    const mockStorage = new MockObjectStorage();
    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", mockStorage)) {
      candidates.push(id);
    }

    // Most recent should be first
    expect(candidates[0]).toBe("recent");
    expect(candidates[1]).toBe("medium");
    expect(candidates[2]).toBe("old");
  });

  it("should not include target in candidates", async () => {
    strategy.addFromCommit(["target", "other1", "other2"]);

    const mockStorage = new MockObjectStorage();
    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", mockStorage)) {
      candidates.push(id);
    }

    expect(candidates).not.toContain("target");
    expect(candidates).toContain("other1");
    expect(candidates).toContain("other2");
  });

  it("should respect limit from context", async () => {
    for (let i = 0; i < 20; i++) {
      strategy.addObject(`obj${i}`);
    }

    const mockStorage = new MockObjectStorage();
    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", mockStorage, { limit: 5 })) {
      candidates.push(id);
    }

    expect(candidates.length).toBe(5);
  });

  it("should clear window", () => {
    strategy.addFromCommit(["obj1", "obj2"]);
    expect(strategy.getWindowLength()).toBe(2);

    strategy.clear();
    expect(strategy.getWindowLength()).toBe(0);
  });

  it("should maintain bounded window size", () => {
    // Add many objects to exceed the internal limit
    for (let i = 0; i < 200; i++) {
      strategy.addObject(`obj${i}`);
    }

    // Window should be bounded (10 * 10 = 100 max before pruning)
    expect(strategy.getWindowLength()).toBeLessThanOrEqual(100);
  });

  it("should handle empty window", async () => {
    const mockStorage = new MockObjectStorage();
    const candidates: ObjectId[] = [];
    for await (const id of strategy.findCandidates("target", mockStorage)) {
      candidates.push(id);
    }

    expect(candidates).toHaveLength(0);
  });
});
