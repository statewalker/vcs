/**
 * Step 08: Checkout First Version
 *
 * Uses native git to checkout the first commit's files
 * to the working directory.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  isGitAvailable,
  log,
  logError,
  logInfo,
  logSection,
  logSuccess,
  REPO_DIR,
  runGitCommand,
  shortId,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 08: Checkout First Version");

  if (state.commits.length === 0) {
    throw new Error("No commits found. Run steps 01-03 first.");
  }

  if (!isGitAvailable()) {
    throw new Error("Git is not available in PATH.");
  }

  // Get first commit
  const firstCommit = state.commits[0];
  log(`Checking out first commit: ${shortId(firstCommit.id)}`);
  log(`  Message: ${firstCommit.message}`);

  // Use native git to checkout
  log("\nRunning git checkout...");
  const checkoutResult = runGitCommand(`git checkout ${firstCommit.id}`);
  if (checkoutResult.startsWith("ERROR")) {
    logError(checkoutResult);
    throw new Error(`Checkout failed: ${checkoutResult}`);
  }
  log(`  ${checkoutResult}`);

  // List checked out files
  log("\nChecked out files:");
  const checkedOutFiles = await listFilesRecursive(REPO_DIR);
  for (const file of checkedOutFiles.slice(0, 10)) {
    const relativePath = path.relative(REPO_DIR, file);
    const stat = await fs.stat(file);
    log(`  ${relativePath} (${stat.size} bytes)`);
  }
  if (checkedOutFiles.length > 10) {
    log(`  ... and ${checkedOutFiles.length - 10} more files`);
  }

  logInfo("Files checked out", checkedOutFiles.length);
  logSuccess("Checkout complete!");
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === ".git") continue;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(fullPath)));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}
