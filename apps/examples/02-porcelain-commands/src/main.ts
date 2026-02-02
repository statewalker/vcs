/**
 * Main Entry Point: Porcelain Commands Example
 *
 * This script runs all steps demonstrating the Git Commands API.
 *
 * Run with: pnpm start
 *
 * Individual steps can also be run separately:
 *   pnpm step:01  - Initialize and commit
 *   pnpm step:02  - Branching
 *   pnpm step:03  - Checkout
 *   pnpm step:04  - Merge
 *   pnpm step:05  - Log and diff
 *   pnpm step:06  - Status
 *   pnpm step:07  - Tags
 *   pnpm step:08  - Stash
 */

import { printSection, resetState } from "./shared.js";
import { step01InitAndCommit } from "./steps/01-init-and-commit.js";
import { step02Branching } from "./steps/02-branching.js";
import { step03Checkout } from "./steps/03-checkout.js";
import { step04Merge } from "./steps/04-merge.js";
import { step05LogDiff } from "./steps/05-log-diff.js";
import { step06Status } from "./steps/06-status.js";
import { step07Tag } from "./steps/07-tag.js";
import { step08Stash } from "./steps/08-stash.js";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               statewalker-vcs: Porcelain Commands Example                    ║
║                                                                              ║
║  This example demonstrates the high-level Git Commands API (porcelain).      ║
║  All operations use in-memory storage for demonstration.                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Reset any previous state
    await resetState();

    // Step 1: Initialize and Commit
    printSection("Step 1: Initialize and Commit");
    await step01InitAndCommit();

    // Step 2: Branching
    printSection("Step 2: Branching");
    await step02Branching();

    // Step 3: Checkout
    printSection("Step 3: Checkout");
    await step03Checkout();

    // Step 4: Merge
    printSection("Step 4: Merge");
    await step04Merge();

    // Step 5: Log and Diff
    printSection("Step 5: Log and Diff");
    await step05LogDiff();

    // Step 6: Status
    printSection("Step 6: Status");
    await step06Status();

    // Step 7: Tags
    printSection("Step 7: Tags");
    await step07Tag();

    // Step 8: Stash
    printSection("Step 8: Stash");
    await step08Stash();

    // Final summary
    printSection("Complete!");

    console.log(`
  All steps completed successfully.

  This example demonstrated the Git Commands API (porcelain layer):

    1. Initialize and Commit
       - Git.fromWorkingCopy() creates a Git facade
       - git.commit() creates commits from staged changes

    2. Branching
       - git.branchCreate() creates new branches
       - git.branchList() lists all branches
       - git.branchDelete() removes branches

    3. Checkout
       - git.checkout() switches branches
       - setCreateBranch(true) creates and switches in one step

    4. Merge
       - git.merge() merges branches
       - Supports fast-forward and three-way merges
       - Different merge strategies available

    5. Log and Diff
       - git.log() traverses commit history
       - git.diff() compares trees between commits

    6. Status
       - git.status() shows repository state
       - Reports added, changed, removed, and conflicting files

    7. Tags
       - git.tag() creates lightweight and annotated tags
       - git.tagList() lists all tags
       - git.tagDelete() removes tags

    8. Stash
       - git.stashCreate() saves work in progress
       - git.stashList() shows saved stashes
       - git.stashApply() restores stashed changes

  For more details, see the README.md file.
`);
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

// Run the example
main();
