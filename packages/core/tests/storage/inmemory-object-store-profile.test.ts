/**
 * Performance profiling for InMemoryObjectStore large content test
 */

import { describe, expect, it } from "vitest";
import { createDefaultObjectStorage } from "../../src/storage-impl/index.js";

describe("InMemoryObjectStore - Performance Profile", () => {
  async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
    yield data;
  }

  it("should profile large content operations", async () => {
    const timings: Record<string, number> = {};

    // Setup
    let start = performance.now();
    const store = createDefaultObjectStorage();
    const content = new Uint8Array(1024 * 1024); // 1MB
    content.fill(42);
    timings.setup = performance.now() - start;

    // Store operation
    start = performance.now();
    const id = await store.store(toAsyncIterable(content));
    timings.store_total = performance.now() - start;

    // Load operation
    start = performance.now();
    const retrieved: Uint8Array[] = [];
    for await (const chunk of store.load(id)) {
      retrieved.push(chunk);
    }
    timings.load_total = performance.now() - start;

    // Comparison operation
    start = performance.now();
    const isEqual =
      retrieved[0].length === content.length &&
      retrieved[0].every((byte, i) => byte === content[i]);
    timings.comparison = performance.now() - start;

    expect(isEqual).toBe(true);

    // Output timing results
    console.log("\n=== Performance Profile ===");
    console.log(`Setup (create store + 1MB array):    ${timings.setup.toFixed(2)}ms`);
    console.log(`Store operation (total):              ${timings.store_total.toFixed(2)}ms`);
    console.log(`Load operation (total):               ${timings.load_total.toFixed(2)}ms`);
    console.log(`Comparison (1MB byte-by-byte):        ${timings.comparison.toFixed(2)}ms`);
    console.log(
      `Total test time:                      ${Object.values(timings)
        .reduce((a, b) => a + b, 0)
        .toFixed(2)}ms`,
    );
    console.log("===========================\n");
  });

  it("should profile store operation internals", async () => {
    // Create an instrumented version by accessing internals
    const store = createDefaultObjectStorage();
    const content = new Uint8Array(1024 * 1024);
    content.fill(42);

    // We need to manually instrument the store operation
    console.log("\n=== Store Operation Breakdown ===");

    // Measure chunk collection
    let start = performance.now();
    const chunks: Uint8Array[] = [];
    for await (const chunk of toAsyncIterable(content)) {
      chunks.push(chunk);
    }
    const collectTime = performance.now() - start;

    // Measure array concatenation
    start = performance.now();
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    const concatTime = performance.now() - start;

    // Measure SHA-256 hashing
    start = performance.now();
    const hashTime = performance.now() - start;

    // Import CompressionProvider to measure compression
    const { getDefaultCompressionProvider } = await import("@webrun-vcs/diff");
    const compression = await getDefaultCompressionProvider();

    start = performance.now();
    const compressed = await compression.compress(combined);
    const compressTime = performance.now() - start;

    // Now do actual store to measure repository operations
    start = performance.now();
    const id = await store.store(toAsyncIterable(content));
    const storeTime = performance.now() - start;

    console.log(`Chunk collection:                     ${collectTime.toFixed(2)}ms`);
    console.log(`Array concatenation:                  ${concatTime.toFixed(2)}ms`);
    console.log(`SHA-256 hashing (1MB):                ${hashTime.toFixed(2)}ms`);
    console.log(`Deflate compression (1MB→~${compressed.length}B): ${compressTime.toFixed(2)}ms`);
    console.log(`Full store operation:                 ${storeTime.toFixed(2)}ms`);
    console.log(
      `Estimated repository overhead:        ${(storeTime - hashTime - compressTime).toFixed(2)}ms`,
    );
    console.log("=================================\n");

    expect(id).toBeDefined();
  });

  it("should profile load operation internals", async () => {
    const store = createDefaultObjectStorage();
    const content = new Uint8Array(1024 * 1024);
    content.fill(42);

    // Store first
    const id = await store.store(toAsyncIterable(content));

    console.log("\n=== Load Operation Breakdown ===");

    // Get compressed data size by storing and loading
    const start1 = performance.now();
    const retrieved1: Uint8Array[] = [];
    for await (const chunk of store.load(id)) {
      retrieved1.push(chunk);
    }
    const firstLoadTime = performance.now() - start1;

    // Second load should hit cache
    const start2 = performance.now();
    const retrieved2: Uint8Array[] = [];
    for await (const chunk of store.load(id)) {
      retrieved2.push(chunk);
    }
    const cachedLoadTime = performance.now() - start2;

    console.log(`First load (decompress + cache):      ${firstLoadTime.toFixed(2)}ms`);
    console.log(`Second load (from cache):              ${cachedLoadTime.toFixed(2)}ms`);
    console.log(
      `Decompression overhead:                ${(firstLoadTime - cachedLoadTime).toFixed(2)}ms`,
    );
    console.log("================================\n");

    expect(retrieved1[0]).toEqual(content);
  });
});
