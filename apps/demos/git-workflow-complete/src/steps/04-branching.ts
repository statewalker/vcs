/**
 * Step 04: Branch Operations
 *
 * Demonstrates branch creation, listing, switching, and deletion
 * using the VCS Commands API.
 */

import {
  addFileToStaging,
  log,
  logInfo,
  logSection,
  logSuccess,
  shortId,
  state,
} from "../shared/index.js";

export async function run(): Promise<void> {
  logSection("Step 04: Branch Operations");

  const { store, git } = state;
  if (!store || !git) {
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

  // Switch to feature branch
  log("\nSwitching to 'feature' branch...");
  await store.refs.setSymbolic("HEAD", "refs/heads/feature");

  // Reset staging to feature branch's tree
  const featureRef = await store.refs.resolve("refs/heads/feature");
  if (featureRef?.objectId) {
    const commit = await store.commits.loadCommit(featureRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }
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
  await addFileToStaging(store, "src/advanced-feature.ts", featureContent);
  const featureCommitObj = await git.commit().setMessage("Add advanced feature").call();
  const featureCommitId = await store.commits.storeCommit(featureCommitObj);

  state.commits.push({
    id: featureCommitId,
    message: "Add advanced feature",
    files: new Map([["src/advanced-feature.ts", featureContent]]),
    branch: "feature",
  });

  logSuccess(`Created commit on feature: ${shortId(featureCommitId)}`);

  // Switch to bugfix branch and add a fix
  log("\nSwitching to 'bugfix' branch...");
  await store.refs.setSymbolic("HEAD", "refs/heads/bugfix");

  // Reset staging to bugfix branch's tree (same as main before feature branch commits)
  const bugfixRef = await store.refs.resolve("refs/heads/bugfix");
  if (bugfixRef?.objectId) {
    const commit = await store.commits.loadCommit(bugfixRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }
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
  await addFileToStaging(store, "src/bugfix.ts", bugfixContent);
  const bugfixCommitObj = await git.commit().setMessage("Fix critical bug").call();
  const bugfixCommitId = await store.commits.storeCommit(bugfixCommitObj);

  state.commits.push({
    id: bugfixCommitId,
    message: "Fix critical bug",
    files: new Map([["src/bugfix.ts", bugfixContent]]),
    branch: "bugfix",
  });

  logSuccess(`Created commit on bugfix: ${shortId(bugfixCommitId)}`);

  // Switch back to main
  log("\nSwitching back to 'main' branch...");
  await store.refs.setSymbolic("HEAD", "refs/heads/main");

  const mainRef = await store.refs.resolve("refs/heads/main");
  if (mainRef?.objectId) {
    const commit = await store.commits.loadCommit(mainRef.objectId);
    await store.staging.readTree(store.trees, commit.tree);
  }
  logSuccess("Switched to 'main' branch");

  // Delete the bugfix branch (will be demonstrated but we keep it for merge demo)
  log("\nBranch status:");
  const finalBranches = await git.branchList().call();
  logInfo("Total branches", finalBranches.length);
  for (const branch of finalBranches) {
    console.log(`    - ${branch.name}`);
  }

  logSuccess("Branch operations complete!");
}
