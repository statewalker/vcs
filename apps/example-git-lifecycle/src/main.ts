/**
 * Example: Full Git Lifecycle with GC and Pack Verification
 *
 * This example demonstrates the complete lifecycle of a Git repository:
 * 1. Initialize repository with FilesApi
 * 2. Create initial project with files in multiple folders
 * 3. Generate 20 commits with incremental changes
 * 4. Verify loose objects exist in filesystem
 * 5. Perform garbage collection
 * 6. Verify packed objects via FilesApi
 * 7. Verify repository validity with native git
 * 8. Checkout first version using VCS
 * 9. Verify checkout matches stored version
 *
 * Run with: pnpm start
 * Run individual step: pnpm step:01 (through step:09)
 */

import { state } from "./shared/index.js";

// Import all steps
import * as step01 from "./steps/01-init-repo.js";
import * as step02 from "./steps/02-create-files.js";
import * as step03 from "./steps/03-generate-commits.js";
import * as step04 from "./steps/04-verify-loose.js";
import * as step05 from "./steps/05-run-gc.js";
import * as step06 from "./steps/06-verify-packed.js";
import * as step07 from "./steps/07-verify-native-git.js";
import * as step08 from "./steps/08-checkout-first.js";
import * as step09 from "./steps/09-verify-checkout.js";

const steps = [
  { num: "01", name: "Initialize Repository", run: step01.run },
  { num: "02", name: "Create Initial Files", run: step02.run },
  { num: "03", name: "Generate Commits", run: step03.run },
  { num: "04", name: "Verify Loose Objects", run: step04.run },
  { num: "05", name: "Run Garbage Collection", run: step05.run },
  { num: "06", name: "Verify Packed Objects", run: step06.run },
  { num: "07", name: "Verify with Native Git", run: step07.run },
  { num: "08", name: "Checkout First Version", run: step08.run },
  { num: "09", name: "Verify Checkout", run: step09.run },
];

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║              webrun-vcs: Full Git Lifecycle Example                          ║
║                                                                              ║
║  Demonstrates: repository creation, commits, GC, packing, and checkout       ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

function printSummary(): void {
  console.log(`
══════════════════════════════════════════════════════════════════════════════
  SUMMARY
══════════════════════════════════════════════════════════════════════════════

  This example demonstrated the complete Git lifecycle:

  ✓ Step 01: Created Git repository using VCS with FilesApi
  ✓ Step 02: Created project structure with ${state.initialFiles.size} files
  ✓ Step 03: Generated ${state.commits.length} commits with incremental changes
  ✓ Step 04: Verified loose objects in .git/objects
  ✓ Step 05: Performed garbage collection (gc)
  ✓ Step 06: Verified objects readable from pack files
  ✓ Step 07: Verified repository validity with native git
  ✓ Step 08: Checked out first commit using VCS
  ✓ Step 09: Verified checkout matches original content

  The VCS library successfully:
  - Created a valid Git repository
  - Stored commits, trees, and blobs
  - Maintained compatibility with native git
  - Supported checkout operations

══════════════════════════════════════════════════════════════════════════════
`);
}

async function runStep(stepNum: string): Promise<void> {
  const step = steps.find((s) => s.num === stepNum);
  if (!step) {
    console.error(`Unknown step: ${stepNum}`);
    console.log("Available steps:", steps.map((s) => s.num).join(", "));
    process.exit(1);
  }

  printBanner();
  console.log(`Running Step ${step.num}: ${step.name}\n`);

  try {
    await step.run();
    console.log(`\n✓ Step ${step.num} completed successfully\n`);
  } catch (error) {
    console.error(`\n✗ Step ${step.num} failed:`, (error as Error).message);
    process.exit(1);
  }
}

async function runAllSteps(): Promise<void> {
  printBanner();

  const startTime = Date.now();

  for (const step of steps) {
    try {
      await step.run();
    } catch (error) {
      console.error(`\n✗ Step ${step.num} failed:`, (error as Error).message);
      console.error((error as Error).stack);
      process.exit(1);
    }
  }

  // Close repository if still open
  if (state.repository) {
    await state.repository.close();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  printSummary();
  console.log(`  Total time: ${duration}s\n`);
}

// Parse command line arguments
const args = process.argv.slice(2);
const stepArg = args.find((a) => a.startsWith("--step="));

if (stepArg) {
  const stepNum = stepArg.split("=")[1].padStart(2, "0");
  runStep(stepNum).catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
} else {
  runAllSteps().catch((error) => {
    console.error("Error:", error);
    process.exit(1);
  });
}
