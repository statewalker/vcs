/**
 * Step 2: Commit Ancestry
 *
 * Demonstrates ancestor checks and finding merge bases.
 */

import {
  addFileToStaging,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step02CommitAncestry(): Promise<void> {
  printStep(2, "Commit Ancestry");

  await resetState();
  const { git, workingCopy, history } = await getGit();

  // Setup: create commits and branches
  console.log("\n--- Setting up commit graph ---");

  await addFileToStaging(workingCopy, "README.md", "# Ancestry Demo");
  await git.commit().setMessage("Initial commit (A)").call();
  const headA = await history.refs.resolve("HEAD");
  const commitA = headA?.objectId ?? "";
  console.log(`  A: ${shortId(commitA)} - Initial commit`);

  await addFileToStaging(workingCopy, "file1.ts", "content1");
  await git.commit().setMessage("Second commit (B)").call();
  const headB = await history.refs.resolve("HEAD");
  const commitB = headB?.objectId ?? "";
  console.log(`  B: ${shortId(commitB)} - Second commit`);

  // Create a branch and diverge
  await git.branchCreate().setName("feature").call();

  // Continue on main
  await addFileToStaging(workingCopy, "main-file.ts", "main content");
  await git.commit().setMessage("Main commit (C)").call();
  const headC = await history.refs.resolve("HEAD");
  const commitC = headC?.objectId ?? "";
  console.log(`  C: ${shortId(commitC)} - Main commit`);

  // Switch to feature and add commit
  await history.refs.setSymbolic("HEAD", "refs/heads/feature");
  const featureRef = await history.refs.resolve("refs/heads/feature");
  if (featureRef?.objectId) {
    const commit = await history.commits.load(featureRef.objectId);
    if (commit) {
      await workingCopy.checkout.staging.readTree(history.trees, commit.tree);
    }
  }

  await addFileToStaging(workingCopy, "feature-file.ts", "feature content");
  await git.commit().setMessage("Feature commit (D)").call();
  const headD = await history.refs.resolve("HEAD");
  const commitD = headD?.objectId ?? "";
  console.log(`  D: ${shortId(commitD)} - Feature commit`);

  // Diagram
  console.log("\n--- Commit graph ---");
  console.log(`
    A---B---C  (main)
         \\
          D  (feature)

    A is ancestor of all
    B is common ancestor of C and D
  `);

  // Check ancestry
  console.log("\n--- Checking ancestry ---");

  // Is A ancestor of C?
  const aIsAncestorOfC = await isAncestor(history, commitA, commitC);
  console.log(`  Is A ancestor of C? ${aIsAncestorOfC}`); // true

  // Is A ancestor of D?
  const aIsAncestorOfD = await isAncestor(history, commitA, commitD);
  console.log(`  Is A ancestor of D? ${aIsAncestorOfD}`); // true

  // Is C ancestor of D?
  const cIsAncestorOfD = await isAncestor(history, commitC, commitD);
  console.log(`  Is C ancestor of D? ${cIsAncestorOfD}`); // false

  // Is D ancestor of C?
  const dIsAncestorOfC = await isAncestor(history, commitD, commitC);
  console.log(`  Is D ancestor of C? ${dIsAncestorOfC}`); // false

  // Find merge base (common ancestor)
  console.log("\n--- Finding merge base ---");
  console.log("\nMerge base is the common ancestor used for three-way merges.");

  const mergeBase = await history.commits.findMergeBase(commitC, commitD);
  if (mergeBase.length > 0) {
    console.log(`\n  Merge base of C and D: ${shortId(mergeBase[0])}`);
    const baseCommit = await history.commits.load(mergeBase[0]);
    if (baseCommit) {
      console.log(`  Message: "${baseCommit.message.split("\n")[0]}"`);
      console.log(`  (This should be B)`);
    }
  }

  // Merge base between B and D
  const mergeBase2 = await history.commits.findMergeBase(commitB, commitD);
  if (mergeBase2.length > 0) {
    console.log(`\n  Merge base of B and D: ${shortId(mergeBase2[0])}`);
    console.log(`  (Should be B itself, since B is ancestor of D)`);
  }

  console.log("\n--- Use cases for ancestry checks ---");
  console.log(`
  1. Fast-forward detection:
     Can fast-forward if HEAD is ancestor of merge source

  2. Merge base finding:
     Required for three-way merge to find common ancestor

  3. Branch relationship:
     Determine if one branch has been merged into another

  4. Rebase checks:
     Verify commits haven't been rebased (ancestry changed)
  `);

  console.log("\nStep 2 completed!");
}

/**
 * Check if commitA is an ancestor of commitB
 */
async function isAncestor(
  history: Awaited<ReturnType<typeof getGit>>["history"],
  commitA: string,
  commitB: string,
): Promise<boolean> {
  if (commitA === commitB) return true;

  const visited = new Set<string>();
  const queue: string[] = [commitB];

  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (visited.has(current)) continue;
    visited.add(current);

    if (current === commitA) return true;

    try {
      const commit = await history.commits.load(current);
      if (commit) {
        for (const parent of commit.parents) {
          if (!visited.has(parent)) {
            queue.push(parent);
          }
        }
      }
    } catch {
      // Commit not found
    }
  }

  return false;
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 2: Commit Ancestry");
  step02CommitAncestry()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
