/**
 * Step 7: Rebase Concepts
 *
 * Explains rebase concepts and demonstrates basic usage.
 */

import {
  addFileToStaging,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step07RebaseConcepts(): Promise<void> {
  printStep(7, "Rebase Concepts");

  console.log("\n--- What is Rebase? ---");
  console.log(`
  Rebase rewrites history by replaying commits on top of another branch.

  Before rebase:
    main:    ---A---B---C
                 \\
    feature:      D---E

  After rebase (rebase feature onto main):
    main:    ---A---B---C
                         \\
    feature:              D'---E'

  Note: D' and E' are NEW commits (different hashes)
  The original D and E are orphaned.
  `);

  console.log("\n--- Merge vs Rebase ---");
  console.log(`
  ┌────────────────────────────────────────────────────────────┐
  │                    MERGE                                   │
  ├────────────────────────────────────────────────────────────┤
  │ - Creates a merge commit                                   │
  │ - Preserves exact history                                  │
  │ - Shows when branches were created/merged                  │
  │ - Safe for shared branches                                 │
  │                                                            │
  │ Result:     ---A---B---C---M                               │
  │                  \\       /                                  │
  │                   D-----E                                  │
  └────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────┐
  │                    REBASE                                  │
  ├────────────────────────────────────────────────────────────┤
  │ - Rewrites commit history                                  │
  │ - Creates linear history                                   │
  │ - Cleaner git log                                          │
  │ - DANGEROUS for shared branches (rewrites history!)        │
  │                                                            │
  │ Result:     ---A---B---C---D'---E'                         │
  └────────────────────────────────────────────────────────────┘
  `);

  // Demonstrate rebase setup
  console.log("\n--- Demo: Setting up for rebase ---");
  await resetState();
  const { git, workingCopy, history } = await getGit();

  // Create initial commit
  await addFileToStaging(workingCopy, "README.md", "# Rebase Demo");
  await git.commit().setMessage("Initial commit").call();

  // Create feature branch
  await git.branchCreate().setName("feature-rebase").call();

  // Add commits on main
  await addFileToStaging(workingCopy, "main-1.ts", "// Main commit 1");
  const mainCommit1 = await git.commit().setMessage("Main commit 1").call();
  console.log(`  Main commit 1: ${shortId(await history.commits.store(mainCommit1))}`);

  await addFileToStaging(workingCopy, "main-2.ts", "// Main commit 2");
  const mainCommit2 = await git.commit().setMessage("Main commit 2").call();
  console.log(`  Main commit 2: ${shortId(await history.commits.store(mainCommit2))}`);

  // Switch to feature and add commits
  await history.refs.setSymbolic("HEAD", "refs/heads/feature-rebase");
  const featureRef = await history.refs.resolve("refs/heads/feature-rebase");
  if (featureRef?.objectId) {
    const commit = await history.commits.load(featureRef.objectId);
    if (commit) {
      await workingCopy.checkout.staging.readTree(history.trees, commit.tree);
    }
  }

  await addFileToStaging(workingCopy, "feature-1.ts", "// Feature commit 1");
  const featureCommit1 = await git.commit().setMessage("Feature commit 1").call();
  console.log(`  Feature commit 1: ${shortId(await history.commits.store(featureCommit1))}`);

  await addFileToStaging(workingCopy, "feature-2.ts", "// Feature commit 2");
  const featureCommit2 = await git.commit().setMessage("Feature commit 2").call();
  console.log(`  Feature commit 2: ${shortId(await history.commits.store(featureCommit2))}`);

  console.log("\n--- Current state ---");
  console.log(`
    main:    ---o---o---o (main-1, main-2)
                 \\
    feature:      o---o (feature-1, feature-2)
                      ^HEAD

  To rebase feature onto main:
    git.rebase().setUpstream("main").call()

  This would create:
    main:    ---o---o---o
                         \\
    feature:              o'---o' (rebased commits)
  `);

  console.log("\n--- When to use Rebase ---");
  console.log(`
  USE REBASE when:
    - Working on a local feature branch
    - Want clean, linear history
    - Keeping up with main before PR

  AVOID REBASE when:
    - Branch is shared with others
    - Commits have been pushed
    - Working with merge commits

  Golden Rule: Never rebase commits that exist outside your repository
  `);

  console.log("\n--- Interactive Rebase ---");
  console.log(`
  Interactive rebase (git rebase -i) allows:
    - Reordering commits
    - Squashing multiple commits into one
    - Editing commit messages
    - Splitting commits
    - Dropping commits

  Note: Interactive rebase is not yet fully supported
        in this VCS implementation.
  `);

  console.log("\nStep 7 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 7: Rebase Concepts");
  step07RebaseConcepts()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
