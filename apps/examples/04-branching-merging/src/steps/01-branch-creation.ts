/**
 * Step 1: Branch Creation
 *
 * Demonstrates creating and listing branches using the porcelain API.
 */

import { addFileToStaging, getGit, printSection, printStep, shortId } from "../shared.js";

export async function step01BranchCreation(): Promise<void> {
  printStep(1, "Branch Creation");

  const { git, workingCopy, history } = await getGit();

  // Create initial commit if needed
  console.log("\nSetting up initial commit...");
  const head = await history.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(
      workingCopy,
      "README.md",
      "# Branching Example\n\nDemonstrating Git branch operations.",
    );
    await git.commit().setMessage("Initial commit").call();
    console.log("  Created initial commit");
  }

  // Create branches using git.branchCreate()
  console.log("\n--- Creating branches with git.branchCreate() ---");

  // Create a feature branch
  console.log("\nCreating 'feature' branch...");
  const featureBranch = await git.branchCreate().setName("feature").call();
  console.log(`  Created branch: ${featureBranch.name}`);

  // Create a development branch
  console.log("\nCreating 'develop' branch...");
  const developBranch = await git.branchCreate().setName("develop").call();
  console.log(`  Created branch: ${developBranch.name}`);

  // Create a branch from a specific commit
  const currentHead = await history.refs.resolve("HEAD");
  if (currentHead?.objectId) {
    console.log("\nCreating 'release' branch from specific commit...");
    const releaseBranch = await git
      .branchCreate()
      .setName("release")
      .setStartPoint(currentHead.objectId)
      .call();
    console.log(`  Created branch: ${releaseBranch.name} at ${shortId(currentHead.objectId)}`);
  }

  // List all branches
  console.log("\n--- Listing branches with git.branchList() ---");
  const branches = await git.branchList().call();
  console.log("\n  All branches:");
  for (const branch of branches) {
    console.log(`    - ${branch.name}`);
  }

  // Show branch count
  console.log(`\n  Total branches: ${branches.length}`);

  // List refs directly (low-level approach)
  console.log("\n--- Low-level: Listing refs/heads/* directly ---");
  for await (const ref of history.refs.list("refs/heads/")) {
    const resolved = await history.refs.resolve(ref.name);
    console.log(
      `    ${ref.name} -> ${resolved?.objectId ? shortId(resolved.objectId) : "unresolved"}`,
    );
  }

  console.log("\nStep 1 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 1: Branch Creation");
  step01BranchCreation()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
