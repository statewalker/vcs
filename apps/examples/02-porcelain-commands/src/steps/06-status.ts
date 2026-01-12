/**
 * Step 6: Status
 *
 * Demonstrates checking repository status.
 */

import { addFileToStaging, getGit, printSection, printStep } from "../shared.js";

export async function step06Status(): Promise<void> {
  printStep(6, "Status");

  const { git, store } = await getGit();

  // Ensure we have a commit
  const head = await store.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(store, "README.md", "# Project");
    await git.commit().setMessage("Initial commit").call();
  }

  // Check status (should be clean after commit)
  console.log("\nChecking status with git.status()...");
  const status1 = await git.status().call();

  console.log("\nRepository status:");
  console.log(`  Clean: ${status1.isClean()}`);
  console.log(`  Added files: ${status1.added.size}`);
  console.log(`  Changed files: ${status1.changed.size}`);
  console.log(`  Removed files: ${status1.removed.size}`);
  console.log(`  Conflicting files: ${status1.conflicting.size}`);

  // Stage a new file
  console.log("\nStaging a new file...");
  await addFileToStaging(store, "new-file.ts", "// New file content");

  // Check status again
  const status2 = await git.status().call();

  console.log("\nStatus after staging:");
  console.log(`  Clean: ${status2.isClean()}`);
  console.log(`  Added files: ${status2.added.size}`);

  if (status2.added.size > 0) {
    console.log("  Added:");
    for (const file of status2.added) {
      console.log(`    - ${file}`);
    }
  }

  // Commit to clean up
  await git.commit().setMessage("Add new file").call();

  // Final status
  const status3 = await git.status().call();
  console.log("\nStatus after commit:");
  console.log(`  Clean: ${status3.isClean()}`);

  console.log("\nStep 6 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 6: Status");
  step06Status()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
