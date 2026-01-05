/**
 * Step 3: Load Pack Files with statewalker-vcs
 *
 * Initializes the statewalker-vcs storage layer and loads pack file indexes.
 *
 * Run with: pnpm step:load
 */

import type { GitRepository } from "@statewalker/vcs-core";
import {
  fixGitObjectPermissions,
  formatBytes,
  listPackFiles,
  openStorage,
  PerformanceTracker,
  printBanner,
  printInfo,
  printSection,
} from "../shared/index.js";

export async function loadPackFiles(tracker?: PerformanceTracker): Promise<GitRepository> {
  const perf = tracker ?? new PerformanceTracker();

  printSection("Step 3: Load Pack Files with statewalker-vcs");

  // Fix permissions before loading (in case gc step was skipped)
  console.log("  Ensuring git object permissions are correct...");
  await fixGitObjectPermissions();

  const storage = await perf.measureAsync("statewalker_vcs_init", async () => {
    return openStorage();
  });

  const packs = await listPackFiles();
  const totalPackSize = packs.reduce((sum, p) => sum + p.size, 0);

  printInfo("Pack files loaded", packs.length);
  printInfo("Total pack size", formatBytes(totalPackSize));

  return storage;
}

// Run as standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner("statewalker-vcs: Load Pack Files", "Step 3 of 6");
  loadPackFiles()
    .then(async (storage) => {
      console.log("\n  Step 3 completed successfully!");
      console.log("  Storage initialized and ready for use.\n");
      await storage.close();
    })
    .catch((error) => {
      console.error("\nError:", error);
      process.exit(1);
    });
}
