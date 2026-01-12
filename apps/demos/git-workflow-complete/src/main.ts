/**
 * Demo: Complete Git Workflow
 *
 * This demo showcases a complete Git workflow including:
 * 1. Initialize repository with FilesApi
 * 2. Create initial project with files in multiple folders
 * 3. Generate commits with incremental changes
 * 4. Create and manage branches
 * 5. Perform merge operations (fast-forward and three-way)
 * 6. View diffs between commits
 * 7. Perform garbage collection and pack files
 * 8. Checkout a specific version
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
import * as step04 from "./steps/04-branching.js";
import * as step05 from "./steps/05-merging.js";
import * as step06 from "./steps/06-diff-viewer.js";
import * as step07 from "./steps/07-gc-packing.js";
import * as step08 from "./steps/08-checkout.js";
import * as step09 from "./steps/09-verification.js";

const steps = [
  { num: "01", name: "Initialize Repository", run: step01.run },
  { num: "02", name: "Create Initial Files", run: step02.run },
  { num: "03", name: "Generate Commits", run: step03.run },
  { num: "04", name: "Branch Operations", run: step04.run },
  { num: "05", name: "Merge Operations", run: step05.run },
  { num: "06", name: "Diff Viewer", run: step06.run },
  { num: "07", name: "Garbage Collection & Packing", run: step07.run },
  { num: "08", name: "Checkout First Version", run: step08.run },
  { num: "09", name: "Verify Checkout", run: step09.run },
];

function printBanner(): void {
  console.log(`
╔══════════════════════════════════════════════════════════════════════════════╗
║                                                                              ║
║              WebRun VCS: Complete Git Workflow Demo                          ║
║                                                                              ║
║  Demonstrates: branching, merging, diffs, GC, packing, and checkout         ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

function printSummary(): void {
  console.log(`
══════════════════════════════════════════════════════════════════════════════
  SUMMARY
══════════════════════════════════════════════════════════════════════════════

  This demo demonstrated the complete Git workflow:

  ✓ Step 01: Created Git repository using VCS with FilesApi
  ✓ Step 02: Created project structure with ${state.initialFiles.size} files
  ✓ Step 03: Generated ${state.commits.filter((c) => c.branch === "main" || !c.branch).length} commits on main branch
  ✓ Step 04: Created and managed branches (feature, bugfix)
  ✓ Step 05: Performed merge operations (fast-forward and three-way)
  ✓ Step 06: Displayed diffs between commits
  ✓ Step 07: Performed garbage collection and packing
  ✓ Step 08: Checked out first commit using native git
  ✓ Step 09: Verified checkout matches original content

  The VCS library successfully:
  - Created a valid Git repository
  - Managed branches and merges
  - Generated diffs between versions
  - Packed objects efficiently
  - Maintained compatibility with native git

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
