/**
 * Tests for HybridTempStore
 */

import { describe, expect, it, vi } from "vitest";
import { collect } from "../../src/format/stream-utils.js";
import { HybridTempStore } from "../../src/stores/hybrid-temp-store.js";
import { MemoryTempStore } from "../../src/stores/memory-temp-store.js";

describe("HybridTempStore", () => {
  const encoder = new TextEncoder();

  async function* chunks(...strings: string[]): AsyncIterable<Uint8Array> {
    for (const s of strings) {
      yield encoder.encode(s);
    }
  }

  it("uses small store for small content", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const smallStoreSpy = vi.spyOn(smallStore, "store");
    const largeStoreSpy = vi.spyOn(largeStore, "store");

    const hybrid = new HybridTempStore(smallStore, largeStore, 100);

    await hybrid.store(chunks("Small"));

    expect(smallStoreSpy).toHaveBeenCalled();
    expect(largeStoreSpy).not.toHaveBeenCalled();
  });

  it("uses large store for large content", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const smallStoreSpy = vi.spyOn(smallStore, "store");
    const largeStoreSpy = vi.spyOn(largeStore, "store");

    const hybrid = new HybridTempStore(smallStore, largeStore, 10);

    // Content larger than threshold (10 bytes)
    await hybrid.store(chunks("This is a longer string"));

    expect(smallStoreSpy).not.toHaveBeenCalled();
    expect(largeStoreSpy).toHaveBeenCalled();
  });

  it("preserves content when using small store", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const hybrid = new HybridTempStore(smallStore, largeStore, 100);

    const content = await hybrid.store(chunks("Hello", " ", "World"));
    const result = await collect(content.read());

    expect(new TextDecoder().decode(result)).toBe("Hello World");
  });

  it("preserves content when using large store", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const hybrid = new HybridTempStore(smallStore, largeStore, 5);

    const content = await hybrid.store(chunks("Hello", " ", "World"));
    const result = await collect(content.read());

    expect(new TextDecoder().decode(result)).toBe("Hello World");
  });

  it("reports correct size for small content", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const hybrid = new HybridTempStore(smallStore, largeStore, 100);

    const content = await hybrid.store(chunks("Test"));

    expect(content.size).toBe(4);
  });

  it("reports correct size for large content", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const hybrid = new HybridTempStore(smallStore, largeStore, 5);

    const content = await hybrid.store(chunks("Hello World"));

    expect(content.size).toBe(11);
  });

  it("uses default threshold of 1MB", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const smallStoreSpy = vi.spyOn(smallStore, "store");

    const hybrid = new HybridTempStore(smallStore, largeStore);

    // 100KB should stay in small store with 1MB threshold
    const chunk = new Uint8Array(100 * 1024).fill(42);
    async function* largeContent(): AsyncIterable<Uint8Array> {
      yield chunk;
    }

    await hybrid.store(largeContent());

    expect(smallStoreSpy).toHaveBeenCalled();
  });

  it("spills at exact threshold boundary", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const smallStoreSpy = vi.spyOn(smallStore, "store");
    const largeStoreSpy = vi.spyOn(largeStore, "store");

    const hybrid = new HybridTempStore(smallStore, largeStore, 10);

    // Exactly at threshold should not spill
    const content = await hybrid.store(chunks("1234567890"));

    expect(content.size).toBe(10);
    expect(smallStoreSpy).toHaveBeenCalled();
    expect(largeStoreSpy).not.toHaveBeenCalled();
  });

  it("spills when exceeding threshold", async () => {
    const smallStore = new MemoryTempStore();
    const largeStore = new MemoryTempStore();
    const largeStoreSpy = vi.spyOn(largeStore, "store");

    const hybrid = new HybridTempStore(smallStore, largeStore, 10);

    // Just over threshold should spill
    const content = await hybrid.store(chunks("12345678901"));

    expect(content.size).toBe(11);
    expect(largeStoreSpy).toHaveBeenCalled();
  });
});
