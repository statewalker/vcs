import {
  BinaryComparator,
  BinarySequence,
  decodeGitBinaryDelta,
  Edit,
  encodeGitBinaryDelta,
  MyersDiff,
} from "@webrun-vcs/diff";
import type { Benchmark, BenchmarkConfig, BenchmarkResult, MetricResult } from "../types.js";
import { getEnvironmentInfo } from "../utils/environment.js";
import { generateMutatedTarget, generateRandomBytes, SeededRandom } from "../utils/random.js";

/**
 * Run a single binary delta test
 */
function runSingleTest(
  sourceSize: number,
  targetSize: number,
  mutationDegree: number,
  blockSize: number,
  seed: number,
): MetricResult {
  const random = new SeededRandom(seed);

  // Generate test data
  const source = generateRandomBytes(sourceSize, random);
  const target = generateMutatedTarget(source, targetSize, mutationDegree, random);

  // Create binary sequences for Myers diff
  const seqA = new BinarySequence(source, blockSize);
  const seqB = new BinarySequence(target, blockSize);
  const comparator = new BinaryComparator();

  // Measure diff time
  const diffStart = performance.now();
  const blockEdits = MyersDiff.diff(comparator, seqA, seqB);
  const diffEnd = performance.now();

  // Convert block-based edits to byte-based edits
  const byteEdits = blockEdits.map((edit) => {
    const beginA = edit.beginA * blockSize;
    const endA = Math.min(edit.endA * blockSize, source.length);
    const beginB = edit.beginB * blockSize;
    const endB = Math.min(edit.endB * blockSize, target.length);
    return new Edit(beginA, endA, beginB, endB);
  });

  // Measure encode time
  const encodeStart = performance.now();
  const delta = encodeGitBinaryDelta(source, target, byteEdits);
  const encodeEnd = performance.now();

  // Measure decode time
  const decodeStart = performance.now();
  const reconstructed = decodeGitBinaryDelta(source, delta);
  const decodeEnd = performance.now();

  // Verify correctness
  if (reconstructed.length !== target.length) {
    throw new Error(`Size mismatch: expected ${target.length}, got ${reconstructed.length}`);
  }
  for (let i = 0; i < target.length; i++) {
    if (reconstructed[i] !== target[i]) {
      throw new Error(`Mismatch at position ${i}: expected ${target[i]}, got ${reconstructed[i]}`);
    }
  }

  const diffTimeMs = diffEnd - diffStart;
  const encodeTimeMs = encodeEnd - encodeStart;
  const decodeTimeMs = decodeEnd - decodeStart;
  const totalTimeMs = diffTimeMs + encodeTimeMs + decodeTimeMs;

  return {
    testCase: `${sourceSize}B @ ${(mutationDegree * 100).toFixed(0)}%`,
    size: sourceSize,
    mutation: mutationDegree,
    durationMs: totalTimeMs,
    metrics: {
      diffTimeMs,
      encodeTimeMs,
      decodeTimeMs,
      deltaSize: delta.length,
      compressionRatio: delta.length / targetSize,
      editCount: blockEdits.length,
    },
  };
}

/**
 * Binary delta encoding/decoding benchmark
 */
export const binaryDeltaBenchmark: Benchmark = {
  name: "binary-delta",
  description: "Binary delta encoding/decoding performance using Myers diff",

  async run(config: BenchmarkConfig): Promise<BenchmarkResult> {
    const sizes =
      config.sizes.length > 0 ? config.sizes : [10, 50, 100, 500, 1024, 5120, 10240, 51200, 102400];
    const mutations =
      config.mutations.length > 0 ? config.mutations : [0, 0.05, 0.1, 0.25, 0.5, 0.75, 1.0];
    const blockSize = 16;

    const results: MetricResult[] = [];
    let successCount = 0;
    let errorCount = 0;
    const startTime = performance.now();

    // Warmup runs
    for (let w = 0; w < config.warmup; w++) {
      try {
        runSingleTest(1024, 1024, 0.5, blockSize, 999);
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
            const result = runSingleTest(size, size, mutation, blockSize, seed);
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
