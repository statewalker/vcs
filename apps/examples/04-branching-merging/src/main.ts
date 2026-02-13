/**
 * Main Entry Point: Branching and Merging Example
 *
 * This script runs all steps demonstrating branch operations and merge strategies.
 *
 * Run with: pnpm start
 *
 * Individual steps can also be run separately:
 *   pnpm step:01  - Branch creation
 *   pnpm step:02  - HEAD management
 *   pnpm step:03  - Fast-forward merge
 *   pnpm step:04  - Three-way merge
 *   pnpm step:05  - Merge strategies
 *   pnpm step:06  - Conflict handling
 *   pnpm step:07  - Rebase concepts
 */

import { printSection, resetState } from "./shared.js";
import { step01BranchCreation } from "./steps/01-branch-creation.js";
import { step02HeadManagement } from "./steps/02-head-management.js";
import { step03FastForward } from "./steps/03-fast-forward.js";
import { step04ThreeWayMerge } from "./steps/04-three-way-merge.js";
import { step05MergeStrategies } from "./steps/05-merge-strategies.js";
import { step06ConflictHandling } from "./steps/06-conflict-handling.js";
import { step07RebaseConcepts } from "./steps/07-rebase-concepts.js";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               statewalker-vcs: Branching and Merging Example                 ║
║                                                                              ║
║  This example provides a deep dive into Git branch operations and            ║
║  merge strategies. All operations use in-memory storage.                     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Step 1: Branch Creation
    printSection("Step 1: Branch Creation");
    await resetState();
    await step01BranchCreation();

    // Step 2: HEAD Management
    printSection("Step 2: HEAD Management");
    await resetState();
    await step02HeadManagement();

    // Step 3: Fast-Forward Merge
    printSection("Step 3: Fast-Forward Merge");
    await step03FastForward();

    // Step 4: Three-Way Merge
    printSection("Step 4: Three-Way Merge");
    await step04ThreeWayMerge();

    // Step 5: Merge Strategies
    printSection("Step 5: Merge Strategies");
    await step05MergeStrategies();

    // Step 6: Conflict Handling
    printSection("Step 6: Conflict Handling");
    await step06ConflictHandling();

    // Step 7: Rebase Concepts
    printSection("Step 7: Rebase Concepts");
    await step07RebaseConcepts();

    // Final summary
    printSection("Complete!");

    console.log(`
  All steps completed successfully.

  This example covered:

    1. Branch Creation
       - Creating branches with git.branchCreate()
       - Listing branches with git.branchList()
       - Low-level ref operations

    2. HEAD Management
       - Understanding symbolic refs
       - Switching branches
       - Detached HEAD state

    3. Fast-Forward Merge
       - Linear history merging
       - FastForwardMode options

    4. Three-Way Merge
       - Divergent branch merging
       - Merge commits with multiple parents
       - Merge base (common ancestor)

    5. Merge Strategies
       - MergeStrategy.RECURSIVE (default)
       - MergeStrategy.OURS / THEIRS
       - ContentMergeStrategy options

    6. Conflict Handling
       - Understanding conflict scenarios
       - Staging area stages (0-3)
       - Resolution strategies

    7. Rebase Concepts
       - Merge vs Rebase tradeoffs
       - When to use each approach
       - Safety considerations

  For more details, see the README.md file.
`);
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

// Run the example
main();
