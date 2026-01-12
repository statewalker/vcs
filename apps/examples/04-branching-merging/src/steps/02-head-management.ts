/**
 * Step 2: HEAD Management
 *
 * Demonstrates symbolic refs and HEAD management.
 */

import { addFileToStaging, getGit, printSection, printStep, shortId } from "../shared.js";

export async function step02HeadManagement(): Promise<void> {
  printStep(2, "HEAD Management");

  const { git, store } = await getGit();

  // Ensure we have branches
  const head = await store.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(store, "README.md", "# HEAD Management");
    await git.commit().setMessage("Initial commit").call();
    await git.branchCreate().setName("feature").call();
    await git.branchCreate().setName("develop").call();
  }

  // Understanding HEAD
  console.log("\n--- Understanding HEAD ---");
  console.log("\nHEAD is a special ref that points to your current branch.");
  console.log("It's typically a 'symbolic ref' pointing to refs/heads/<branch>.");

  // Get HEAD directly
  const headRef = await store.refs.get("HEAD");
  console.log(`\nHEAD ref: ${JSON.stringify(headRef, null, 2)}`);

  // Resolve HEAD to commit
  const resolvedHead = await store.refs.resolve("HEAD");
  if (resolvedHead) {
    console.log(`\nResolved HEAD:`);
    console.log(`  Symbolic ref: ${resolvedHead.symbolicRef || "none (detached)"}`);
    console.log(`  Commit: ${resolvedHead.objectId ? shortId(resolvedHead.objectId) : "none"}`);
  }

  // Switching branches with setSymbolic
  console.log("\n--- Switching branches (low-level) ---");

  console.log("\nSwitching to 'feature' branch via refs.setSymbolic()...");
  await store.refs.setSymbolic("HEAD", "refs/heads/feature");

  const newHead = await store.refs.resolve("HEAD");
  console.log(`  HEAD now points to: ${newHead?.symbolicRef}`);

  // Detached HEAD state
  console.log("\n--- Detached HEAD State ---");
  console.log("\nDetached HEAD means HEAD points directly to a commit, not a branch.");

  if (resolvedHead?.objectId) {
    console.log("\nCreating detached HEAD state...");
    await store.refs.set("HEAD", resolvedHead.objectId);

    const detachedHead = await store.refs.get("HEAD");
    console.log(`  HEAD is now: ${JSON.stringify(detachedHead)}`);

    const detachedResolved = await store.refs.resolve("HEAD");
    console.log(`  Symbolic ref: ${detachedResolved?.symbolicRef || "none (detached)"}`);
    console.log(
      `  Points to: ${detachedResolved?.objectId ? shortId(detachedResolved.objectId) : "none"}`,
    );

    // Return to main branch
    console.log("\nReturning to 'main' branch...");
    await store.refs.setSymbolic("HEAD", "refs/heads/main");
  }

  // Current branch helper
  console.log("\n--- Getting Current Branch ---");

  const currentHead = await store.refs.resolve("HEAD");
  if (currentHead?.symbolicRef) {
    const branchName = currentHead.symbolicRef.replace("refs/heads/", "");
    console.log(`\nCurrent branch: ${branchName}`);
  } else {
    console.log("\nHEAD is detached (not on any branch)");
  }

  console.log("\nStep 2 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 2: HEAD Management");
  step02HeadManagement()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
