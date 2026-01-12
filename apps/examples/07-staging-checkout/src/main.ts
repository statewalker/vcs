/**
 * Main Entry Point: Staging and Checkout Example
 *
 * This script runs all steps demonstrating staging and checkout operations.
 *
 * Run with: pnpm start
 *
 * Individual steps can also be run separately:
 *   pnpm step:01  - Staging concepts
 *   pnpm step:02  - Staging changes
 *   pnpm step:03  - Unstaging
 *   pnpm step:04  - Status
 *   pnpm step:05  - Checkout files
 *   pnpm step:06  - Checkout branches
 *   pnpm step:07  - Clean and reset
 */

import { printSection, resetState } from "./shared.js";
import { step01StagingConcepts } from "./steps/01-staging-concepts.js";
import { step02StagingChanges } from "./steps/02-staging-changes.js";
import { step03Unstaging } from "./steps/03-unstaging.js";
import { step04Status } from "./steps/04-status.js";
import { step05CheckoutFiles } from "./steps/05-checkout-files.js";
import { step06CheckoutBranches } from "./steps/06-checkout-branches.js";
import { step07CleanReset } from "./steps/07-clean-reset.js";

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║               statewalker-vcs: Staging and Checkout Example                  ║
║                                                                              ║
║  This example demonstrates working directory and staging area operations:    ║
║  staging, unstaging, status, checkout, and reset.                            ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);

  try {
    // Step 1: Staging Concepts
    printSection("Step 1: Staging Concepts");
    await step01StagingConcepts();

    // Step 2: Staging Changes
    printSection("Step 2: Staging Changes");
    resetState();
    await step02StagingChanges();

    // Step 3: Unstaging
    printSection("Step 3: Unstaging");
    await step03Unstaging();

    // Step 4: Status
    printSection("Step 4: Status");
    await step04Status();

    // Step 5: Checkout Files
    printSection("Step 5: Checkout Files");
    await step05CheckoutFiles();

    // Step 6: Checkout Branches
    printSection("Step 6: Checkout Branches");
    await step06CheckoutBranches();

    // Step 7: Clean and Reset
    printSection("Step 7: Clean and Reset");
    await step07CleanReset();

    // Final summary
    printSection("Complete!");

    console.log(`
  All steps completed successfully.

  This example covered:

    1. Staging Concepts
       - Index/staging area role
       - Entry structure (path, mode, objectId, stage)
       - Merge stages

    2. Staging Changes
       - git.add() porcelain API
       - Low-level staging editor
       - Staging builder

    3. Unstaging
       - git.reset() to unstage
       - Editor remove()
       - Rebuild staging

    4. Status
       - git.status() for repository state
       - Added, changed, removed, conflicting files

    5. Checkout Files
       - Restore files from commits
       - File vs branch checkout

    6. Checkout Branches
       - git.checkout() for branches
       - Low-level HEAD/staging updates

    7. Clean and Reset
       - Reset modes (soft, mixed, hard)
       - Clean untracked files

  For more details, see the README.md file.
`);
  } catch (error) {
    console.error("\nError:", error);
    process.exit(1);
  }
}

// Run the example
main();
