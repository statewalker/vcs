/**
 * Step 5: Measure Object Access Performance
 *
 * Performs random access to a sample of commits and their tree objects
 * to measure pack index lookup and object decompression performance.
 *
 * Run with: pnpm step:measure
 */

import type { GitRepository } from "@webrun-vcs/storage-git";
import {
  type CommitInfo,
  openStorage,
  PerformanceTracker,
  printBanner,
  printInfo,
  printSection,
} from "../shared/index.js";
import { traverseCommits } from "./04-traverse-commits.js";

export interface AccessMeasurementResult {
  objectCount: number;
  treeCount: number;
  blobCount: number;
}

export async function measureObjectAccess(
  repository: GitRepository,
  commits: CommitInfo[],
  tracker?: PerformanceTracker,
): Promise<AccessMeasurementResult> {
  const perf = tracker ?? new PerformanceTracker();

  printSection("Step 5: Measure Object Access Performance");

  // Sample commits for detailed measurements
  const sampleSize = Math.min(100, commits.length);
  const sampleIndices = Array.from({ length: sampleSize }, (_, i) =>
    Math.floor((i * commits.length) / sampleSize),
  );

  let objectCount = 0;
  let treeCount = 0;
  let blobCount = 0;

  await perf.measureAsync(
    "object_random_access",
    async () => {
      for (const idx of sampleIndices) {
        const commitInfo = commits[idx];
        // Use high-level CommitStore API
        const commit = await repository.commits.loadCommit(commitInfo.id);
        objectCount++;

        // Load tree entries using high-level TreeStore API
        for await (const entry of repository.trees.loadTree(commit.tree)) {
          treeCount++;
          // Just count entries, don't load blob content
          if (entry.mode !== 0o040000) {
            blobCount++;
          }
        }
      }
    },
    { sampleSize, objectCount },
  );

  printInfo("Commits accessed", sampleSize);
  printInfo("Tree entries enumerated", treeCount);
  printInfo("Blob entries found", blobCount);

  return { objectCount, treeCount, blobCount };
}

// Run as standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner("webrun-vcs: Measure Object Access", "Step 5 of 6");
  openStorage()
    .then(async (repository) => {
      console.log("  First, traversing commits to get sample data...\n");
      const commits = await traverseCommits(repository);
      const result = await measureObjectAccess(repository, commits);
      console.log(`\n  Step 5 completed successfully!`);
      console.log(`  Accessed ${result.objectCount + result.treeCount} objects total.\n`);
      await repository.close();
    })
    .catch((error) => {
      console.error("\nError:", error);
      process.exit(1);
    });
}
