/**
 * Step 6: Write Performance Results
 *
 * Writes detailed performance metrics to a JSON file.
 *
 * Run with: pnpm step:results
 */

import * as fs from "node:fs/promises";
import {
  type CommitInfo,
  formatDuration,
  GIT_REPO_URL,
  listPackFiles,
  PERF_OUTPUT_FILE,
  type PerformanceResults,
  type PerformanceTracker,
  printBanner,
  printInfo,
  printSection,
} from "../shared/index.js";

export async function writePerformanceResults(
  tracker: PerformanceTracker,
  commits: CommitInfo[],
  objectCount: number,
): Promise<void> {
  printSection("Step 6: Write Performance Results");

  const packs = await listPackFiles();
  const totalPackSize = packs.reduce((sum, p) => sum + p.size, 0);

  const results: PerformanceResults = {
    timestamp: new Date().toISOString(),
    repository: GIT_REPO_URL,
    commitCount: commits.length,
    metrics: tracker.getMetrics(),
    commits: commits,
    summary: {
      totalDuration: tracker.getTotalDuration(),
      packFilesCount: packs.length,
      packFilesTotalSize: totalPackSize,
      objectCount: objectCount,
    },
  };

  await fs.writeFile(PERF_OUTPUT_FILE, JSON.stringify(results, null, 2));

  printInfo("Results written to", PERF_OUTPUT_FILE);
}

export function printSummary(tracker: PerformanceTracker, commits: CommitInfo[]): void {
  printSection("Performance Summary");

  const metrics = tracker.getMetrics();

  console.log("\n  Operation Timings:");
  console.log(`  ${"-".repeat(60)}`);

  for (const metric of metrics) {
    const paddedName = metric.name.padEnd(30);
    console.log(`  ${paddedName} ${formatDuration(metric.duration)}`);
  }

  console.log(`  ${"-".repeat(60)}`);
  console.log(`  ${"TOTAL".padEnd(30)} ${formatDuration(tracker.getTotalDuration())}`);

  // Calculate rates
  const traversalMetric = metrics.find((m) => m.name === "commit_traversal");
  if (traversalMetric && commits.length > 0) {
    const rate = commits.length / (traversalMetric.duration / 1000);
    console.log(`\n  Commit traversal rate: ${rate.toFixed(0)} commits/sec`);
  }

  const accessMetric = metrics.find((m) => m.name === "object_random_access");
  if (accessMetric) {
    const details = accessMetric.details as { sampleSize?: number } | undefined;
    if (details?.sampleSize) {
      const rate = details.sampleSize / (accessMetric.duration / 1000);
      console.log(`  Object access rate: ${rate.toFixed(0)} objects/sec`);
    }
  }
}

// Run as standalone script - shows how to use with existing data
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner("webrun-vcs: Write Performance Results", "Step 6 of 6");

  // When run standalone, just show info about what this step does
  console.log("  This step writes performance results to a JSON file.");
  console.log("  It requires metrics from previous steps to be meaningful.");
  console.log("");
  console.log("  To generate full results, run the complete benchmark:");
  console.log("    pnpm start");
  console.log("");
  console.log(`  Results will be written to: ${PERF_OUTPUT_FILE}\n`);
}
