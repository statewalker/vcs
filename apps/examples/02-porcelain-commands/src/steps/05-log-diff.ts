/**
 * Step 5: Log and Diff
 *
 * Demonstrates viewing commit history and comparing changes.
 */

import { addFileToStaging, getGit, printSection, printStep, shortId } from "../shared.js";

export async function step05LogDiff(): Promise<void> {
  printStep(5, "Log and Diff");

  const { git, workingCopy, history } = await getGit();

  // Ensure we have some commits
  const head = await history.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(workingCopy, "README.md", "# Project");
    await git.commit().setMessage("Initial commit").call();
    await addFileToStaging(workingCopy, "src/index.ts", "console.log('hello');");
    await git.commit().setMessage("Add index.ts").call();
    await addFileToStaging(workingCopy, "src/utils.ts", "export const add = (a, b) => a + b;");
    await git.commit().setMessage("Add utils.ts").call();
  }

  // View commit history
  console.log("\nViewing commit history with git.log()...");
  console.log("\nCommit history:");

  let count = 0;
  for await (const commit of await git.log().call()) {
    console.log(`  - ${commit.message.trim()}`);
    console.log(`    Author: ${commit.author.name} <${commit.author.email}>`);
    console.log(`    Date: ${new Date(commit.author.timestamp * 1000).toISOString()}`);
    count++;
    if (count >= 5) break; // Limit output
  }

  // Log with max count
  console.log("\nLimiting to last 2 commits with setMaxCount()...");
  const limitedLog = await git.log().setMaxCount(2).call();
  console.log("  Last 2 commits:");
  for await (const commit of limitedLog) {
    console.log(`    - ${commit.message.trim()}`);
  }

  // Diff between commits using trees
  console.log("\nDiff operations:");
  console.log("  The diff command compares trees between commits.");

  // Get two commits for diff - use low-level walkAncestry to get IDs
  const headRef = await history.refs.resolve("HEAD");
  if (headRef?.objectId) {
    const commitIds: string[] = [];
    for await (const commitId of history.commits.walkAncestry(headRef.objectId, { limit: 2 })) {
      commitIds.push(commitId);
    }

    if (commitIds.length >= 2) {
      console.log(`\n  Comparing ${shortId(commitIds[1])} -> ${shortId(commitIds[0])}:`);

      const diffEntries = await git.diff().setOldTree(commitIds[1]).setNewTree(commitIds[0]).call();

      if (diffEntries.length === 0) {
        console.log("    (no changes)");
      } else {
        for (const entry of diffEntries) {
          const path = entry.newPath || entry.oldPath || "";
          console.log(`    ${entry.changeType}: ${path}`);
        }
      }
    }
  }

  console.log("\nStep 5 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 5: Log and Diff");
  step05LogDiff()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
