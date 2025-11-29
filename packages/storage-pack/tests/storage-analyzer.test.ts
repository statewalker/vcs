import { describe, expect, it, beforeEach } from "vitest";
import { createMemoryStorage } from "@webrun-vcs/storage-mem";
import { StorageAnalyzer } from "../src/storage-analyzer.js";
import type { PackingContext } from "../src/types.js";

/**
 * Helper to convert string to async iterable
 */
async function* stringToAsyncIterable(str: string): AsyncIterable<Uint8Array> {
  yield new TextEncoder().encode(str);
}

/**
 * Create a minimal packing context with just objects storage
 */
function createTestContext(): PackingContext {
  const objects = createMemoryStorage({ hashAlgorithm: "SHA-1" });

  // Create minimal mock implementations for trees and commits
  const trees = {
    storeTree: async () => "",
    loadTree: async function* () {},
    getEntry: async () => undefined,
    hasTree: async () => false,
    getEmptyTreeId: () => "4b825dc642cb6eb9a060e54bf8d69288fbee4904",
  };

  const commits = {
    storeCommit: async () => "",
    loadCommit: async () => ({
      tree: "",
      parents: [],
      author: { name: "", email: "", timestamp: 0, tzOffset: "+0000" },
      committer: { name: "", email: "", timestamp: 0, tzOffset: "+0000" },
      message: "",
    }),
    getParents: async () => [],
    getTree: async () => "",
    walkAncestry: async function* () {},
    findMergeBase: async () => [],
    hasCommit: async () => false,
    isAncestor: async () => false,
  };

  return {
    objects: objects as any, // Type assertion for mock
    trees: trees as any,
    commits: commits as any,
  };
}

describe("StorageAnalyzer", () => {
  let analyzer: StorageAnalyzer;
  let context: PackingContext;

  beforeEach(() => {
    analyzer = new StorageAnalyzer();
    context = createTestContext();
  });

  describe("analyzeAll", () => {
    it("returns empty report for empty storage", async () => {
      const report = await analyzer.analyzeAll(context);

      expect(report.totalObjects).toBe(0);
      expect(report.fullObjects).toBe(0);
      expect(report.deltaObjects).toBe(0);
      expect(report.averageChainDepth).toBe(0);
      expect(report.maxChainDepth).toBe(0);
      expect(report.totalStorageSize).toBe(0);
      expect(report.packingCandidates).toHaveLength(0);
    });

    it("counts objects correctly", async () => {
      // Store some test objects
      await context.objects.store(stringToAsyncIterable("test content 1"));
      await context.objects.store(stringToAsyncIterable("test content 2"));
      await context.objects.store(stringToAsyncIterable("test content 3"));

      const report = await analyzer.analyzeAll(context);

      expect(report.totalObjects).toBe(3);
      expect(report.fullObjects).toBe(3);
      expect(report.deltaObjects).toBe(0);
    });

    it("reports correct storage size", async () => {
      const content = "hello world";
      await context.objects.store(stringToAsyncIterable(content));

      const report = await analyzer.analyzeAll(context);

      expect(report.totalStorageSize).toBe(content.length);
    });

    it("filters candidates by minimum size", async () => {
      // Small content (below 50 byte default)
      await context.objects.store(stringToAsyncIterable("tiny"));

      // Large content (above 50 bytes)
      const largeContent = "x".repeat(100);
      await context.objects.store(stringToAsyncIterable(largeContent));

      const report = await analyzer.analyzeAll(context, { minSize: 50 });

      // Only the large object should be a candidate
      expect(report.packingCandidates).toHaveLength(1);
      expect(report.packingCandidates[0].size).toBe(100);
    });

    it("supports custom minimum size", async () => {
      await context.objects.store(stringToAsyncIterable("12345"));
      await context.objects.store(stringToAsyncIterable("1234567890"));

      const report = await analyzer.analyzeAll(context, { minSize: 8 });

      expect(report.packingCandidates).toHaveLength(1);
      expect(report.packingCandidates[0].size).toBe(10);
    });

    it("supports cancellation", async () => {
      // Add some objects so the loop executes and checks the signal
      await context.objects.store(stringToAsyncIterable("content 1"));
      await context.objects.store(stringToAsyncIterable("content 2"));

      const controller = new AbortController();
      controller.abort();

      await expect(
        analyzer.analyzeAll(context, { signal: controller.signal })
      ).rejects.toThrow("Analysis aborted");
    });
  });
});
