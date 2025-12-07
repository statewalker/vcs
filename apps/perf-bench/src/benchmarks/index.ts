import type { Benchmark } from "../types.js";
import { binaryDeltaBenchmark } from "./binary-delta.js";
import { deltaRangesBenchmark } from "./delta-ranges.js";

/**
 * Registry of all available benchmarks
 */
export const benchmarks: Map<string, Benchmark> = new Map([
  [binaryDeltaBenchmark.name, binaryDeltaBenchmark],
  [deltaRangesBenchmark.name, deltaRangesBenchmark],
]);

/**
 * Get a benchmark by name
 */
export function getBenchmark(name: string): Benchmark | undefined {
  return benchmarks.get(name);
}

/**
 * Get all benchmark names
 */
export function getBenchmarkNames(): string[] {
  return Array.from(benchmarks.keys());
}

/**
 * List benchmarks with descriptions
 */
export function listBenchmarks(): void {
  console.log("\nAvailable benchmarks:\n");
  for (const [name, benchmark] of benchmarks) {
    console.log(`  ${name.padEnd(20)} ${benchmark.description}`);
  }
  console.log("");
}
