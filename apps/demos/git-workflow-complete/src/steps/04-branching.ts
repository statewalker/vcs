/**
 * Step 04: Branch Operations
 *
 * Demonstrates branch creation, listing, switching using
 * git.checkout() and git.branchCreate() porcelain commands.
 */

import {
  log,
  logInfo,
  logSection,
  logSuccess,
  shortId,
  state,
  writeFileToWorktree,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 04: Branch Operations");

  const { git, files } = state;
  if (!git || !files) {
    throw new Error("Repository not initialized. Run step 01 first.");
  }

  // Create feature branch
  log("\nCreating 'feature' branch...");
  await git.branchCreate().setName("feature").call();
  logSuccess("Branch 'feature' created");

  // Create bugfix branch
  log("\nCreating 'bugfix' branch...");
  await git.branchCreate().setName("bugfix").call();
  logSuccess("Branch 'bugfix' created");

  // List all branches
  log("\nListing all branches:");
  const branches = await git.branchList().call();
  for (const branch of branches) {
    const marker = branch.name === "main" ? " (current)" : "";
    console.log(`    - ${branch.name}${marker}`);
  }

  // Switch to feature branch using git.checkout()
  log("\nSwitching to 'feature' branch...");
  await git.checkout().setName("feature").call();
  logSuccess("Switched to 'feature' branch");

  // Add a file on feature branch
  log("\nAdding feature-specific file...");
  const featureContent = `/**
 * Feature implementation - developed on feature branch
 */

export class AdvancedFeature {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  execute(): string {
    return \`Executing advanced feature: \${this.name}\`;
  }
}

export function createAdvancedFeature(name: string): AdvancedFeature {
  return new AdvancedFeature(name);
}
`;
  await writeFileToWorktree(files, "src/advanced-feature.ts", featureContent);
  await git.add().addFilepattern("src/advanced-feature.ts").call();
  const featureCommit = await git.commit().setMessage("Add advanced feature").call();

  state.commits.push({
    id: featureCommit.id,
    message: "Add advanced feature",
    files: new Map([["src/advanced-feature.ts", featureContent]]),
    branch: "feature",
  });

  logSuccess(`Created commit on feature: ${shortId(featureCommit.id)}`);

  // Switch to bugfix branch using git.checkout()
  log("\nSwitching to 'bugfix' branch...");
  await git.checkout().setName("bugfix").call();
  logSuccess("Switched to 'bugfix' branch");

  // Add a bugfix file
  log("\nAdding bugfix...");
  const bugfixContent = `/**
 * Bug fix - critical patch
 */

export function fixCriticalBug(): void {
  console.log("Critical bug fixed!");
}
`;
  await writeFileToWorktree(files, "src/bugfix.ts", bugfixContent);
  await git.add().addFilepattern("src/bugfix.ts").call();
  const bugfixCommit = await git.commit().setMessage("Fix critical bug").call();

  state.commits.push({
    id: bugfixCommit.id,
    message: "Fix critical bug",
    files: new Map([["src/bugfix.ts", bugfixContent]]),
    branch: "bugfix",
  });

  logSuccess(`Created commit on bugfix: ${shortId(bugfixCommit.id)}`);

  // Switch back to main using git.checkout()
  log("\nSwitching back to 'main' branch...");
  await git.checkout().setName("main").call();
  logSuccess("Switched to 'main' branch");

  // Show branch status
  log("\nBranch status:");
  const finalBranches = await git.branchList().call();
  logInfo("Total branches", finalBranches.length);
  for (const branch of finalBranches) {
    console.log(`    - ${branch.name}`);
  }

  logSuccess("Branch operations complete!");
}
