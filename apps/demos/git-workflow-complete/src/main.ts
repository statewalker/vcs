/**
 * Demo: Complete Git Workflow using Porcelain Commands
 *
 * This demo uses ONLY porcelain commands from @statewalker/vcs-commands:
 *
 * - Git.init() for repository initialization
 * - git.add() for staging files from working tree
 * - git.commit() for creating commits
 * - git.checkout() for switching branches
 * - git.merge() for merging branches
 * - git.log() for viewing commit history
 * - git.diff() for comparing commits
 * - git.gc() for repository maintenance
 * - git.status() for staging area status
 *
 * NO low-level API or native git commands are used.
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
║  Using ONLY porcelain commands: Git.init(), add(), commit(), checkout()     ║
║                                                                              ║
╚══════════════════════════════════════════════════════════════════════════════╝
`);
}

function printSummary(): void {
  console.log(`
══════════════════════════════════════════════════════════════════════════════
  SUMMARY - Porcelain Commands Demo
══════════════════════════════════════════════════════════════════════════════

  This demo used ONLY porcelain commands from @statewalker/vcs-commands:

  ✓ Step 01: Git.init() - Created repository with FilesAPI and worktree
  ✓ Step 02: git.add() + git.commit() - Created ${state.initialFiles.size} files
  ✓ Step 03: git.add() + git.commit() - Generated ${state.commits.filter((c) => c.branch === "main" || !c.branch).length} commits
  ✓ Step 04: git.checkout() - Created and switched branches
  ✓ Step 05: git.merge() - Fast-forward and three-way merges
  ✓ Step 06: git.log() + git.diff() - Viewed commit history and diffs
  ✓ Step 07: git.gc() - Repository maintenance (packed refs)
  ✓ Step 08: git.checkout() - Checked out first commit
  ✓ Step 09: git.status() - Verified staging area and content

  All operations used the fluent builder API:
    await git.add().addFilepattern(".").call();
    await git.checkout().setName("feature").call();
    await git.merge().include("feature").call();

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
