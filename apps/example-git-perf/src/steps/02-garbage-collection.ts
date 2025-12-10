/**
 * Step 2: Run Garbage Collection
 *
 * Runs git gc --aggressive to consolidate all objects into pack files.
 * Also fixes pack file permissions for compatibility with webrun-vcs.
 *
 * Run with: pnpm step:gc
 */

import {
  PerformanceTracker,
  REPO_DIR,
  fixGitObjectPermissions,
  formatBytes,
  listPackFiles,
  printBanner,
  printSection,
  runGitCommandAsync,
} from "../shared/index.js";

export async function runGarbageCollection(tracker?: PerformanceTracker): Promise<void> {
  const perf = tracker ?? new PerformanceTracker();

  printSection("Step 2: Run Garbage Collection");

  const packsBefore = await listPackFiles();
  console.log(`  Pack files before gc: ${packsBefore.length}`);

  await perf.measureAsync("git_gc", async () => {
    console.log("  Running git gc --aggressive...");
    await runGitCommandAsync(["gc", "--aggressive"], REPO_DIR);
  });

  // Fix git object permissions for webrun-vcs compatibility
  console.log("  Fixing git object permissions...");
  await fixGitObjectPermissions();

  const packsAfter = await listPackFiles();
  console.log(`  Pack files after gc: ${packsAfter.length}`);

  for (const pack of packsAfter) {
    console.log(`    - ${pack.name} (${formatBytes(pack.size)})`);
  }
}

// Run as standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner("webrun-vcs: Garbage Collection", "Step 2 of 6");
  runGarbageCollection()
    .then(() => {
      console.log("\n  Step 2 completed successfully!\n");
    })
    .catch((error) => {
      console.error("\nError:", error);
      process.exit(1);
    });
}
