import { createDeltaRanges, type DeltaRange } from "@statewalker/vcs-utils";
import type { Benchmark, BenchmarkConfig, BenchmarkResult, MetricResult } from "../types.js";
import { getEnvironmentInfo } from "../utils/environment.js";
import { generateMutatedTarget, generateRandomBytes, SeededRandom } from "../utils/random.js";

/**
 * Apply ranges to reconstruct target from source
 */
function applyRanges(source: Uint8Array, target: Uint8Array, ranges: DeltaRange[]): Uint8Array {
  const result: number[] = [];
  for (const range of ranges) {
    if (range.from === "source") {
      for (let i = 0; i < range.len; i++) {
        result.push(source[range.start + i]);
      }
    } else {
      for (let i = 0; i < range.len; i++) {
        result.push(target[range.start + i]);
      }
    }
  }
  return new Uint8Array(result);
}

/**
 * Run a single delta ranges test
 */
function runSingleTest(
  sourceSize: number,
  targetSize: number,
  mutationDegree: number,
  blockSize: number,
  minMatch: number,
  seed: number,
): MetricResult {
  const random = new SeededRandom(seed);

  // Generate test data
  const source = generateRandomBytes(sourceSize, random);
  const target = generateMutatedTarget(source, targetSize, mutationDegree, random);

  // Measure range generation time
  const genStart = performance.now();
  const ranges = Array.from(createDeltaRanges(source, target, blockSize, minMatch));
  const genEnd = performance.now();

  // Measure range application time
  const applyStart = performance.now();
  const reconstructed = applyRanges(source, target, ranges);
  const applyEnd = performance.now();

  // Verify correctness
  if (reconstructed.length !== target.length) {
    throw new Error(`Size mismatch: expected ${target.length}, got ${reconstructed.length}`);
  }
  for (let i = 0; i < target.length; i++) {
    if (reconstructed[i] !== target[i]) {
      throw new Error(`Mismatch at position ${i}: expected ${target[i]}, got ${reconstructed[i]}`);
    }
  }

  const rangeGenerationTimeMs = genEnd - genStart;
  const rangeApplicationTimeMs = applyEnd - applyStart;
  const totalTimeMs = rangeGenerationTimeMs + rangeApplicationTimeMs;

  // Calculate ranges size (approximate encoding size)
  const rangesSize = ranges.reduce((sum, r) => {
    // Approximate: each range has overhead (type, start, len)
    // source ranges: 1 byte type + 4 bytes start + 4 bytes len = 9 bytes
    // target ranges: 1 byte type + 4 bytes start + 4 bytes len + data = 9 + len bytes
    return sum + 9 + (r.from === "source" ? 0 : r.len);
  }, 0);

  return {
    testCase: `${sourceSize}B @ ${(mutationDegree * 100).toFixed(0)}%`,
    size: sourceSize,
    mutation: mutationDegree,
    durationMs: totalTimeMs,
    metrics: {
      genTimeMs: rangeGenerationTimeMs,
      applyTimeMs: rangeApplicationTimeMs,
      rangeCount: ranges.length,
      rangesSize,
      compressionRatio: rangesSize / targetSize,
    },
  };
}

/**
 * Delta ranges generation and application benchmark
 */
export const deltaRangesBenchmark: Benchmark = {
  name: "delta-ranges",
  description: "Delta range generation and application performance",

  async run(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const sizes =
      config.sizes.length > 0
        ? config.sizes
        : [10, 50, 100, 500, 1024, 5120, 10240, 51200, 102400, 128 * 1024, 512 * 1024, 1024 * 1024];
    const mutations =
      config.mutations.length > 0 ? config.mutations : [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0];
    const blockSize = 16;
    const minMatch = 16;

    const results: MetricResult[] = [];
    let successCount = 0;
    let errorCount = 0;
    const startTime = performance.now();

    // Warmup runs
    for (let w = 0; w < config.warmup; w++) {
      try {
        runSingleTest(1024, 1024, 0.5, blockSize, minMatch, 999);
      } catch {
        // Ignore warmup errors
      }
    }

    // Actual benchmark runs
    for (const size of sizes) {
      for (const mutation of mutations) {
        for (let iter = 0; iter < config.iterations; iter++) {
          try {
            const seed = size * 1000 + mutation * 100 + iter;
            const result = runSingleTest(size, size, mutation, blockSize, minMatch, seed);
            results.push(result);
            successCount++;

            if (config.verbose) {
              console.log(`  ${result.testCase}: ${result.durationMs.toFixed(3)}ms`);
            }
          } catch (error) {
            errorCount++;
            if (config.verbose) {
              console.error(
                `  Error at size=${size}, mutation=${mutation}: ` +
                  `${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
      }
    }

    const endTime = performance.now();

    return {
      name: this.name,
      description: this.description,
      timestamp: new Date(),
      environment: getEnvironmentInfo(),
      results,
      summary: {
        totalRuns: successCount + errorCount,
        successCount,
        errorCount,
        totalDurationMs: endTime - startTime,
      },
    };
  },
};
