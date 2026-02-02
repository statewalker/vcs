/**
 * Step 1: Initialize and Commit
 *
 * Demonstrates creating a repository and making commits using the Commands API.
 */

import { addFileToStaging, getGit, printSection, printStep, shortId } from "../shared.js";

export async function step01InitAndCommit(): Promise<void> {
  printStep(1, "Initialize and Commit");

  const { git, workingCopy } = await getGit();

  console.log("\nCreating Git facade with Git.fromWorkingCopy()...");
  console.log("Git facade created!");

  // Stage files
  console.log("\nStaging files...");
  await addFileToStaging(workingCopy, "README.md", "# My Project\n\nA sample project.");
  await addFileToStaging(workingCopy, "src/index.ts", 'console.log("Hello, World!");');
  console.log("  Staged: README.md");
  console.log("  Staged: src/index.ts");

  // Create commit using Commands API
  console.log("\nCreating commit with git.commit()...");
  const commitResult = await git.commit().setMessage("Initial commit").call();

  console.log(`  Commit created: ${shortId(commitResult.id)}`);
  console.log(`  Message: "${commitResult.message}"`);

  // Create a second commit
  console.log("\nAdding more content...");
  await addFileToStaging(
    workingCopy,
    "src/utils.ts",
    "export const add = (a: number, b: number) => a + b;",
  );
  const commit2 = await git.commit().setMessage("Add utility functions").call();

  console.log(`  Second commit: ${shortId(commit2.id)}`);

  console.log("\nStep 1 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 1: Initialize and Commit");
  step01InitAndCommit()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
