/**
 * Step 05: Perform Garbage Collection
 *
 * Runs garbage collection to pack loose objects into pack files.
 * Uses native git gc for maximum compatibility.
 */

import { execSync } from "node:child_process";
import {
  countLooseObjects,
  getPackFileStats,
  listPackFiles,
  log,
  logInfo,
  logSection,
  logSuccess,
  REPO_DIR,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 05: Perform Garbage Collection");

  const repository = state.repository;
  if (!repository) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  // Get counts before GC
  const { count: looseBefore } = await countLooseObjects();
  const packsBefore = await listPackFiles();

  log("State before GC:");
  logInfo("  Loose objects", looseBefore);
  logInfo("  Pack files", packsBefore.length);

  // Close repository before running native git
  log("\nClosing VCS repository handle...");
  await repository.close();
  state.repository = undefined;

  // Run native git gc
  log("Running git gc --aggressive...");
  try {
    const output = execSync("git gc --aggressive --prune=now", {
      cwd: REPO_DIR,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (output.trim()) {
      log(`  ${output.trim()}`);
    }
  } catch (error) {
    const e = error as { stderr?: string };
    // git gc often writes to stderr even on success
    if (e.stderr) {
      log(`  ${e.stderr.trim()}`);
    }
  }

  // Fix pack file permissions (git gc sometimes creates files with restricted permissions)
  try {
    execSync("chmod -R a+r .git/objects/pack/", { cwd: REPO_DIR, stdio: "pipe" });
  } catch {
    // Ignore errors - may not be needed on all systems
  }

  // Get counts after GC
  const { count: looseAfter } = await countLooseObjects();
  const packsAfter = await listPackFiles();
  const packStats = await getPackFileStats();

  log("\nState after GC:");
  logInfo("  Loose objects", looseAfter);
  logInfo("  Pack files", packsAfter.length);

  if (packStats.length > 0) {
    log("\n  Pack file details:");
    for (const pack of packStats) {
      log(`    ${pack.name} (${pack.sizeFormatted})`);
    }
  }

  // Calculate compression
  if (looseBefore > 0 && looseAfter < looseBefore) {
    const reduction = ((looseBefore - looseAfter) / looseBefore) * 100;
    logSuccess(`Reduced loose objects by ${reduction.toFixed(1)}%`);
  }

  if (packsAfter.length > 0) {
    logSuccess("Objects successfully packed!");
  }
}
