/**
 * Tests for delta storage interfaces
 *
 * These are type-level tests to ensure interfaces are correctly defined.
 * Runtime tests are in implementation packages.
 */

import type { Delta } from "@webrun-vcs/diff";
import { describe, expect, it } from "vitest";
import type {
  CandidateContext,
  DeltaBackendStats,
  DeltaCandidateStrategy,
  DeltaChainDetails,
  DeltaComputeOptions,
  DeltaComputeResult,
  DeltaComputeStrategy,
  ObjectId,
  ObjectStorage,
  PackingSuggestion,
  RepackOptions,
  RepackResult,
  RepositoryAnalysis,
  StoredDelta,
} from "../src/index.js";

describe("Delta Storage Interfaces", () => {
  describe("DeltaCandidateStrategy", () => {
    it("should define DeltaCandidateStrategy interface correctly", () => {
      // Type check - this test passes if it compiles
      const mockStrategy: DeltaCandidateStrategy = {
        name: "test-candidate",
        async *findCandidates(
          _targetId: ObjectId,
          _storage: ObjectStorage,
          _context?: CandidateContext,
        ): AsyncIterable<ObjectId> {
          yield "abc123def456";
          yield "789xyz000111";
        },
      };

      expect(mockStrategy.name).toBe("test-candidate");
    });

    it("should support CandidateContext options", () => {
      const context: CandidateContext = {
        currentDepth: 5,
        pathHint: "src/index.ts",
        limit: 10,
        commitId: "commitabc123",
      };

      expect(context.currentDepth).toBe(5);
      expect(context.pathHint).toBe("src/index.ts");
      expect(context.limit).toBe(10);
      expect(context.commitId).toBe("commitabc123");
    });
  });

  describe("DeltaComputeStrategy", () => {
    it("should define DeltaComputeStrategy interface correctly", () => {
      const mockStrategy: DeltaComputeStrategy = {
        name: "test-compute",
        computeDelta: (
          _base: Uint8Array,
          _target: Uint8Array,
          _options?: DeltaComputeOptions,
        ): DeltaComputeResult | null => {
          return {
            delta: [
              { type: "start", targetLen: 100 },
              { type: "copy", start: 0, len: 50 },
              { type: "insert", data: new Uint8Array([1, 2, 3]) },
              { type: "finish", checksum: 12345 },
            ],
            ratio: 0.5,
            targetSize: 100,
            baseSize: 100,
          };
        },
        applyDelta: (base: Uint8Array, _delta: Iterable<Delta>): Uint8Array => {
          return base;
        },
        estimateSize: (_delta: Iterable<Delta>): number => {
          return 50;
        },
      };

      expect(mockStrategy.name).toBe("test-compute");

      const result = mockStrategy.computeDelta(new Uint8Array(100), new Uint8Array(100));
      expect(result).not.toBeNull();
      expect(result?.ratio).toBe(0.5);
    });

    it("should support DeltaComputeOptions", () => {
      const options: DeltaComputeOptions = {
        minSize: 50,
        maxRatio: 0.75,
        maxChainDepth: 50,
      };

      expect(options.minSize).toBe(50);
      expect(options.maxRatio).toBe(0.75);
      expect(options.maxChainDepth).toBe(50);
    });
  });

  describe("DeltaBackend", () => {
    it("should define StoredDelta interface correctly", () => {
      const storedDelta: StoredDelta = {
        targetId: "target123",
        baseId: "base456",
        delta: [
          { type: "start", targetLen: 100 },
          { type: "copy", start: 0, len: 50 },
          { type: "finish", checksum: 12345 },
        ],
        ratio: 0.5,
      };

      expect(storedDelta.targetId).toBe("target123");
      expect(storedDelta.baseId).toBe("base456");
      expect(Array.isArray(storedDelta.delta)).toBe(true);
      expect(storedDelta.ratio).toBe(0.5);
    });

    it("should define DeltaChainDetails interface correctly", () => {
      const chainDetails: DeltaChainDetails = {
        baseId: "base123",
        depth: 3,
        originalSize: 1000,
        compressedSize: 500,
        chain: ["target", "mid", "base123"],
      };

      expect(chainDetails.baseId).toBe("base123");
      expect(chainDetails.depth).toBe(3);
      expect(chainDetails.originalSize).toBe(1000);
      expect(chainDetails.compressedSize).toBe(500);
      expect(chainDetails.chain).toEqual(["target", "mid", "base123"]);
    });

    it("should define DeltaBackendStats interface correctly", () => {
      const stats: DeltaBackendStats = {
        deltaCount: 100,
        baseCount: 50,
        averageChainDepth: 2.5,
        maxChainDepth: 10,
        totalSize: 50000,
        extra: {
          packCount: 3,
          pendingWrites: 5,
        },
      };

      expect(stats.deltaCount).toBe(100);
      expect(stats.baseCount).toBe(50);
      expect(stats.averageChainDepth).toBe(2.5);
      expect(stats.maxChainDepth).toBe(10);
      expect(stats.totalSize).toBe(50000);
      expect(stats.extra?.packCount).toBe(3);
    });
  });

  describe("DeltaStorage", () => {
    it("should define RepositoryAnalysis interface correctly", () => {
      const analysis: RepositoryAnalysis = {
        totalObjects: 1000,
        looseObjects: 200,
        deltaObjects: 800,
        totalSize: 10000000,
        compressedSize: 3000000,
        potentialSavings: 500000,
        deltifiableCandidates: 150,
        averageChainDepth: 3.2,
        deepChains: 5,
      };

      expect(analysis.totalObjects).toBe(1000);
      expect(analysis.looseObjects).toBe(200);
      expect(analysis.deltaObjects).toBe(800);
      expect(analysis.potentialSavings).toBe(500000);
    });

    it("should define PackingSuggestion interface correctly", () => {
      const suggestion: PackingSuggestion = {
        candidates: [
          {
            targetId: "target1",
            suggestedBases: ["base1", "base2"],
            estimatedRatio: 0.6,
          },
          {
            targetId: "target2",
            suggestedBases: ["base3"],
            estimatedRatio: 0.4,
          },
        ],
        estimatedSavings: 100000,
        chainsToBreak: ["deep1", "deep2"],
      };

      expect(suggestion.candidates).toHaveLength(2);
      expect(suggestion.estimatedSavings).toBe(100000);
      expect(suggestion.chainsToBreak).toEqual(["deep1", "deep2"]);
    });

    it("should define RepackOptions interface correctly", () => {
      const options: RepackOptions = {
        maxChainDepth: 50,
        windowSize: 10,
        aggressive: true,
        pruneLoose: true,
        commitScope: "commitabc",
        onProgress: (phase, current, total) => {
          console.log(`${phase}: ${current}/${total}`);
        },
      };

      expect(options.maxChainDepth).toBe(50);
      expect(options.windowSize).toBe(10);
      expect(options.aggressive).toBe(true);
      expect(options.pruneLoose).toBe(true);
      expect(options.commitScope).toBe("commitabc");
      expect(typeof options.onProgress).toBe("function");
    });

    it("should define RepackResult interface correctly", () => {
      const result: RepackResult = {
        objectsProcessed: 500,
        deltasCreated: 300,
        deltasRemoved: 20,
        looseObjectsPruned: 180,
        spaceSaved: 1000000,
        duration: 5000,
      };

      expect(result.objectsProcessed).toBe(500);
      expect(result.deltasCreated).toBe(300);
      expect(result.deltasRemoved).toBe(20);
      expect(result.looseObjectsPruned).toBe(180);
      expect(result.spaceSaved).toBe(1000000);
      expect(result.duration).toBe(5000);
    });
  });
});
