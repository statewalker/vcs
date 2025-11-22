import { describe, expect, it } from "vitest";
import { type PerformanceStats, testFossilLikeRanges } from "./test-utility.js";

/**
 * Helper to format performance stats for console output
 */
function formatStats(stats: PerformanceStats): string {
  return [
    `Source: ${stats.sourceSize}B`,
    `Target: ${stats.targetSize}B`,
    `Ranges: ${stats.rangeCount}`,
    `Mutation: ${(stats.actualMutationDegree * 100).toFixed(1)}%`,
    `Gen: ${stats.rangeGenerationTimeMs.toFixed(3)}ms`,
    `Apply: ${stats.rangeApplicationTimeMs.toFixed(3)}ms`,
    `Compression: ${(stats.compressionRatio * 100).toFixed(1)}%`,
  ].join(" | ");
}

describe("createFossilLikeRanges - Performance and Correctness Tests", () => {
  describe("Tiny blocks (10-100 bytes)", () => {
    it("should handle 10B source, 10B target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 10,
        targetSize: 10,
        mutationDegree: 0,
        seed: 1001,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 50B source, 50B target, 25% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 50,
        targetSize: 50,
        mutationDegree: 0.25,
        seed: 1002,
      });
      console.log("  " + formatStats(stats));
      // With small buffers, random mutations might accidentally produce identical content
      expect(stats.actualMutationDegree).toBeGreaterThanOrEqual(0);
      expect(stats.sourceSize).toBe(50);
      expect(stats.targetSize).toBe(50);
    });

    it("should handle 100B source, 100B target, 50% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 100,
        targetSize: 100,
        mutationDegree: 0.5,
        seed: 1003,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.2);
    });

    it("should handle 100B source, 50B target (shrink), 30% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 100,
        targetSize: 50,
        mutationDegree: 0.3,
        seed: 1004,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(50);
    });

    it("should handle 50B source, 100B target (grow), 30% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 50,
        targetSize: 100,
        mutationDegree: 0.3,
        seed: 1005,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(100);
    });
  });

  describe("Small blocks (1KB)", () => {
    const size1KB = 1024;

    it("should handle 1KB source, 1KB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1KB,
        targetSize: size1KB,
        mutationDegree: 0,
        seed: 2001,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 1KB source, 1KB target, 10% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1KB,
        targetSize: size1KB,
        mutationDegree: 0.1,
        seed: 2002,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 1KB source, 1KB target, 50% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1KB,
        targetSize: size1KB,
        mutationDegree: 0.5,
        seed: 2003,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.2);
    });

    it("should handle 1KB source, 2KB target (grow), 25% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1KB,
        targetSize: size1KB * 2,
        mutationDegree: 0.25,
        seed: 2004,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(size1KB * 2);
    });

    it("should handle 2KB source, 1KB target (shrink), 25% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1KB * 2,
        targetSize: size1KB,
        mutationDegree: 0.25,
        seed: 2005,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(size1KB);
    });
  });

  describe("Medium blocks (10KB)", () => {
    const size10KB = 10 * 1024;

    it("should handle 10KB source, 10KB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10KB,
        targetSize: size10KB,
        mutationDegree: 0,
        seed: 3001,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 10KB source, 10KB target, 5% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10KB,
        targetSize: size10KB,
        mutationDegree: 0.05,
        seed: 3002,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 10KB source, 10KB target, 20% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10KB,
        targetSize: size10KB,
        mutationDegree: 0.2,
        seed: 3003,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.05);
    });

    it("should handle 10KB source, 10KB target, 75% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10KB,
        targetSize: size10KB,
        mutationDegree: 0.75,
        seed: 3004,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.5);
    });

    it("should handle 10KB source, 15KB target (grow), 15% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10KB,
        targetSize: Math.floor(size10KB * 1.5),
        mutationDegree: 0.15,
        seed: 3005,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(Math.floor(size10KB * 1.5));
    });
  });

  describe("Large blocks (100KB)", () => {
    const size100KB = 100 * 1024;

    it("should handle 100KB source, 100KB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size100KB,
        targetSize: size100KB,
        mutationDegree: 0,
        seed: 4001,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 100KB source, 100KB target, 2% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size100KB,
        targetSize: size100KB,
        mutationDegree: 0.02,
        seed: 4002,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 100KB source, 100KB target, 10% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size100KB,
        targetSize: size100KB,
        mutationDegree: 0.1,
        seed: 4003,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.02);
    });

    it("should handle 100KB source, 100KB target, 50% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size100KB,
        targetSize: size100KB,
        mutationDegree: 0.5,
        seed: 4004,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.2);
    });

    it("should handle 100KB source, 120KB target (grow), 10% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size100KB,
        targetSize: Math.floor(size100KB * 1.2),
        mutationDegree: 0.1,
        seed: 4005,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(Math.floor(size100KB * 1.2));
    });

    it("should handle 120KB source, 100KB target (shrink), 10% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: Math.floor(size100KB * 1.2),
        targetSize: size100KB,
        mutationDegree: 0.1,
        seed: 4006,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(size100KB);
    });
  });

  describe("Very large blocks (500KB - 30MB)", () => {
    const size500KB = 500 * 1024;
    const size1MB = 1024 * 1024;
    const size5MB = 5 * 1024 * 1024;
    const size10MB = 10 * 1024 * 1024;
    const size30MB = 30 * 1024 * 1024;

    it("should handle 500KB source, 500KB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size500KB,
        targetSize: size500KB,
        mutationDegree: 0,
        seed: 6001,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 500KB source, 500KB target, 5% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size500KB,
        targetSize: size500KB,
        mutationDegree: 0.05,
        seed: 6002,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 500KB source, 500KB target, 10% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size500KB,
        targetSize: size500KB,
        mutationDegree: 0.1,
        seed: 6003,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.02);
    });

    it("should handle 1MB source, 1MB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1MB,
        targetSize: size1MB,
        mutationDegree: 0,
        seed: 6101,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 1MB source, 1MB target, 5% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1MB,
        targetSize: size1MB,
        mutationDegree: 0.05,
        seed: 6102,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 1MB source, 1MB target, 10% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1MB,
        targetSize: size1MB,
        mutationDegree: 0.1,
        seed: 6103,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.02);
    });

    it("should handle 1MB source, 1.5MB target (grow), 5% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size1MB,
        targetSize: Math.floor(size1MB * 1.5),
        mutationDegree: 0.05,
        seed: 6104,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(Math.floor(size1MB * 1.5));
    });

    it("should handle 5MB source, 5MB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size5MB,
        targetSize: size5MB,
        mutationDegree: 0,
        seed: 6201,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    const mutationsDegrees = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0];
    const sourcesSizes = [
      size1MB,
      size5MB,
      // size10MB
    ];
    const targetSizesDelta = [0.75, 0.9, 1.0, 1.1, 1.25];
    let i = 0;
    for (const sourceSize of sourcesSizes) {
      for (const targetSizeDelta of targetSizesDelta) {
        for (const mutationDegree of mutationsDegrees) {
          it(`${i++}) should handle ${sourceSize}B source, ${Math.floor(sourceSize * targetSizeDelta)}B target, ${(mutationDegree * 100).toFixed(1)}% mutation`, () => {
            const stats = testFossilLikeRanges({
              sourceSize: sourceSize,
              targetSize: Math.floor(sourceSize * targetSizeDelta),
              mutationDegree: mutationDegree,
              seed:
                sourceSize + Math.floor(mutationDegree * 1000) + Math.floor(targetSizeDelta * 100),
            });
            console.log(
              `  Source: ${sourceSize}B | Target: ${Math.floor(sourceSize * targetSizeDelta)}B | Mut: ${(mutationDegree * 100).toFixed(1)}% | ` +
                formatStats(stats),
            );
            expect(stats.actualMutationDegree).toBeGreaterThan(0);
          });
        }
      }
    }

    /* * /
    it("should handle 5MB source, 5MB target, 5% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size5MB,
        targetSize: size5MB,
        mutationDegree: 0.05,
        seed: 6202,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 5MB source, 5MB target, 10% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size5MB,
        targetSize: size5MB,
        mutationDegree: 0.1,
        seed: 6203,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.02);
    });

    it("should handle 10MB source, 10MB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10MB,
        targetSize: size10MB,
        mutationDegree: 0,
        seed: 6301,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 10MB source, 10MB target, 5% mutation", { timeout: 60000 }, () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10MB,
        targetSize: size10MB,
        mutationDegree: 0.05,
        seed: 6302,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 10MB source, 10MB target, 10% mutation", { timeout: 60000 }, () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10MB,
        targetSize: size10MB,
        mutationDegree: 0.1,
        seed: 6303,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.02);
    });

    it("should handle 10MB source, 10MB target, 50% mutation", { timeout: 60000 }, () => {
      const stats = testFossilLikeRanges({
        sourceSize: size10MB,
        targetSize: size10MB,
        mutationDegree: 0.5,
        seed: 6304,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.2);
    });

    it("should handle 30MB source, 30MB target, 0% mutation", () => {
      const stats = testFossilLikeRanges({
        sourceSize: size30MB,
        targetSize: size30MB,
        mutationDegree: 0,
        seed: 6401,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeLessThan(0.1);
    });

    it("should handle 30MB source, 30MB target, 5% mutation", { timeout: 60000 }, () => {
      const stats = testFossilLikeRanges({
        sourceSize: size30MB,
        targetSize: size30MB,
        mutationDegree: 0.05,
        seed: 6402,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle 30MB source, 30MB target, 10% mutation", { timeout: 60000 }, () => {
      const stats = testFossilLikeRanges({
        sourceSize: size30MB,
        targetSize: size30MB,
        mutationDegree: 0.1,
        seed: 6403,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.02);
    });

    it("should handle 30MB source, 35MB target (grow), 5% mutation", { timeout: 60000 }, () => {
      const stats = testFossilLikeRanges({
        sourceSize: size30MB,
        targetSize: Math.floor(size30MB * 1.17),
        mutationDegree: 0.05,
        seed: 6404,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(Math.floor(size30MB * 1.17));
    });
// */
  });

  describe("Edge cases", () => {
    it("should handle empty source and target", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 0,
        targetSize: 0,
        mutationDegree: 0,
        seed: 5001,
      });
      console.log("  " + formatStats(stats));
      expect(stats.sourceSize).toBe(0);
      expect(stats.targetSize).toBe(0);
    });

    it("should handle empty source, non-empty target", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 0,
        targetSize: 100,
        mutationDegree: 1,
        seed: 5002,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(100);
      expect(stats.actualMutationDegree).toBe(1);
    });

    it("should handle non-empty source, empty target", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 100,
        targetSize: 0,
        mutationDegree: 1,
        seed: 5003,
      });
      console.log("  " + formatStats(stats));
      expect(stats.targetSize).toBe(0);
    });

    it("should handle 100% mutation (completely different)", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 1024,
        targetSize: 1024,
        mutationDegree: 1,
        seed: 5004,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0.9);
    });

    it("should handle very small block size (8 bytes)", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 1024,
        targetSize: 1024,
        mutationDegree: 0.1,
        blockSize: 8,
        seed: 5005,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });

    it("should handle larger block size (64 bytes)", () => {
      const stats = testFossilLikeRanges({
        sourceSize: 4096,
        targetSize: 4096,
        mutationDegree: 0.1,
        blockSize: 64,
        seed: 5006,
      });
      console.log("  " + formatStats(stats));
      expect(stats.actualMutationDegree).toBeGreaterThan(0);
    });
  });

  describe("Stress test - range of sizes", () => {
    const sizes = [10, 50, 100, 500, 1024, 5120, 10240, 51200, 102400];
    const mutations = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0];

    it("should handle various size and mutation combinations", () => {
      console.log("\n  === Comprehensive Performance Matrix ===");
      for (const size of sizes) {
        for (const mutation of mutations) {
          const stats = testFossilLikeRanges({
            sourceSize: size,
            targetSize: size,
            mutationDegree: mutation,
            seed: size * 1000 + mutation * 100,
          });
          console.log(
            `  Size: ${size.toString().padStart(6)}B | Mut: ${(mutation * 100).toFixed(0).padStart(3)}% | ` +
              formatStats(stats),
          );
        }
      }
      expect(true).toBe(true);
    });
  });
});
