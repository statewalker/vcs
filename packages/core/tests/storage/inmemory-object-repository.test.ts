/**
 * Tests for InMemoryObjectRepository
 */

import { describe, expect, it } from "vitest";
import { InMemoryObjectRepository } from "../../src/storage-impl/mem/object-repository.js";

describe("InMemoryObjectRepository", () => {
  it("should store and retrieve objects", async () => {
    const repo = new InMemoryObjectRepository();
    const content = new Uint8Array([1, 2, 3, 4]);

    const entry = await repo.storeObject({
      id: "abc123",
      size: 100,
      content,
      created: Date.now(),
      accessed: Date.now(),
    });

    expect(entry.recordId).toBe(1); // First entry gets recordId 1

    const retrieved = await repo.loadObjectEntry("abc123");
    expect(retrieved).toEqual(entry);
  });

  it("should assign sequential record IDs", async () => {
    const repo = new InMemoryObjectRepository();

    const entry1 = await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: Date.now(),
      accessed: Date.now(),
    });

    const entry2 = await repo.storeObject({
      id: "obj2",
      size: 20,
      content: new Uint8Array([2]),
      created: Date.now(),
      accessed: Date.now(),
    });

    expect(entry1.recordId).toBe(1);
    expect(entry2.recordId).toBe(2);
  });

  it("should preserve record ID when updating existing object", async () => {
    const repo = new InMemoryObjectRepository();

    const entry1 = await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: 1000,
      accessed: 1000,
    });

    const recordId = entry1.recordId;

    // Update with same ID
    const entry2 = await repo.storeObject({
      id: "obj1",
      size: 20,
      content: new Uint8Array([1, 2]),
      created: 2000,
      accessed: 2000,
    });

    expect(entry2.recordId).toBe(recordId);
    expect(entry2.size).toBe(20);
    expect(entry2.content).toEqual(new Uint8Array([1, 2]));
  });

  it("should retrieve object by record ID", async () => {
    const repo = new InMemoryObjectRepository();

    const entry = await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: Date.now(),
      accessed: Date.now(),
    });

    const retrieved = await repo.loadObjectByRecordId(entry.recordId);
    expect(retrieved).toEqual(entry);
  });

  it("should retrieve object content by record ID", async () => {
    const repo = new InMemoryObjectRepository();
    const content = new Uint8Array([1, 2, 3, 4, 5]);

    const entry = await repo.storeObject({
      id: "obj1",
      size: 5,
      content,
      created: Date.now(),
      accessed: Date.now(),
    });

    const retrieved = await repo.loadObjectContent(entry.recordId);
    expect(retrieved).toEqual(content);
  });

  it("should return undefined for non-existent objects", async () => {
    const repo = new InMemoryObjectRepository();

    expect(await repo.loadObjectEntry("missing")).toBeUndefined();
    expect(await repo.loadObjectByRecordId(999)).toBeUndefined();
    expect(await repo.loadObjectContent(999)).toBeUndefined();
  });

  it("should check if object exists", async () => {
    const repo = new InMemoryObjectRepository();

    await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: Date.now(),
      accessed: Date.now(),
    });

    expect(await repo.hasObject("obj1")).toBe(true);
    expect(await repo.hasObject("missing")).toBe(false);
  });

  it("should delete objects", async () => {
    const repo = new InMemoryObjectRepository();

    const entry = await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: Date.now(),
      accessed: Date.now(),
    });

    expect(await repo.hasObject("obj1")).toBe(true);

    const deleted = await repo.deleteObject("obj1");
    expect(deleted).toBe(true);

    expect(await repo.hasObject("obj1")).toBe(false);
    expect(await repo.loadObjectByRecordId(entry.recordId)).toBeUndefined();
  });

  it("should return false when deleting non-existent object", async () => {
    const repo = new InMemoryObjectRepository();
    const deleted = await repo.deleteObject("missing");
    expect(deleted).toBe(false);
  });

  it("should get multiple objects", async () => {
    const repo = new InMemoryObjectRepository();

    const entry1 = await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: Date.now(),
      accessed: Date.now(),
    });

    const entry2 = await repo.storeObject({
      id: "obj2",
      size: 20,
      content: new Uint8Array([2]),
      created: Date.now(),
      accessed: Date.now(),
    });

    const entries = await repo.getMany(["obj1", "obj2", "obj3"]);

    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual(entry1);
    expect(entries).toContainEqual(entry2);
  });

  it("should return repository size", async () => {
    const repo = new InMemoryObjectRepository();

    expect(await repo.size()).toBe(0);

    await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: Date.now(),
      accessed: Date.now(),
    });

    expect(await repo.size()).toBe(1);

    await repo.storeObject({
      id: "obj2",
      size: 20,
      content: new Uint8Array([2]),
      created: Date.now(),
      accessed: Date.now(),
    });

    expect(await repo.size()).toBe(2);
  });

  it("should get all object IDs", async () => {
    const repo = new InMemoryObjectRepository();

    await repo.storeObject({
      id: "obj1",
      size: 10,
      content: new Uint8Array([1]),
      created: Date.now(),
      accessed: Date.now(),
    });

    await repo.storeObject({
      id: "obj2",
      size: 20,
      content: new Uint8Array([2]),
      created: Date.now(),
      accessed: Date.now(),
    });

    const ids = await repo.getAllIds();
    expect(ids).toHaveLength(2);
    expect(ids).toContain("obj1");
    expect(ids).toContain("obj2");
  });
});
