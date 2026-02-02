/**
 * Step 2: HEAD Management
 *
 * Demonstrates symbolic refs and HEAD management.
 */

import { isSymbolicRef } from "@statewalker/vcs-core";
import { addFileToStaging, getGit, printSection, printStep, shortId } from "../shared.js";

export async function step02HeadManagement(): Promise<void> {
  printStep(2, "HEAD Management");

  const { git, workingCopy, history } = await getGit();

  // Ensure we have branches
  const head = await history.refs.resolve("HEAD");
  if (!head?.objectId) {
    await addFileToStaging(workingCopy, "README.md", "# HEAD Management");
    await git.commit().setMessage("Initial commit").call();
    await git.branchCreate().setName("feature").call();
    await git.branchCreate().setName("develop").call();
  }

  // Understanding HEAD
  console.log("\n--- Understanding HEAD ---");
  console.log("\nHEAD is a special ref that points to your current branch.");
  console.log("It's typically a 'symbolic ref' pointing to refs/heads/<branch>.");

  // Get HEAD directly
  const headRef = await history.refs.get("HEAD");
  console.log(`\nHEAD ref: ${JSON.stringify(headRef, null, 2)}`);

  // Resolve HEAD to commit
  const resolvedHead = await history.refs.resolve("HEAD");
  if (resolvedHead) {
    // Check if HEAD is symbolic by getting the raw ref
    const headValue = await history.refs.get("HEAD");
    const symbolicTarget = headValue && isSymbolicRef(headValue) ? headValue.target : undefined;
    console.log(`\nResolved HEAD:`);
    console.log(`  Symbolic ref: ${symbolicTarget || "none (detached)"}`);
    console.log(`  Commit: ${resolvedHead.objectId ? shortId(resolvedHead.objectId) : "none"}`);
  }

  // Switching branches with setSymbolic
  console.log("\n--- Switching branches (low-level) ---");

  console.log("\nSwitching to 'feature' branch via refs.setSymbolic()...");
  await history.refs.setSymbolic("HEAD", "refs/heads/feature");

  const newHeadValue = await history.refs.get("HEAD");
  const newHeadTarget =
    newHeadValue && isSymbolicRef(newHeadValue) ? newHeadValue.target : undefined;
  console.log(`  HEAD now points to: ${newHeadTarget}`);

  // Detached HEAD state
  console.log("\n--- Detached HEAD State ---");
  console.log("\nDetached HEAD means HEAD points directly to a commit, not a branch.");

  if (resolvedHead?.objectId) {
    console.log("\nCreating detached HEAD state...");
    await history.refs.set("HEAD", resolvedHead.objectId);

    const detachedHead = await history.refs.get("HEAD");
    console.log(`  HEAD is now: ${JSON.stringify(detachedHead)}`);

    const detachedResolved = await history.refs.resolve("HEAD");
    const detachedHeadValue = await history.refs.get("HEAD");
    const detachedSymbolic =
      detachedHeadValue && isSymbolicRef(detachedHeadValue) ? detachedHeadValue.target : undefined;
    console.log(`  Symbolic ref: ${detachedSymbolic || "none (detached)"}`);
    console.log(
      `  Points to: ${detachedResolved?.objectId ? shortId(detachedResolved.objectId) : "none"}`,
    );

    // Return to main branch
    console.log("\nReturning to 'main' branch...");
    await history.refs.setSymbolic("HEAD", "refs/heads/main");
  }

  // Current branch helper
  console.log("\n--- Getting Current Branch ---");

  const currentHeadValue = await history.refs.get("HEAD");
  if (currentHeadValue && isSymbolicRef(currentHeadValue)) {
    const branchName = currentHeadValue.target.replace("refs/heads/", "");
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
