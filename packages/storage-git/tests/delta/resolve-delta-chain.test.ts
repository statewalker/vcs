/**
 * Tests for delta chain resolution utilities
 *
 * Tests resolveDeltaChain, resolveDeltaChainToBytes, and objectExists functions.
 */

import type { Delta } from "@webrun-vcs/utils";
import type { DeltaInfo, DeltaStore, RawStore } from "@webrun-vcs/vcs/binary-storage";
import { describe, expect, it } from "vitest";

import {
  objectExists,
  resolveDeltaChain,
  resolveDeltaChainToBytes,
} from "../../src/delta/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Mock RawStore implementation for testing
 */
class MockRawStore implements RawStore {
  private readonly data = new Map<string, Uint8Array>();

  addObject(key: string, content: Uint8Array): void {
    this.data.set(key, content);
  }

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
 * Mock DeltaStore implementation for testing
 */
class MockDeltaStore implements DeltaStore {
  private readonly deltas = new Map<
    string,
    { baseKey: string; targetKey: string; delta: Delta[]; ratio: number }
  >();

  addDelta(targetKey: string, baseKey: string, delta: Delta[], ratio = 0.5): void {
    this.deltas.set(targetKey, { baseKey, targetKey, delta, ratio });
  }

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

  async getDeltaChainInfo(key: string): Promise<
    | {
        baseKey: string;
        targetKey: string;
        depth: number;
        originalSize: number;
        compressedSize: number;
        chain: string[];
      }
    | undefined
  > {
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

describe("objectExists", () => {
  it("returns true for objects in raw storage", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    raw.addObject("abc123", encoder.encode("Test"));

    expect(await objectExists("abc123", raw, delta)).toBe(true);
  });

  it("returns true for objects stored as delta", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    delta.addDelta("target", "base", []);

    expect(await objectExists("target", raw, delta)).toBe(true);
  });

  it("returns false for non-existent objects", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    expect(await objectExists("nonexistent", raw, delta)).toBe(false);
  });

  it("returns true when object is in both stores", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    raw.addObject("both", encoder.encode("Test"));
    delta.addDelta("both", "base", []);

    expect(await objectExists("both", raw, delta)).toBe(true);
  });
});

describe("resolveDeltaChain", () => {
  it("streams non-delta objects directly from raw storage", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    const content = encoder.encode("Direct content");
    raw.addObject("direct", content);

    const result = await collectBytes(resolveDeltaChain("direct", raw, delta));
    expect(decoder.decode(result)).toBe("Direct content");
  });

  it("throws for non-existent objects", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    await expect(async () => {
      await collectBytes(resolveDeltaChain("nonexistent", raw, delta));
    }).rejects.toThrow("Object not found: nonexistent");
  });

  it("handles empty objects from raw storage", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    raw.addObject("empty", new Uint8Array(0));

    const result = await collectBytes(resolveDeltaChain("empty", raw, delta));
    expect(result.length).toBe(0);
  });

  it("handles large objects from raw storage", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    const content = new Uint8Array(10000);
    for (let i = 0; i < content.length; i++) {
      content[i] = i % 256;
    }
    raw.addObject("large", content);

    const result = await collectBytes(resolveDeltaChain("large", raw, delta));
    expect(result).toEqual(content);
  });

  it("handles binary content from raw storage", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    const content = new Uint8Array([0x00, 0xff, 0x80, 0x7f, 0x01, 0xfe]);
    raw.addObject("binary", content);

    const result = await collectBytes(resolveDeltaChain("binary", raw, delta));
    expect(result).toEqual(content);
  });
});

describe("resolveDeltaChainToBytes", () => {
  it("returns content as single Uint8Array", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    const content = encoder.encode("Test content");
    raw.addObject("test", content);

    const result = await resolveDeltaChainToBytes("test", raw, delta);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(decoder.decode(result)).toBe("Test content");
  });

  it("handles empty content", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    raw.addObject("empty", new Uint8Array(0));

    const result = await resolveDeltaChainToBytes("empty", raw, delta);
    expect(result.length).toBe(0);
  });

  it("throws for non-existent objects", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    await expect(resolveDeltaChainToBytes("nonexistent", raw, delta)).rejects.toThrow(
      "Object not found",
    );
  });

  it("returns correct content for multiple calls", async () => {
    const raw = new MockRawStore();
    const delta = new MockDeltaStore();

    raw.addObject("obj1", encoder.encode("Content 1"));
    raw.addObject("obj2", encoder.encode("Content 2"));

    const result1 = await resolveDeltaChainToBytes("obj1", raw, delta);
    const result2 = await resolveDeltaChainToBytes("obj2", raw, delta);

    expect(decoder.decode(result1)).toBe("Content 1");
    expect(decoder.decode(result2)).toBe("Content 2");
  });
});
