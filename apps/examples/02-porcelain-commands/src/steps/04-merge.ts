/**
 * Step 4: Merge
 *
 * Demonstrates merging branches with different strategies.
 */

import { MergeStrategy } from "@statewalker/vcs-commands";
import { addFileToStaging, getGit, printSection, printStep, shortId } from "../shared.js";

export async function step04Merge(): Promise<void> {
  printStep(4, "Merge");

  const { git, store } = await getGit();

  // Setup: create divergent branches for merge demo
  console.log("\nSetting up branches for merge demonstration...");

  // Ensure we're on main with initial commit
  let mainHead = await store.refs.resolve("refs/heads/main");
  if (!mainHead?.objectId) {
    await addFileToStaging(store, "README.md", "# Project\n\nVersion 1");
    await git.commit().setMessage("Initial commit").call();
    mainHead = await store.refs.resolve("refs/heads/main");
  }

  // Create merge-demo branch and add a commit
  await git.branchCreate().setName("merge-demo").call();
  await store.refs.setSymbolic("HEAD", "refs/heads/merge-demo");

  // Reset staging to merge-demo's tree
  const mergeDemoRef = await store.refs.resolve("refs/heads/merge-demo");
  if (mergeDemoRef?.objectId) {
    const commit = await store.commits.loadCommit(mergeDemoRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  await addFileToStaging(store, "feature.ts", 'export const feature = "new feature";');
  await git.commit().setMessage("Add feature on merge-demo").call();

  console.log("  Created 'merge-demo' branch with a commit");

  // Switch back to main
  await store.refs.setSymbolic("HEAD", "refs/heads/main");
  if (mainHead?.objectId) {
    const commit = await store.commits.loadCommit(mainHead.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  // Perform fast-forward merge
  console.log("\nMerging 'merge-demo' into 'main' (fast-forward)...");
  const ffResult = await git.merge().include("merge-demo").call();

  console.log(`  Merge status: ${ffResult.status}`);
  if (ffResult.newHead) {
    console.log(`  New HEAD: ${shortId(ffResult.newHead)}`);
  }

  // Demonstrate merge with strategy
  console.log("\nMerge strategies available:");
  console.log(`  - ${MergeStrategy.RECURSIVE} (default)`);
  console.log(`  - ${MergeStrategy.OURS}`);
  console.log(`  - ${MergeStrategy.THEIRS}`);

  // Setup for three-way merge (divergent branches)
  console.log("\nCreating divergent branches for three-way merge...");

  await git.branchCreate().setName("branch-a").call();
  await store.refs.setSymbolic("HEAD", "refs/heads/branch-a");

  // Get current tree
  const branchARef = await store.refs.resolve("refs/heads/branch-a");
  if (branchARef?.objectId) {
    const commit = await store.commits.loadCommit(branchARef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  await addFileToStaging(store, "file-a.ts", "// Added in branch-a");
  await git.commit().setMessage("Add file-a on branch-a").call();

  // Switch to main and add different file
  await store.refs.setSymbolic("HEAD", "refs/heads/main");
  const currentMainRef = await store.refs.resolve("refs/heads/main");
  if (currentMainRef?.objectId) {
    const commit = await store.commits.loadCommit(currentMainRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  await addFileToStaging(store, "file-main.ts", "// Added in main");
  await git.commit().setMessage("Add file-main on main").call();

  // Now merge branch-a into main (three-way merge)
  console.log("\nMerging 'branch-a' into 'main' (three-way)...");
  const threeWayResult = await git
    .merge()
    .include("branch-a")
    .setStrategy(MergeStrategy.RECURSIVE)
    .call();

  console.log(`  Merge status: ${threeWayResult.status}`);
  if (threeWayResult.newHead) {
    console.log(`  New HEAD: ${shortId(threeWayResult.newHead)}`);
  }

  console.log("\nStep 4 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 4: Merge");
  step04Merge()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
