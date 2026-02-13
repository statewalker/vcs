/**
 * Step 06: Diff Viewer
 *
 * Demonstrates viewing differences between commits using
 * git.log() and git.diff() porcelain commands.
 */

import { log, logInfo, logSection, logSuccess, shortId, state } from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 06: Diff Viewer");

  const { git } = state;
  if (!git) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  // Get commits for diff comparison using git.log()
  log("\nGathering commits for diff comparison...");

  const commitIds: string[] = [];
  for await (const commit of await git.log().setMaxCount(5).call()) {
    commitIds.push(commit.id);
  }

  log(`  Found ${commitIds.length} recent commits`);

  if (commitIds.length < 2) {
    log("  Not enough commits for diff comparison");
    return;
  }

  // Show diff between HEAD and HEAD~1
  log("\nDiff between HEAD and HEAD~1:");
  const latestCommit = commitIds[0];
  const previousCommit = commitIds[1];

  console.log(`    Comparing ${shortId(previousCommit)} -> ${shortId(latestCommit)}`);

  const recentDiff = await git.diff().setOldTree(previousCommit).setNewTree(latestCommit).call();

  if (recentDiff.length === 0) {
    console.log("    (no changes)");
  } else {
    for (const entry of recentDiff) {
      const path = entry.newPath || entry.oldPath || "";
      console.log(`    ${formatChangeType(entry.changeType)}: ${path}`);
    }
  }

  // Show diff between first and latest commit
  if (commitIds.length >= 2) {
    const firstCommit = commitIds[commitIds.length - 1];

    log(`\nDiff between first and latest commit:`);
    console.log(`    Comparing ${shortId(firstCommit)} -> ${shortId(latestCommit)}`);

    const fullDiff = await git.diff().setOldTree(firstCommit).setNewTree(latestCommit).call();

    if (fullDiff.length === 0) {
      console.log("    (no changes)");
    } else {
      // Group changes by type
      const added = fullDiff.filter((e) => e.changeType === "ADD");
      const modified = fullDiff.filter((e) => e.changeType === "MODIFY");
      const deleted = fullDiff.filter((e) => e.changeType === "DELETE");

      if (added.length > 0) {
        console.log(`\n    Added (${added.length} files):`);
        for (const entry of added.slice(0, 5)) {
          console.log(`      + ${entry.newPath}`);
        }
        if (added.length > 5) {
          console.log(`      ... and ${added.length - 5} more`);
        }
      }

      if (modified.length > 0) {
        console.log(`\n    Modified (${modified.length} files):`);
        for (const entry of modified.slice(0, 5)) {
          console.log(`      ~ ${entry.newPath || entry.oldPath}`);
        }
        if (modified.length > 5) {
          console.log(`      ... and ${modified.length - 5} more`);
        }
      }

      if (deleted.length > 0) {
        console.log(`\n    Deleted (${deleted.length} files):`);
        for (const entry of deleted.slice(0, 5)) {
          console.log(`      - ${entry.oldPath}`);
        }
        if (deleted.length > 5) {
          console.log(`      ... and ${deleted.length - 5} more`);
        }
      }
    }
  }

  // Show summary
  log("\nDiff summary:");
  logInfo("Commits compared", commitIds.length);
  logSuccess("Diff viewer complete!");
}

function formatChangeType(changeType: string): string {
  switch (changeType) {
    case "ADD":
      return "+";
    case "DELETE":
      return "-";
    case "MODIFY":
      return "~";
    case "RENAME":
      return "→";
    case "COPY":
      return "⊕";
    default:
      return "?";
  }
}
