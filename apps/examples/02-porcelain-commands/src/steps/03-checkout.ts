/**
 * Step 3: Checkout
 *
 * Demonstrates switching branches and creating new branches on checkout.
 */

import { addFileToStaging, getGit, printSection, printStep } from "../shared.js";

export async function step03Checkout(): Promise<void> {
  printStep(3, "Checkout");

  const { git, store } = await getGit();

  // Ensure we have a commit and branches
  const head = await store.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(store, "README.md", "# Project");
    await git.commit().setMessage("Initial commit").call();
    await git.branchCreate().setName("feature").call();
  }

  // Show current branch
  const headRef = await store.refs.get("HEAD");
  if (headRef && "target" in headRef) {
    console.log(`\nCurrent branch: ${headRef.target.replace("refs/heads/", "")}`);
  }

  // Checkout feature branch
  console.log("\nChecking out 'feature' branch...");
  const result = await git.checkout().setName("feature").call();
  console.log(`  Checkout status: ${result.status}`);

  // Verify HEAD changed
  const newHead = await store.refs.get("HEAD");
  if (newHead && "target" in newHead) {
    console.log(`  HEAD now points to: ${newHead.target}`);
  }

  // Create and checkout a new branch in one step
  console.log("\nCreating and checking out 'new-feature' in one step...");
  await git.checkout().setCreateBranch(true).setName("new-feature").call();

  const afterCreate = await store.refs.get("HEAD");
  if (afterCreate && "target" in afterCreate) {
    console.log(`  HEAD now points to: ${afterCreate.target}`);
  }

  // Switch back to main
  console.log("\nSwitching back to 'main'...");
  await git.checkout().setName("main").call();

  const finalHead = await store.refs.get("HEAD");
  if (finalHead && "target" in finalHead) {
    console.log(`  HEAD now points to: ${finalHead.target}`);
  }

  console.log("\nStep 3 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 3: Checkout");
  step03Checkout()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
