/**
 * Performance Benchmark: Git Source Repository Analysis
 *
 * This script runs all benchmark steps in sequence:
 * 1. Clone the git source repository
 * 2. Run garbage collection to pack all objects
 * 3. Load pack files with webrun-vcs
 * 4. Traverse the last 1000 commits
 * 5. Measure object access performance
 * 6. Write performance results to file
 * 7. Checkout 3rd commit to local folder
 *
 * Run with: pnpm start
 *
 * Individual steps can be run separately:
 *   pnpm step:clone    - Clone repository
 *   pnpm step:gc       - Run garbage collection
 *   pnpm step:load     - Load pack files
 *   pnpm step:traverse - Traverse commits
 *   pnpm step:measure  - Measure access performance
 *   pnpm step:results  - Write results (info only)
 *   pnpm step:checkout - Checkout 3rd commit
 */

import { PERF_OUTPUT_FILE, PerformanceTracker, printBanner, REPO_DIR } from "./shared/index.js";
import {
  checkoutCommit,
  cloneRepository,
  loadPackFiles,
  measureObjectAccess,
  printSummary,
  traverseCommits,
  writePerformanceResults,
} from "./steps/index.js";

async function main() {
  printBanner(
    "webrun-vcs: Git Source Repository Performance Benchmark",
    "Clones git repo, runs gc, loads pack files, and measures performance",
  );

  const tracker = new PerformanceTracker();

  try {
    // Step 1: Clone repository
    await cloneRepository(tracker);

    // // Step 2: Run garbage collection
    // await runGarbageCollection(tracker);

    // Step 3: Load pack files with webrun-vcs
    const storage = await loadPackFiles(tracker);

    // Step 4: Traverse commit history
    const commits = await traverseCommits(storage, tracker);

    // Step 5: Measure object access performance
    const result = await measureObjectAccess(storage, commits, tracker);

    // Step 6: Write performance results to file
    await writePerformanceResults(tracker, commits, result.objectCount + result.treeCount);

    // Step 7: Checkout 3rd commit to local folder
    await checkoutCommit(storage, tracker);

    // Print summary
    printSummary(tracker, commits);

    console.log(`
  Results have been saved to: ${PERF_OUTPUT_FILE}
  Repository location: ${REPO_DIR}

  You can re-run this benchmark to get updated measurements.
  The repository will be reused (fetch only) on subsequent runs.
`);

    await storage.close();
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

main();
