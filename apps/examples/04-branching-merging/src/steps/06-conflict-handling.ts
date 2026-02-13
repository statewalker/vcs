/**
 * Step 6: Conflict Handling
 *
 * Demonstrates detecting and understanding merge conflicts.
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

export async function step06ConflictHandling(): Promise<void> {
  printStep(6, "Conflict Handling");

  console.log("\n--- When do conflicts occur? ---");
  console.log(`
  Conflicts occur when:
    - Both branches modified the same lines in a file
    - One branch deleted a file that the other modified
    - Both branches added a file with the same name but different content

  The merge cannot automatically determine which version to keep.
  `);

  // Create a conflict scenario
  console.log("\n--- Creating a conflict scenario ---");
  await resetState();
  const { git, workingCopy, history } = await getGit();

  // Initial commit with a file
  await addFileToStaging(
    workingCopy,
    "app.config.ts",
    `export const config = {
  version: "1.0.0",
  name: "MyApp",
  debug: false,
};
`,
  );
  await git.commit().setMessage("Initial config").call();
  console.log("  Created initial config file");

  // Create a branch
  await git.branchCreate().setName("conflict-branch").call();

  // Modify on main (change debug to true)
  await addFileToStaging(
    workingCopy,
    "app.config.ts",
    `export const config = {
  version: "1.0.0",
  name: "MyApp",
  debug: true,  // Changed on main
};
`,
  );
  await git.commit().setMessage("Enable debug on main").call();
  console.log("  Modified config on main (debug: true)");

  // Switch to branch and modify differently
  await history.refs.setSymbolic("HEAD", "refs/heads/conflict-branch");
  const branchRef = await history.refs.resolve("refs/heads/conflict-branch");
  if (branchRef?.objectId) {
    const commit = await history.commits.load(branchRef.objectId);
    if (commit) {
      await workingCopy.checkout.staging.readTree(history.trees, commit.tree);
    }
  }

  await addFileToStaging(
    workingCopy,
    "app.config.ts",
    `export const config = {
  version: "2.0.0",  // Changed version
  name: "MyApp",
  debug: false,
};
`,
  );
  await git.commit().setMessage("Bump version on branch").call();
  console.log("  Modified config on branch (version: 2.0.0)");

  // Diagram
  console.log("\n--- Branch structure ---");
  console.log(`
    main:   ---o---o (debug: true)
                \\
    branch:      o (version: 2.0.0)

    Both branches modified app.config.ts differently!
  `);

  // Switch back to main and try to merge
  await history.refs.setSymbolic("HEAD", "refs/heads/main");
  const mainRef = await history.refs.resolve("refs/heads/main");
  if (mainRef?.objectId) {
    const commit = await history.commits.load(mainRef.objectId);
    if (commit) {
      await workingCopy.checkout.staging.readTree(history.trees, commit.tree);
    }
  }

  // Attempt merge
  console.log("\n--- Attempting merge ---");
  const result = await git.merge().include("conflict-branch").call();

  console.log(`  Merge result:`);
  console.log(`    Status: ${result.status}`);

  if (result.status === MergeStatus.CONFLICTING) {
    console.log(`    Conflicts: ${result.conflicts?.length || 0} file(s)`);
    if (result.conflicts) {
      for (const conflictPath of result.conflicts) {
        console.log(`      - ${conflictPath}`);
      }
    }

    console.log("\n--- Understanding the conflict ---");
    console.log(`
  The staging area now contains conflict markers (stages 1-3):
    Stage 0: Merged (no conflict) - normal entries
    Stage 1: BASE - common ancestor version
    Stage 2: OURS - our version (main)
    Stage 3: THEIRS - their version (branch)

  To resolve:
    1. Examine all three versions
    2. Create the final merged version
    3. Stage the resolved file (stage 0)
    4. Complete the merge with a commit
    `);

    // Show staging state
    console.log("\n--- Staging area with conflicts ---");
    for await (const entry of workingCopy.checkout.staging.entries()) {
      const stageName =
        entry.stage === 0
          ? "MERGED"
          : entry.stage === 1
            ? "BASE"
            : entry.stage === 2
              ? "OURS"
              : "THEIRS";
      console.log(`    ${entry.path} [${stageName}] -> ${shortId(entry.objectId)}`);
    }
  } else if (result.status === MergeStatus.MERGED) {
    console.log("  Note: No conflict occurred (changes were in different parts of file)");
  }

  console.log("\n--- Resolving conflicts ---");
  console.log(`
  Resolution strategies:
    1. Manual resolution:
       - Read all three versions
       - Create combined version
       - Stage with stage 0

    2. Use content strategy:
       - ContentMergeStrategy.OURS - keep our version
       - ContentMergeStrategy.THEIRS - keep their version
       - ContentMergeStrategy.UNION - concatenate both

    3. Abort the merge:
       - Reset staging to pre-merge state
       - HEAD remains unchanged
  `);

  console.log("\nStep 6 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 6: Conflict Handling");
  step06ConflictHandling()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
