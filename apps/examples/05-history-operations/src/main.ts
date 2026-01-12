/**
 * Main Entry Point: History Operations Example
 *
 * This script runs all steps demonstrating history operations.
 *
 * Run with: pnpm start
 *
 * Individual steps can also be run separately:
 *   pnpm step:01  - Log traversal
 *   pnpm step:02  - Commit ancestry
 *   pnpm step:03  - Diff commits
 *   pnpm step:04  - Blame
 *   pnpm step:05  - File history
 */

import { printSection, resetState } from "./shared.js";
import { step01LogTraversal } from "./steps/01-log-traversal.js";
import { step02CommitAncestry } from "./steps/02-commit-ancestry.js";
import { step03DiffCommits } from "./steps/03-diff-commits.js";
import { step04Blame } from "./steps/04-blame.js";
import { step05FileHistory } from "./steps/05-file-history.js";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               statewalker-vcs: History Operations Example                    ║
║                                                                              ║
║  This example demonstrates working with repository history:                  ║
║  log traversal, ancestry, diff, blame, and file history tracking.            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Step 1: Log Traversal
    printSection("Step 1: Log Traversal");
    await step01LogTraversal();

    // Step 2: Commit Ancestry
    printSection("Step 2: Commit Ancestry");
    await step02CommitAncestry();

    // Step 3: Diff Commits
    printSection("Step 3: Diff Commits");
    resetState();
    await step03DiffCommits();

    // Step 4: Blame
    printSection("Step 4: Blame");
    await step04Blame();

    // Step 5: File History
    printSection("Step 5: File History");
    await step05FileHistory();

    // Final summary
    printSection("Complete!");

    console.log(`
  All steps completed successfully.

  This example covered:

    1. Log Traversal
       - git.log() for commit history
       - Limiting results with setMaxCount()
       - Low-level walkAncestry()

    2. Commit Ancestry
       - Checking if commits are ancestors
       - Finding merge base (common ancestor)
       - Use cases for ancestry checks

    3. Diff Between Commits
       - git.diff() for comparing commits
       - Change types: ADD, DELETE, MODIFY, RENAME
       - DiffEntry structure

    4. Blame
       - git.blame() for line attribution
       - BlameEntry and BlameResult
       - Tracking line origins

    5. File History
       - Tracking changes to specific files
       - Comparing file versions
       - Different history tracking approaches

  For more details, see the README.md file.
`);
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

// Run the example
main();
