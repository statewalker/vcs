/**
 * Step 3: Fast-Forward Merge
 *
 * Demonstrates fast-forward merging when branches have linear history.
 */

import {
  addFileToStaging,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step03FastForward(): Promise<void> {
  printStep(3, "Fast-Forward Merge");

  // Fresh start for clean demonstration
  resetState();
  const { git, store } = await getGit();

  // Setup: create initial commit on main
  console.log("\n--- Setup: Creating initial state ---");
  await addFileToStaging(store, "README.md", "# Fast-Forward Demo");
  await git.commit().setMessage("Initial commit").call();
  console.log("  Created initial commit on main");

  // Create a feature branch
  await git.branchCreate().setName("feature-ff").call();
  console.log("  Created 'feature-ff' branch");

  // Switch to feature branch and add commits
  await store.refs.setSymbolic("HEAD", "refs/heads/feature-ff");
  const featureRef = await store.refs.resolve("refs/heads/feature-ff");
  if (featureRef?.objectId) {
    const commit = await store.commits.loadCommit(featureRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  // Add commits on feature branch
  await addFileToStaging(store, "feature1.ts", "export const feature1 = true;");
  await git.commit().setMessage("Add feature1").call();
  console.log("  Added commit 1 on feature-ff");

  await addFileToStaging(store, "feature2.ts", "export const feature2 = true;");
  await git.commit().setMessage("Add feature2").call();
  console.log("  Added commit 2 on feature-ff");

  // Diagram the situation
  console.log("\n--- Current branch structure ---");
  console.log(`
    main ----o (initial)
              \\
               o---o feature-ff (HEAD)
                   ^
                   (feature1, feature2)
  `);
  console.log("  Main has not moved, feature-ff is ahead by 2 commits.");
  console.log("  This allows a fast-forward merge.");

  // Switch back to main
  await store.refs.setSymbolic("HEAD", "refs/heads/main");
  const mainRef = await store.refs.resolve("refs/heads/main");
  if (mainRef?.objectId) {
    const commit = await store.commits.loadCommit(mainRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  console.log("\n--- Performing fast-forward merge ---");
  const mainBefore = await store.refs.resolve("refs/heads/main");
  console.log(
    `  Main before merge: ${mainBefore?.objectId ? shortId(mainBefore.objectId) : "none"}`,
  );

  // Perform fast-forward merge
  const result = await git.merge().include("feature-ff").call();

  console.log(`\n  Merge result:`);
  console.log(`    Status: ${result.status}`);
  console.log(`    New HEAD: ${result.newHead ? shortId(result.newHead) : "none"}`);

  const mainAfter = await store.refs.resolve("refs/heads/main");
  console.log(`  Main after merge: ${mainAfter?.objectId ? shortId(mainAfter.objectId) : "none"}`);

  // Explain fast-forward
  console.log("\n--- What happened? ---");
  console.log("  Fast-forward merge simply moves the branch pointer forward.");
  console.log("  No merge commit is created because history is linear.");

  // Demonstrate FastForwardMode options
  console.log("\n--- FastForwardMode options ---");
  console.log(`
  FastForwardMode.FF (default):
    - Fast-forward when possible
    - Creates merge commit otherwise

  FastForwardMode.NO_FF:
    - Always creates a merge commit
    - Useful for preserving branch history

  FastForwardMode.FF_ONLY:
    - Only allows fast-forward merges
    - Throws error if not possible
  `);

  console.log("\nStep 3 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 3: Fast-Forward Merge");
  step03FastForward()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
