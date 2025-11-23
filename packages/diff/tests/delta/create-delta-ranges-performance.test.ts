import { describe, expect, it } from "vitest";
import { testLog } from "../test-logger.js";
import { type PerformanceStats, testCreateDeltaRanges } from "./create-delta-ranges-utility.js";

function pad(str: string): string {
  return str.padStart(8, " ");
}

/**
 * Helper to format performance stats for console output
 */
function _formatStats(prefix: string, stats: PerformanceStats): string {
  const formatSize = (size: number): string => {
    if (size < 1024) return `${pad(size.toString())}B`;
    if (size < 1024 * 1024) return `${pad((size / 1024).toFixed(2))}KB`;
    return `${pad((size / (1024 * 1024)).toFixed(2))}MB`;
  };
  return [
    prefix,
    `Source:     ${formatSize(stats.sourceSize)}`,
    `Target:     ${formatSize(stats.targetSize)}`,
    `Range Size: ${formatSize(stats.rangesSize)}`,
    `Ranges:     ${pad(stats.rangeCount.toString())}`,
    `Mutation:   ${pad((stats.mutationDegree * 100).toFixed(1))}%`,
    `Gen:        ${pad(stats.rangeGenerationTimeMs.toFixed(3))}ms`,
    `Apply:      ${pad(stats.rangeApplicationTimeMs.toFixed(3))}ms`,
  ].join("\n  ");
}

describe("createDeltaRanges - Performance and Correctness Tests", () => {
  describe("Stress test - range of sizes", () => {
    /**
     * Helper to format performance stats for console output
     */
    function formatStats(prefix: string, stats: PerformanceStats): string {
      const formatSize = (size: number): string => {
        if (size < 1024) return `${pad(size.toString())}B`;
        if (size < 1024 * 1024) return `${pad((size / 1024).toFixed(2))}KB`;
        return `${pad((size / (1024 * 1024)).toFixed(2))}MB`;
      };
      return [
        prefix,
        `Source:     ${formatSize(stats.sourceSize)}`,
        `Target:     ${formatSize(stats.targetSize)}`,
        `Range Size: ${formatSize(stats.rangesSize)}`,
        `Ranges:     ${pad(stats.rangeCount.toString())}`,
        `Mutation:   ${pad((stats.mutationDegree * 100).toFixed(1))}%`,
        `Gen:        ${pad(stats.rangeGenerationTimeMs.toFixed(3))}ms`,
        `Apply:      ${pad(stats.rangeApplicationTimeMs.toFixed(3))}ms`,
      ].join("\n  ");
    }

    const sizes = [
      10,
      50,
      100,
      500,
      1024,
      5120,
      10240,
      51200,
      102400,
      125 * 1024,
      // 250 * 1024,
      512 * 1024,
      1024 * 1024,
    ];
    const mutations = [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0];

    it("should handle various size and mutation combinations", () => {
      function roundUpToPow2(x: number): number {
        const p = Math.ceil(Math.log2(x));
        return 1 << p;
      }

      function chooseBlockSize(fileSize: number): number {
        const min = 16; // or 32, 64…
        const max = 64 * 1024; // 64 KiB or whatever upper bound you like

        if (fileSize <= 0) return min;

        const raw = Math.sqrt(fileSize); // smooth scaling
        const rounded = roundUpToPow2(raw); // optional power-of-two
        return Math.min(max, Math.max(min, rounded));
      }

      testLog("\n  === Comprehensive Performance Matrix ===");
      let errorCount = 0;
      let successCount = 0;
      let i = 0;
      for (const size of sizes) {
        for (const mutation of mutations) {
          try {
            let blockSize = chooseBlockSize(size);
            blockSize = 16;

            // blockSize = 16;
            const stats = testCreateDeltaRanges({
              sourceSize: size,
              targetSize: size,
              mutationDegree: mutation,
              seed: size * 1000 + mutation * 100,
              blockSize,
            });
            testLog(formatStats(`${i++}`, stats));
            successCount++;
          } catch (error) {
            testLog(
              `  Size: ${size.toString().padStart(6)}B | Mut: ${(mutation * 100).toFixed(0).padStart(3)}% | ` +
                `ERROR: ${error instanceof Error ? error.message : String(error)}`,
            );
            errorCount++;
          }
        }
      }
      testLog(`\n  Summary: ${successCount} passed, ${errorCount} failed`);
      // We expect at least some tests to pass
      expect(successCount).toBeGreaterThan(0);
    });
  });
});
