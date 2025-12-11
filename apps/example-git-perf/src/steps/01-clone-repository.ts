/**
 * Step 1: Clone Git Repository
 *
 * Clones the git source repository using native git.
 * If the repository already exists, fetches latest changes instead.
 *
 * Run with: pnpm step:clone
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  directoryExists,
  GIT_DIR,
  GIT_REPO_URL,
  PerformanceTracker,
  printBanner,
  printInfo,
  printSection,
  REPO_DIR,
  runGitCommandAsync,
} from "../shared/index.js";

export async function cloneRepository(tracker?: PerformanceTracker): Promise<void> {
  const perf = tracker ?? new PerformanceTracker();

  printSection("Step 1: Clone Git Repository");

  const repoExists = await directoryExists(path.join(REPO_DIR, GIT_DIR));

  if (repoExists) {
    console.log("  Repository already exists, skipping clone");
    console.log(`  Location: ${REPO_DIR}`);

    // Try to fetch latest changes, but don't fail if it doesn't work
    try {
      await perf.measureAsync("git_fetch", async () => {
        console.log("  Fetching latest changes...");
        await runGitCommandAsync(["fetch", "--all"], REPO_DIR);
      });
    } catch {
      console.log("  Fetch failed (likely due to --no-checkout clone), using existing repository");
    }
  } else {
    await perf.measureAsync(
      "git_clone",
      async () => {
        console.log(`  Cloning ${GIT_REPO_URL}...`);
        console.log("  This may take several minutes...\n");
        // Create repo directory
        await fs.mkdir(REPO_DIR, { recursive: true });
        // Use --bare to only get git data (no working tree), then convert to regular repo
        await runGitCommandAsync(
          ["clone", "--bare", GIT_REPO_URL, `${REPO_DIR}/.git`],
          process.cwd(),
        );
        // Initialize as regular repo (creates HEAD symref)
        await runGitCommandAsync(["config", "--bool", "core.bare", "false"], REPO_DIR);
      },
      { url: GIT_REPO_URL },
    );
  }

  printInfo("Repository path", REPO_DIR);
}

// Run as standalone script
if (import.meta.url === `file://${process.argv[1]}`) {
  printBanner("webrun-vcs: Clone Git Repository", "Step 1 of 6");
  cloneRepository()
    .then(() => {
      console.log("\n  Step 1 completed successfully!\n");
    })
    .catch((error) => {
      console.error("\nError:", error);
      process.exit(1);
    });
}
