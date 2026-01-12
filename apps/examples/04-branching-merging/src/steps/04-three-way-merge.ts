/**
 * Step 4: Three-Way Merge
 *
 * Demonstrates three-way merging when branches have diverged.
 */

import { MergeStatus } from "@statewalker/vcs-commands";
import {
  addFileToStaging,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step04ThreeWayMerge(): Promise<void> {
  printStep(4, "Three-Way Merge");

  // Fresh start for clean demonstration
  resetState();
  const { git, store } = await getGit();

  // Setup: create initial commit
  console.log("\n--- Setup: Creating divergent branches ---");
  await addFileToStaging(store, "README.md", "# Three-Way Merge Demo");
  await addFileToStaging(store, "shared.ts", "export const shared = 1;");
  await git.commit().setMessage("Initial commit").call();
  console.log("  Created initial commit");

  // Create feature branch
  await git.branchCreate().setName("feature-3way").call();

  // Add commits on main (diverging from feature)
  await addFileToStaging(store, "main-only.ts", "// Added only on main");
  await git.commit().setMessage("Add main-only file").call();
  console.log("  Added commit on main");

  await addFileToStaging(store, "another-main.ts", "// Another main file");
  await git.commit().setMessage("Add another main file").call();
  console.log("  Added second commit on main");

  // Switch to feature branch and add commits
  await store.refs.setSymbolic("HEAD", "refs/heads/feature-3way");
  const featureRef = await store.refs.resolve("refs/heads/feature-3way");
  if (featureRef?.objectId) {
    const commit = await store.commits.loadCommit(featureRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  await addFileToStaging(store, "feature-only.ts", "// Added only on feature");
  await git.commit().setMessage("Add feature-only file").call();
  console.log("  Added commit on feature-3way");

  await addFileToStaging(store, "another-feature.ts", "// Another feature file");
  await git.commit().setMessage("Add another feature file").call();
  console.log("  Added second commit on feature-3way");

  // Diagram the situation
  console.log("\n--- Current branch structure ---");
  console.log(`
    main:    ----o---o---o (main-only, another-main)
                  \\
    feature:       o---o (feature-only, another-feature)
                       ^HEAD
  `);
  console.log("  Both branches have diverged from a common ancestor.");
  console.log("  A three-way merge is required.");

  // Switch back to main for merge
  await store.refs.setSymbolic("HEAD", "refs/heads/main");
  const mainRef = await store.refs.resolve("refs/heads/main");
  if (mainRef?.objectId) {
    const commit = await store.commits.loadCommit(mainRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }

  // Explain three-way merge
  console.log("\n--- What is a three-way merge? ---");
  console.log(`
  Three-way merge compares:
    1. Common ancestor (merge base)
    2. Current branch (ours/HEAD)
    3. Branch being merged (theirs)

  For each file:
    - If only ours changed: keep ours
    - If only theirs changed: keep theirs
    - If both changed the same way: keep either
    - If both changed differently: CONFLICT
  `);

  // Perform three-way merge
  console.log("\n--- Performing three-way merge ---");
  const result = await git.merge().include("feature-3way").call();

  console.log(`\n  Merge result:`);
  console.log(`    Status: ${result.status}`);
  console.log(`    New HEAD: ${result.newHead ? shortId(result.newHead) : "none"}`);
  console.log(`    Merge base: ${result.mergeBase ? shortId(result.mergeBase) : "none"}`);

  if (result.status === MergeStatus.MERGED && result.newHead) {
    // Verify merge commit has two parents
    const mergeCommit = await store.commits.loadCommit(result.newHead);
    console.log(`\n  Merge commit details:`);
    console.log(`    Parents: ${mergeCommit.parents.length}`);
    for (const parent of mergeCommit.parents) {
      console.log(`      - ${shortId(parent)}`);
    }
    console.log(`    Message: ${mergeCommit.message}`);
  }

  console.log("\n--- After merge ---");
  console.log(`
    main:    ----o---o---o---M (merge commit)
                  \\         /
    feature:       o-------o
  `);
  console.log("  The merge commit 'M' has two parents.");
  console.log("  All files from both branches are now available on main.");

  console.log("\nStep 4 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 4: Three-Way Merge");
  step04ThreeWayMerge()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
