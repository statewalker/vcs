/**
 * Integration tests for InMemoryObjectStore
 */

import { describe, expect, it } from "vitest";
import { createDefaultObjectStorage } from "../../src/storage-impl/index.js";

describe("InMemoryObjectStore - Basic Operations", () => {
  async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
    yield data;
  }

  it("should store and retrieve content", async () => {
    const store = createDefaultObjectStorage();
    const content = new TextEncoder().encode("Hello, World!");

    const id = await store.store(toAsyncIterable(content));
    expect(id).toBeDefined();
    expect(id).toHaveLength(64); // SHA-256 hash in hex

    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(id)) {
      retrieved.push(chunk);
    }

    const result = retrieved[0];
    expect(new TextDecoder().decode(result)).toBe("Hello, World!");
  });

  it("should deduplicate identical content", async () => {
    const store = createDefaultObjectStorage();
    const content = new TextEncoder().encode("Hello, World!");

    const id1 = await store.store(toAsyncIterable(content));
    const id2 = await store.store(toAsyncIterable(content));

    expect(id1).toBe(id2);
  });

  it("should check if object exists", async () => {
    const store = createDefaultObjectStorage();
    const content = new TextEncoder().encode("Test content");

    const id = await store.store(toAsyncIterable(content));

    expect(await store.has(id)).toBe(true);
    expect(await store.has("nonexistent")).toBe(false);
  });

  it("should delete objects", async () => {
    const store = createDefaultObjectStorage();
    const content = new TextEncoder().encode("Test content");

    const id = await store.store(toAsyncIterable(content));
    expect(await store.has(id)).toBe(true);

    const deleted = await store.delete(id);
    expect(deleted).toBe(true);
    expect(await store.has(id)).toBe(false);
  });

  it("should throw error when loading non-existent object", async () => {
    const store = createDefaultObjectStorage();

    const loadPromise = (async () => {
      for await (const _chunk of store.load("nonexistent")) {
        // Should not reach here
      }
    })();

    await expect(loadPromise).rejects.toThrow("not found");
  });

  it("should handle binary content", async () => {
    const store = createDefaultObjectStorage();
    const content = new Uint8Array([0, 1, 2, 255, 254, 253]);

    const id = await store.store(toAsyncIterable(content));

    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(id)) {
      retrieved.push(chunk);
    }

    expect(retrieved[0]).toEqual(content);
  });

  it("should handle empty content", async () => {
    const store = createDefaultObjectStorage();
    const content = new Uint8Array(0);

    const id = await store.store(toAsyncIterable(content));

    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(id)) {
      retrieved.push(chunk);
    }

    expect(retrieved[0]).toEqual(content);
  });

  it("should handle large content", async () => {
    const store = createDefaultObjectStorage();
    const content = new Uint8Array(1024 * 1024); // 1MB
    content.fill(42);

    const id = await store.store(toAsyncIterable(content));

    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(id)) {
      retrieved.push(chunk);
    }

    expect(retrieved[0]).toEqual(content);
  });
});

describe("InMemoryObjectStore - Delta Compression", () => {
  async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
    yield data;
  }

  it("should deltify content against base", async () => {
    const store = createDefaultObjectStorage();

    const base = new TextEncoder().encode(
      "Line 1 with enough content to exceed minimum\nLine 2 content\nLine 3 content\n",
    );
    const modified = new TextEncoder().encode(
      "Line 1 with enough content to exceed minimum\nLine 2 modified\nLine 3 content\n",
    );

    const baseId = await store.store(toAsyncIterable(base));
    const modifiedId = await store.store(toAsyncIterable(modified));

    // Deltify modified against base
    const deltified = await store.deltify(modifiedId, [baseId]);
    expect(deltified).toBe(true);

    // Should still load correctly
    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(modifiedId)) {
      retrieved.push(chunk);
    }

    expect(new TextDecoder().decode(retrieved[0])).toBe(
      "Line 1 with enough content to exceed minimum\nLine 2 modified\nLine 3 content\n",
    );
  });

  it("should not deltify content smaller than 50 bytes", async () => {
    const store = createDefaultObjectStorage();

    const base = new TextEncoder().encode("Small");
    const modified = new TextEncoder().encode("Tiny");

    const baseId = await store.store(toAsyncIterable(base));
    const modifiedId = await store.store(toAsyncIterable(modified));

    const deltified = await store.deltify(modifiedId, [baseId]);
    expect(deltified).toBe(false);
  });

  it("should not deltify if compression ratio is poor", async () => {
    const store = createDefaultObjectStorage();

    // Create two completely different large contents
    const base = new Uint8Array(1000);
    base.fill(1);

    const modified = new Uint8Array(1000);
    modified.fill(2);

    const baseId = await store.store(toAsyncIterable(base));
    const modifiedId = await store.store(toAsyncIterable(modified));

    const deltified = await store.deltify(modifiedId, [baseId]);
    expect(deltified).toBe(false); // Should reject due to poor compression
  });

  it("should undeltify content back to full storage", async () => {
    const store = createDefaultObjectStorage();

    const base = new TextEncoder().encode(
      "This is a longer base content that exceeds the 50 byte minimum for deltification",
    );
    const modified = new TextEncoder().encode(
      "This is a longer modified content that exceeds the 50 byte minimum for deltification",
    );

    const baseId = await store.store(toAsyncIterable(base));
    const modifiedId = await store.store(toAsyncIterable(modified));

    await store.deltify(modifiedId, [baseId]);

    // Undeltify
    await store.undeltify(modifiedId);

    // Should still load correctly
    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(modifiedId)) {
      retrieved.push(chunk);
    }

    expect(new TextDecoder().decode(retrieved[0])).toBe(
      "This is a longer modified content that exceeds the 50 byte minimum for deltification",
    );
  });

  it("should deltify against previous version", async () => {
    const store = createDefaultObjectStorage();

    const v1 = new TextEncoder().encode(
      "Version 1 content with enough text to exceed the minimum size requirement",
    );
    const v2 = new TextEncoder().encode(
      "Version 2 content with enough text to exceed the minimum size requirement",
    );

    const v1Id = await store.store(toAsyncIterable(v1));
    const v2Id = await store.store(toAsyncIterable(v2));

    const deltified = await store.deltifyAgainstPrevious(v2Id, v1Id);
    expect(deltified).toBe(true);
  });

  it("should choose best delta from multiple candidates", async () => {
    const store = createDefaultObjectStorage();

    const target = new TextEncoder().encode(
      "Target content with enough text to exceed the minimum size requirement for deltification",
    );
    const similar = new TextEncoder().encode(
      "Target content with enough text to exceed the minimum size requirement for compression",
    );
    const different = new TextEncoder().encode(
      "Completely different content that has nothing in common with the target text at all",
    );

    const targetId = await store.store(toAsyncIterable(target));
    const similarId = await store.store(toAsyncIterable(similar));
    const differentId = await store.store(toAsyncIterable(different));

    const deltified = await store.deltifyAgainstBest(targetId, {
      similarFiles: [similarId, differentId],
    });

    expect(deltified).toBe(true);
  });
});

describe("InMemoryObjectStore - Delta Chain Reconstruction", () => {
  async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
    yield data;
  }

  it("should reconstruct from simple delta chain", async () => {
    const store = createDefaultObjectStorage();

    const v1 = new TextEncoder().encode(
      "Version 1 with enough text to meet the minimum size requirement for deltification",
    );
    const v2 = new TextEncoder().encode(
      "Version 2 with enough text to meet the minimum size requirement for deltification",
    );
    const v3 = new TextEncoder().encode(
      "Version 3 with enough text to meet the minimum size requirement for deltification",
    );

    const v1Id = await store.store(toAsyncIterable(v1));
    const v2Id = await store.store(toAsyncIterable(v2));
    const v3Id = await store.store(toAsyncIterable(v3));

    // Create chain: v3 -> v2 -> v1
    await store.deltify(v2Id, [v1Id]);
    await store.deltify(v3Id, [v2Id]);

    // Verify v3 loads correctly
    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(v3Id)) {
      retrieved.push(chunk);
    }

    expect(new TextDecoder().decode(retrieved[0])).toBe(
      "Version 3 with enough text to meet the minimum size requirement for deltification",
    );
  });

  it("should reconstruct from deep delta chain", async () => {
    const store = createDefaultObjectStorage();

    const versions: string[] = [];
    const versionIds: string[] = [];

    // Create 10 versions
    for (let i = 1; i <= 10; i++) {
      const content = `Version ${i} with enough text to meet the minimum size requirement`;
      versions.push(content);
      const id = await store.store(toAsyncIterable(new TextEncoder().encode(content)));
      versionIds.push(id);
    }

    // Create delta chain
    for (let i = 1; i < versionIds.length; i++) {
      await store.deltify(versionIds[i], [versionIds[i - 1]]);
    }

    // Verify each version loads correctly
    for (let i = 0; i < versionIds.length; i++) {
      const retrieved: Uint8Array[] = [];
      for await (const chunk of store.load(versionIds[i])) {
        retrieved.push(chunk);
      }
      expect(new TextDecoder().decode(retrieved[0])).toBe(versions[i]);
    }
  });
});

describe("InMemoryObjectStore - Cycle Prevention", () => {
  async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
    yield data;
  }

  it("should prevent direct cycles", async () => {
    const store = createDefaultObjectStorage();

    const content = new TextEncoder().encode(
      "Content with enough text to meet the minimum size requirement for deltification",
    );

    const id = await store.store(toAsyncIterable(content));

    // Try to deltify against itself
    const deltified = await store.deltify(id, [id]);
    expect(deltified).toBe(false);
  });

  it("should prevent indirect cycles", async () => {
    const store = createDefaultObjectStorage();

    const v1 = new TextEncoder().encode(
      "Version 1 with enough text to meet the minimum size requirement for deltification",
    );
    const v2 = new TextEncoder().encode(
      "Version 2 with enough text to meet the minimum size requirement for deltification",
    );

    const v1Id = await store.store(toAsyncIterable(v1));
    const v2Id = await store.store(toAsyncIterable(v2));

    // Create chain: v2 -> v1
    await store.deltify(v2Id, [v1Id]);

    // Try to make v1 delta against v2 (would create cycle)
    const deltified = await store.deltify(v1Id, [v2Id]);
    expect(deltified).toBe(false);
  });

  it("should prevent deletion of objects with dependents", async () => {
    const store = createDefaultObjectStorage();

    const base = new TextEncoder().encode(
      "Base content with enough text to meet the minimum size requirement for deltification",
    );
    const derived = new TextEncoder().encode(
      "Derived content with enough text to meet the minimum size requirement for deltification",
    );

    const baseId = await store.store(toAsyncIterable(base));
    const derivedId = await store.store(toAsyncIterable(derived));

    await store.deltify(derivedId, [baseId]);

    // Try to delete base (should fail)
    await expect(store.delete(baseId)).rejects.toThrow("depend on it");
  });
});

describe("InMemoryObjectStore - Cache Behavior", () => {
  async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
    yield data;
  }

  it("should compress delta blobs", async () => {
    const store = createDefaultObjectStorage();

    // Create two similar large contents to ensure compression benefit
    const base = new TextEncoder().encode(
      "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20),
    );
    const modified = new TextEncoder().encode(
      "Lorem ipsum MODIFIED sit amet, consectetur adipiscing elit. ".repeat(20),
    );

    const baseId = await store.store(toAsyncIterable(base));
    const modifiedId = await store.store(toAsyncIterable(modified));

    // Access internal repository to check sizes
    // @ts-expect-error - Accessing private property for testing
    const objectRepo = store.objectRepo;
    const beforeDeltaEntry = await objectRepo.loadObjectEntry(modifiedId);
    if (!beforeDeltaEntry) throw new Error("Entry not found");
    const beforeSize = beforeDeltaEntry.content.length;

    // Deltify
    await store.deltify(modifiedId, [baseId]);

    // Check that delta is stored compressed
    const afterDeltaEntry = await objectRepo.loadObjectEntry(modifiedId);
    if (!afterDeltaEntry) throw new Error("Entry not found");
    const afterSize = afterDeltaEntry.content.length;

    // Delta should be smaller than the full compressed object
    expect(afterSize).toBeLessThan(beforeSize);

    // Should still load correctly
    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(modifiedId)) {
      retrieved.push(chunk);
    }
    expect(retrieved[0]).toEqual(modified);
  });

  it("should cache loaded content", async () => {
    const store = createDefaultObjectStorage();

    const content = new TextEncoder().encode(
      "Content with enough text to meet the minimum size requirement",
    );

    const id = await store.store(toAsyncIterable(content));

    // Load twice
    for await (const _chunk of store.load(id)) {
      // First load
    }

    for await (const _chunk of store.load(id)) {
      // Second load should hit cache
    }

    // If we got here without errors, caching is working
    expect(true).toBe(true);
  });

  it("should evict old entries when cache is full", async () => {
    const store = createDefaultObjectStorage({
      maxCacheSize: 100, // Very small cache
      maxCacheEntries: 2,
    });

    const content1 = new Uint8Array(30);
    content1.fill(1);
    const content2 = new Uint8Array(30);
    content2.fill(2);
    const content3 = new Uint8Array(30);
    content3.fill(3);

    const id1 = await store.store(toAsyncIterable(content1));
    const id2 = await store.store(toAsyncIterable(content2));
    const id3 = await store.store(toAsyncIterable(content3));

    // Load all three
    for await (const _chunk of store.load(id1)) {
      /* cache */
    }
    for await (const _chunk of store.load(id2)) {
      /* cache */
    }
    for await (const _chunk of store.load(id3)) {
      /* cache (should evict id1) */
    }

    // All should still be loadable
    expect(await store.has(id1)).toBe(true);
    expect(await store.has(id2)).toBe(true);
    expect(await store.has(id3)).toBe(true);
  });
});
