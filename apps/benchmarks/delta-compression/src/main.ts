/**
 * Delta Compression Benchmark
 *
 * Measures performance of delta encoding and decoding algorithms
 * across various file sizes and mutation rates.
 *
 * Run with: pnpm start
 */

import {
  applyDelta,
  createDelta,
  createDeltaRanges,
  serializeDeltaToGit,
} from "@statewalker/vcs-utils/diff";

// ============================================================================
// Content Generation
// ============================================================================

/**
 * Creates reproducible pseudo-random content
 */
function createRandomContent(size: number, seed: number): Uint8Array {
  const buffer = new Uint8Array(size);
  let state = seed;

  for (let i = 0; i < size; i++) {
    // Simple LCG random number generator
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    buffer[i] = state & 0xff;
  }

  return buffer;
}

/**
 * Creates mutated version of content with specified mutation rate
 */
function mutateContent(source: Uint8Array, mutationRate: number, seed: number): Uint8Array {
  const target = new Uint8Array(source.length);
  let state = seed;

  for (let i = 0; i < source.length; i++) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const shouldMutate = (state & 0xffff) / 0xffff < mutationRate;

    if (shouldMutate) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      target[i] = state & 0xff;
    } else {
      target[i] = source[i];
    }
  }

  return target;
}

// ============================================================================
// Benchmark Utilities
// ============================================================================

interface BenchmarkResult {
  sourceSize: number;
  targetSize: number;
  mutationRate: number;
  deltaSize: number;
  compressionRatio: number;
  encodeTimeMs: number;
  decodeTimeMs: number;
  verifyOk: boolean;
}

function runSingleBenchmark(
  source: Uint8Array,
  target: Uint8Array,
  mutationRate: number,
): BenchmarkResult {
  // Encode: create delta ranges, then deltas, then serialize to Git format
  const encodeStart = performance.now();
  const ranges = createDeltaRanges(source, target, 16);
  const deltas = [...createDelta(source, target, ranges)];
  const encoded = serializeDeltaToGit(deltas);
  const encodeTimeMs = performance.now() - encodeStart;

  // Decode: apply the original deltas (with valid checksums)
  // We measure decode time using the original deltas since Git format
  // doesn't preserve Fossil checksums
  const decodeStart = performance.now();
  const chunks: Uint8Array[] = [];
  for (const chunk of applyDelta(source, deltas)) {
    chunks.push(chunk);
  }
  // Get target length from start instruction
  let targetLength = 0;
  for (const d of deltas) {
    if (d.type === "start") {
      targetLength = d.targetLen;
      break;
    }
  }
  const result = new Uint8Array(targetLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  const decodeTimeMs = performance.now() - decodeStart;

  // Verify correctness
  const verifyOk = result.length === target.length && result.every((b, i) => b === target[i]);

  return {
    sourceSize: source.length,
    targetSize: target.length,
    mutationRate,
    deltaSize: encoded.length,
    compressionRatio: encoded.length / target.length,
    encodeTimeMs,
    decodeTimeMs,
    verifyOk,
  };
}

// ============================================================================
// Formatting Utilities
// ============================================================================

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function formatMs(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

function padLeft(str: string, len: number): string {
  return str.padStart(len);
}

// ============================================================================
// Main Benchmark
// ============================================================================

console.log("=".repeat(80));
console.log("  Delta Compression Benchmark");
console.log("=".repeat(80));
console.log();

// Configuration
const sizes = [
  1024, // 1KB
  10 * 1024, // 10KB
  50 * 1024, // 50KB
  100 * 1024, // 100KB
  500 * 1024, // 500KB
  1024 * 1024, // 1MB
];

const mutationRates = [0, 0.01, 0.05, 0.1, 0.25, 0.5, 1.0];

// Run benchmarks
console.log("Running benchmarks across different sizes and mutation rates...");
console.log();

// Table header
const header = [
  padLeft("Size", 10),
  padLeft("Mutation", 10),
  padLeft("Delta", 10),
  padLeft("Ratio", 8),
  padLeft("Encode", 10),
  padLeft("Decode", 10),
  padLeft("Total", 10),
  padLeft("Throughput", 12),
  " Status",
].join(" | ");

console.log("-".repeat(header.length));
console.log(header);
console.log("-".repeat(header.length));

const allResults: BenchmarkResult[] = [];
let successCount = 0;
let failCount = 0;

for (const size of sizes) {
  const source = createRandomContent(size, 12345);

  for (const mutation of mutationRates) {
    const target = mutateContent(source, mutation, 67890 + mutation * 1000);

    try {
      const result = runSingleBenchmark(source, target, mutation);
      allResults.push(result);

      const totalTimeMs = result.encodeTimeMs + result.decodeTimeMs;
      const throughputMBps = size / (1024 * 1024) / (totalTimeMs / 1000);

      const row = [
        padLeft(formatSize(size), 10),
        padLeft(formatPercent(mutation), 10),
        padLeft(formatSize(result.deltaSize), 10),
        padLeft(formatPercent(result.compressionRatio), 8),
        padLeft(formatMs(result.encodeTimeMs), 10),
        padLeft(formatMs(result.decodeTimeMs), 10),
        padLeft(formatMs(totalTimeMs), 10),
        padLeft(`${throughputMBps.toFixed(2)} MB/s`, 12),
        result.verifyOk ? " OK" : " FAIL",
      ].join(" | ");

      console.log(row);

      if (result.verifyOk) {
        successCount++;
      } else {
        failCount++;
      }
    } catch (error) {
      failCount++;
      console.log(
        `${padLeft(formatSize(size), 10)} | ${padLeft(formatPercent(mutation), 10)} | ERROR: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

console.log("-".repeat(header.length));

// Summary statistics
console.log();
console.log("=".repeat(80));
console.log("  Summary");
console.log("=".repeat(80));
console.log();
console.log(`Total benchmarks: ${allResults.length}`);
console.log(`Passed: ${successCount}`);
console.log(`Failed: ${failCount}`);

// Calculate averages by mutation rate
console.log();
console.log("Average compression ratio by mutation rate:");
for (const mutation of mutationRates) {
  const matching = allResults.filter((r) => r.mutationRate === mutation);
  if (matching.length > 0) {
    const avgRatio = matching.reduce((sum, r) => sum + r.compressionRatio, 0) / matching.length;
    console.log(
      `  ${formatPercent(mutation).padStart(6)} mutation: ${formatPercent(avgRatio)} of original`,
    );
  }
}

// Calculate averages by size
console.log();
console.log("Average encode+decode time by size (0% mutation):");
for (const size of sizes) {
  const matching = allResults.filter((r) => r.sourceSize === size && r.mutationRate === 0);
  if (matching.length > 0) {
    const avgTime =
      matching.reduce((sum, r) => sum + r.encodeTimeMs + r.decodeTimeMs, 0) / matching.length;
    console.log(`  ${formatSize(size).padStart(8)}: ${formatMs(avgTime)}`);
  }
}

console.log();
console.log("=".repeat(80));
console.log("  Benchmark Complete");
console.log("=".repeat(80));
