/**
 * Step 05: Merge Operations
 *
 * Demonstrates different merge scenarios using git.merge():
 * - Fast-forward merge
 * - Three-way merge
 * - Merge strategies
 */

import { MergeStrategy } from "@statewalker/vcs-commands";
import { log, logInfo, logSection, logSuccess, shortId, state } from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 05: Merge Operations");

  const { git } = state;
  if (!git) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  // Ensure we're on main branch using git.checkout()
  log("\nEnsuring we're on 'main' branch...");
  await git.checkout().setName("main").call();
  logSuccess("On 'main' branch");

  // Fast-forward merge of bugfix branch
  log("\nMerging 'bugfix' into 'main' (fast-forward)...");
  const bugfixMerge = await git.merge().include("bugfix").call();

  log(`  Merge status: ${bugfixMerge.status}`);
  if (bugfixMerge.newHead) {
    logSuccess(`Merged bugfix. New HEAD: ${shortId(bugfixMerge.newHead)}`);
  }

  // Three-way merge of feature branch
  log("\nMerging 'feature' into 'main' (three-way merge)...");
  const featureMerge = await git
    .merge()
    .include("feature")
    .setStrategy(MergeStrategy.RECURSIVE)
    .call();

  log(`  Merge status: ${featureMerge.status}`);
  if (featureMerge.newHead) {
    logSuccess(`Merged feature. New HEAD: ${shortId(featureMerge.newHead)}`);
  }

  // Show merge strategies available
  log("\nAvailable merge strategies:");
  console.log(`    - ${MergeStrategy.RECURSIVE} (default - three-way merge)`);
  console.log(`    - ${MergeStrategy.OURS} (keep our changes)`);
  console.log(`    - ${MergeStrategy.THEIRS} (keep their changes)`);

  // Show commit history after merges using git.log()
  log("\nCommit history after merges:");
  let count = 0;
  for await (const commit of await git.log().call()) {
    const msgLine = commit.message.trim().split("\n")[0];
    console.log(`    - ${msgLine}`);
    count++;
    if (count >= 5) {
      console.log("    ...");
      break;
    }
  }

  // Cleanup - delete merged branches
  log("\nCleaning up merged branches...");
  await git.branchDelete().setBranchNames("bugfix", "feature").call();
  logSuccess("Deleted 'bugfix' and 'feature' branches");

  // Final branch list
  log("\nFinal branch list:");
  const finalBranches = await git.branchList().call();
  for (const branch of finalBranches) {
    console.log(`    - ${branch.name}`);
  }

  logInfo("Total commits after merges", state.commits.length);
  logSuccess("Merge operations complete!");
}
