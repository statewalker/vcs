/**
 * Tests for InMemoryMetadataRepository
 */

import { describe, expect, it } from "vitest";
import { InMemoryMetadataRepository } from "../../src/storage/inmemory-metadata-repository.js";

describe("InMemoryMetadataRepository", () => {
  it("should record access", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.recordAccess("obj1");

    const metadata = await repo.getMetadata("obj1");
    expect(metadata).toBeDefined();
    expect(metadata?.objectId).toBe("obj1");
    expect(metadata?.accessCount).toBe(1);
  });

  it("should increment access count on repeated access", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.recordAccess("obj1");
    await repo.recordAccess("obj1");
    await repo.recordAccess("obj1");

    const metadata = await repo.getMetadata("obj1");
    expect(metadata?.accessCount).toBe(3);
  });

  it("should update last accessed timestamp", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.recordAccess("obj1");
    const metadata1 = await repo.getMetadata("obj1");
    const firstAccess = metadata1?.lastAccessed ?? 0;

    // Wait a bit
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repo.recordAccess("obj1");
    const metadata2 = await repo.getMetadata("obj1");
    const secondAccess = metadata2?.lastAccessed ?? 0;

    expect(secondAccess).toBeGreaterThan(firstAccess);
  });

  it("should get LRU candidates", async () => {
    const repo = new InMemoryMetadataRepository();

    // Record accesses with delays
    await repo.recordAccess("obj1");
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repo.recordAccess("obj2");
    await new Promise((resolve) => setTimeout(resolve, 10));

    await repo.recordAccess("obj3");

    // Get LRU candidates (oldest first)
    const candidates = await repo.getLRUCandidates(2);

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toBe("obj1"); // Oldest
    expect(candidates[1]).toBe("obj2");
  });

  it("should update size metadata", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.updateSize("obj1", 1000);

    const metadata = await repo.getMetadata("obj1");
    expect(metadata?.size).toBe(1000);
  });

  it("should calculate total size", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.updateSize("obj1", 1000);
    await repo.updateSize("obj2", 2000);
    await repo.updateSize("obj3", 3000);

    const totalSize = await repo.getTotalSize();
    expect(totalSize).toBe(6000);
  });

  it("should mark objects as hot", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.recordAccess("obj1");
    await repo.markHot("obj1");

    const hotObjects = await repo.getHotObjects(10);
    expect(hotObjects).toContain("obj1");
  });

  it("should mark objects as cold", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.recordAccess("obj1");
    await repo.markCold("obj1");

    // Hot objects should not contain obj1
    const hotObjects = await repo.getHotObjects(10);
    expect(hotObjects).not.toContain("obj1");
  });

  it("should toggle between hot and cold", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.recordAccess("obj1");
    await repo.markHot("obj1");

    let hotObjects = await repo.getHotObjects(10);
    expect(hotObjects).toContain("obj1");

    // Mark as cold
    await repo.markCold("obj1");

    hotObjects = await repo.getHotObjects(10);
    expect(hotObjects).not.toContain("obj1");
  });

  it("should get hot objects with limit", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.recordAccess("obj1");
    await repo.recordAccess("obj2");
    await repo.recordAccess("obj3");

    await repo.markHot("obj1");
    await repo.markHot("obj2");
    await repo.markHot("obj3");

    const hotObjects = await repo.getHotObjects(2);
    expect(hotObjects).toHaveLength(2);
  });

  it("should return undefined for non-tracked objects", async () => {
    const repo = new InMemoryMetadataRepository();

    const metadata = await repo.getMetadata("missing");
    expect(metadata).toBeUndefined();
  });

  it("should create metadata when updating size for new object", async () => {
    const repo = new InMemoryMetadataRepository();

    await repo.updateSize("obj1", 500);

    const metadata = await repo.getMetadata("obj1");
    expect(metadata).toBeDefined();
    expect(metadata?.size).toBe(500);
    expect(metadata?.accessCount).toBe(0); // Not accessed yet
  });
});
