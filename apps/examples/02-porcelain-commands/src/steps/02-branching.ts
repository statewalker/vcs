/**
 * Step 2: Branching
 *
 * Demonstrates branch creation, listing, and deletion.
 */

import { addFileToStaging, getGit, printSection, printStep } from "../shared.js";

export async function step02Branching(): Promise<void> {
  printStep(2, "Branching");

  const { git, workingCopy, history } = await getGit();

  // Ensure we have a commit
  const head = await history.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(workingCopy, "README.md", "# Project");
    await git.commit().setMessage("Initial commit").call();
  }

  // Create a branch
  console.log("\nCreating branch 'feature'...");
  await git.branchCreate().setName("feature").call();
  console.log("  Branch 'feature' created");

  // Create another branch
  console.log("\nCreating branch 'bugfix'...");
  await git.branchCreate().setName("bugfix").call();
  console.log("  Branch 'bugfix' created");

  // List branches
  console.log("\nListing branches with git.branchList()...");
  const branches = await git.branchList().call();
  console.log("  Branches:");
  for (const branch of branches) {
    console.log(`    - ${branch.name}`);
  }

  // Delete a branch
  console.log("\nDeleting branch 'bugfix'...");
  await git.branchDelete().setBranchNames("bugfix").call();
  console.log("  Branch 'bugfix' deleted");

  // List branches again
  console.log("\nRemaining branches:");
  const remainingBranches = await git.branchList().call();
  for (const branch of remainingBranches) {
    console.log(`    - ${branch.name}`);
  }

  console.log("\nStep 2 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 2: Branching");
  step02Branching()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
