/**
 * Step 07: Verify Repository Validity with Native Git
 *
 * Uses native git commands to verify the repository is valid
 * and all objects can be read.
 */

import {
  isGitAvailable,
  log,
  logError,
  logInfo,
  logSection,
  logSuccess,
  runGitCommand,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 07: Verify Repository Validity with Native Git");

  if (!isGitAvailable()) {
    log("Git is not available in PATH, skipping native git verification");
    return;
  }

  log("Running native git verification commands...\n");

  // git fsck - verify repository integrity
  log("$ git fsck --full");
  const fsckOutput = runGitCommand("git fsck --full");
  if (fsckOutput.startsWith("ERROR")) {
    logError(fsckOutput);
  } else if (fsckOutput === "" || fsckOutput.includes("dangling")) {
    logSuccess("Repository integrity check passed");
    if (fsckOutput.includes("dangling")) {
      log(`  (Note: ${fsckOutput.split("\n").length} dangling objects found - normal after gc)`);
    }
  } else {
    log(`  ${fsckOutput}`);
  }

  // git log - verify commit history
  log("\n$ git log --oneline");
  const logOutput = runGitCommand("git log --oneline");
  if (logOutput.startsWith("ERROR")) {
    logError(logOutput);
  } else {
    const lines = logOutput.split("\n");
    for (const line of lines.slice(0, 5)) {
      log(`  ${line}`);
    }
    if (lines.length > 5) {
      log(`  ... and ${lines.length - 5} more commits`);
    }
    logInfo("Total commits visible", lines.length);
  }

  // Verify commit count matches
  const expectedCommits = state.commits.length;
  const actualCommits = logOutput.split("\n").filter((l) => l.trim()).length;
  if (actualCommits === expectedCommits) {
    logSuccess(`Commit count matches: ${actualCommits}`);
  } else {
    logError(`Commit count mismatch: expected ${expectedCommits}, got ${actualCommits}`);
  }

  // git rev-parse HEAD
  log("\n$ git rev-parse HEAD");
  const headRef = runGitCommand("git rev-parse HEAD");
  if (headRef.startsWith("ERROR")) {
    logError(headRef);
  } else {
    log(`  ${headRef}`);
    const expectedHead = state.commits[state.commits.length - 1]?.id;
    if (expectedHead && headRef === expectedHead) {
      logSuccess("HEAD matches expected commit");
    } else {
      log(`  Expected: ${expectedHead}`);
    }
  }

  // git cat-file to verify pack reading
  log("\n$ git cat-file -p HEAD^{tree}");
  const treeOutput = runGitCommand("git cat-file -p HEAD^{tree}");
  if (treeOutput.startsWith("ERROR")) {
    logError(treeOutput);
  } else {
    const entries = treeOutput.split("\n");
    for (const entry of entries.slice(0, 5)) {
      log(`  ${entry}`);
    }
    if (entries.length > 5) {
      log(`  ... and ${entries.length - 5} more entries`);
    }
    logSuccess("Tree content readable");
  }

  // git show to verify blob reading
  log("\n$ git show HEAD:README.md (first 5 lines)");
  const readmeOutput = runGitCommand("git show HEAD:README.md");
  if (readmeOutput.startsWith("ERROR")) {
    logError(readmeOutput);
  } else {
    const lines = readmeOutput.split("\n");
    for (const line of lines.slice(0, 5)) {
      log(`  ${line}`);
    }
    logSuccess("Blob content readable");
  }

  // git count-objects
  log("\n$ git count-objects -v");
  const countOutput = runGitCommand("git count-objects -v");
  if (countOutput.startsWith("ERROR")) {
    logError(countOutput);
  } else {
    for (const line of countOutput.split("\n")) {
      log(`  ${line}`);
    }
  }

  logSuccess("\nNative git verification complete!");
}
