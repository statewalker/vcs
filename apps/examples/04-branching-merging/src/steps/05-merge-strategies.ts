/**
 * Step 5: Merge Strategies
 *
 * Demonstrates different merge strategies: OURS, THEIRS, and content strategies.
 */

import { ContentMergeStrategy, MergeStrategy } from "@statewalker/vcs-commands";
import { addFileToStaging, getGit, printSection, printStep, resetState } from "../shared.js";

export async function step05MergeStrategies(): Promise<void> {
  printStep(5, "Merge Strategies");

  console.log("\n--- Available Merge Strategies ---");
  console.log(`
  MergeStrategy.RECURSIVE (default):
    Standard three-way merge algorithm
    Compares both sides against common ancestor

  MergeStrategy.OURS:
    Keeps our tree completely, ignores their changes
    Still creates a merge commit (history is merged)
    Useful when: "accept our version, but record that we merged"

  MergeStrategy.THEIRS:
    Replaces our tree with theirs entirely
    Still creates a merge commit
    Useful when: "accept their version completely"
  `);

  // Demo 1: OURS strategy
  console.log("\n--- Demo 1: OURS Strategy ---");
  resetState();
  const { git: git1, store: store1 } = await getGit();

  // Setup
  await addFileToStaging(store1, "config.json", '{"version": 1}');
  await git1.commit().setMessage("Initial config").call();

  await git1.branchCreate().setName("their-changes").call();

  // Our change
  await addFileToStaging(store1, "config.json", '{"version": 2, "ourFeature": true}');
  await git1.commit().setMessage("Our config update").call();

  // Their change
  await store1.refs.setSymbolic("HEAD", "refs/heads/their-changes");
  const theirRef = await store1.refs.resolve("refs/heads/their-changes");
  if (theirRef?.objectId) {
    const commit = await store1.commits.loadCommit(theirRef.objectId);
    await store1.staging.readTree(store1.trees, commit.tree);
  }
  await addFileToStaging(store1, "config.json", '{"version": 3, "theirFeature": true}');
  await git1.commit().setMessage("Their config update").call();

  // Switch back to main
  await store1.refs.setSymbolic("HEAD", "refs/heads/main");
  const mainRef1 = await store1.refs.resolve("refs/heads/main");
  if (mainRef1?.objectId) {
    const commit = await store1.commits.loadCommit(mainRef1.objectId);
    await store1.staging.readTree(store1.trees, commit.tree);
  }

  // Merge with OURS strategy
  const oursResult = await git1
    .merge()
    .include("their-changes")
    .setStrategy(MergeStrategy.OURS)
    .call();

  console.log(`  Merge with OURS strategy:`);
  console.log(`    Status: ${oursResult.status}`);
  console.log(`    Result: Our version is kept, but merge commit created`);
  console.log(`    Use case: Recording that we considered their changes but kept ours`);

  // Demo 2: Content Merge Strategies
  console.log("\n--- Content Merge Strategies ---");
  console.log(`
  ContentMergeStrategy.OURS:
    For file-level conflicts, take our version

  ContentMergeStrategy.THEIRS:
    For file-level conflicts, take their version

  ContentMergeStrategy.UNION:
    Concatenate both versions (ours first, then theirs)
    Useful for additive files like changelogs
  `);

  // Demo UNION strategy
  console.log("\n--- Demo 2: UNION Content Strategy ---");
  resetState();
  const { git: git2, store: store2 } = await getGit();

  // Setup with a changelog-style file
  await addFileToStaging(store2, "CHANGELOG.md", "# Changelog\n\n## v1.0.0\n- Initial release\n");
  await git2.commit().setMessage("Initial changelog").call();

  await git2.branchCreate().setName("changelog-branch").call();

  // Our addition
  await addFileToStaging(
    store2,
    "CHANGELOG.md",
    "# Changelog\n\n## v1.1.0\n- Our feature\n\n## v1.0.0\n- Initial release\n",
  );
  await git2.commit().setMessage("Add our changelog entry").call();

  // Their addition
  await store2.refs.setSymbolic("HEAD", "refs/heads/changelog-branch");
  const clRef = await store2.refs.resolve("refs/heads/changelog-branch");
  if (clRef?.objectId) {
    const commit = await store2.commits.loadCommit(clRef.objectId);
    await store2.staging.readTree(store2.trees, commit.tree);
  }
  await addFileToStaging(
    store2,
    "CHANGELOG.md",
    "# Changelog\n\n## v1.0.1\n- Their bugfix\n\n## v1.0.0\n- Initial release\n",
  );
  await git2.commit().setMessage("Add their changelog entry").call();

  // Switch back and merge with UNION
  await store2.refs.setSymbolic("HEAD", "refs/heads/main");
  const mainRef2 = await store2.refs.resolve("refs/heads/main");
  if (mainRef2?.objectId) {
    const commit = await store2.commits.loadCommit(mainRef2.objectId);
    await store2.staging.readTree(store2.trees, commit.tree);
  }

  const unionResult = await git2
    .merge()
    .include("changelog-branch")
    .setContentMergeStrategy(ContentMergeStrategy.UNION)
    .call();

  console.log(`  Merge with UNION content strategy:`);
  console.log(`    Status: ${unionResult.status}`);
  console.log(`    Result: Both changelog entries combined`);
  console.log(`    Use case: Files where both additions should be preserved`);

  console.log("\n--- Choosing the Right Strategy ---");
  console.log(`
  Scenario                          | Strategy
  ----------------------------------|------------------
  Normal merge                      | RECURSIVE (default)
  "Ignore their changes"            | OURS
  "Accept their changes completely" | THEIRS
  Conflicting config files          | Content OURS/THEIRS
  Additive files (logs, changelogs) | Content UNION
  `);

  console.log("\nStep 5 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 5: Merge Strategies");
  step05MergeStrategies()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
