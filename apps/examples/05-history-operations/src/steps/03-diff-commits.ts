/**
 * Step 3: Diff Between Commits
 *
 * Demonstrates comparing commits and viewing changes.
 */

import { formatDiffEntry } from "@statewalker/vcs-commands";
import {
  addFileToStaging,
  getGit,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step03DiffCommits(): Promise<void> {
  printStep(3, "Diff Between Commits");

  await resetState();
  const { git, workingCopy, history } = await getGit();

  // Create commits with various changes
  console.log("\n--- Setting up commits with changes ---");

  // Initial commit
  await addFileToStaging(workingCopy, "README.md", "# Diff Demo\n\nInitial content.");
  await addFileToStaging(workingCopy, "src/index.ts", "export const version = 1;");
  await git.commit().setMessage("Initial commit").call();
  const head1 = await history.refs.resolve("HEAD");
  const commit1 = head1?.objectId ?? "";
  console.log(`  Commit 1: ${shortId(commit1)} - Initial commit`);

  // Second commit - modify and add
  await addFileToStaging(
    workingCopy,
    "src/index.ts",
    "export const version = 2;\nexport const name = 'app';",
  );
  await addFileToStaging(workingCopy, "src/utils.ts", "export function helper() {}");
  await git.commit().setMessage("Update index, add utils").call();
  const head2 = await history.refs.resolve("HEAD");
  const commit2 = head2?.objectId ?? "";
  console.log(`  Commit 2: ${shortId(commit2)} - Update index, add utils`);

  // Third commit - delete and modify
  // Note: We simulate delete by not including the file in new tree
  await addFileToStaging(
    workingCopy,
    "README.md",
    "# Diff Demo\n\nUpdated content.\n\nNew section.",
  );
  await git.commit().setMessage("Update README").call();
  const head3 = await history.refs.resolve("HEAD");
  const commit3 = head3?.objectId ?? "";
  console.log(`  Commit 3: ${shortId(commit3)} - Update README`);

  // Basic diff between two commits
  console.log("\n--- Diff between commit 1 and commit 2 ---");

  const diff12 = await git.diff().setOldTree(commit1).setNewTree(commit2).call();

  console.log(`\n  Changes (${diff12.length} entries):`);
  for (const entry of diff12) {
    console.log(`    ${entry.changeType}: ${entry.newPath || entry.oldPath}`);
  }

  // Detailed diff output
  console.log("\n--- Detailed diff format ---");

  for (const entry of diff12) {
    console.log(`\n  ${formatDiffEntry(entry)}`);
  }

  // Diff between commit 1 and commit 3 (shows accumulated changes)
  console.log("\n--- Diff between commit 1 and commit 3 ---");

  const diff13 = await git.diff().setOldTree(commit1).setNewTree(commit3).call();

  console.log(`\n  Changes (${diff13.length} entries):`);
  for (const entry of diff13) {
    console.log(`    ${entry.changeType}: ${entry.newPath || entry.oldPath}`);
  }

  // Diff between adjacent commits
  console.log("\n--- Diff between commit 2 and commit 3 ---");

  const diff23 = await git.diff().setOldTree(commit2).setNewTree(commit3).call();

  console.log(`\n  Changes (${diff23.length} entries):`);
  for (const entry of diff23) {
    console.log(`    ${entry.changeType}: ${entry.newPath || entry.oldPath}`);
  }

  // Explain change types
  console.log("\n--- Change Types ---");
  console.log(`
  ADD:    File added (exists only in new tree)
  DELETE: File deleted (exists only in old tree)
  MODIFY: File content changed (same path, different content)
  RENAME: File renamed (detected by similarity)
  COPY:   File copied (original still exists)
  `);

  // Show diff API
  console.log("\n--- Diff API Summary ---");
  console.log(`
  git.diff()                   - Start building diff
    .setOldTree(commitId)      - Set the "from" commit
    .setNewTree(commitId)      - Set the "to" commit
    .call()                    - Execute and return DiffEntry[]

  DiffEntry properties:
    - changeType: ADD | DELETE | MODIFY | RENAME | COPY
    - oldPath: Path in old tree (null for ADD)
    - newPath: Path in new tree (null for DELETE)
    - oldMode: File mode in old tree
    - newMode: File mode in new tree
    - oldId: Blob ID in old tree
    - newId: Blob ID in new tree
  `);

  console.log("\nStep 3 completed!");
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 3: Diff Between Commits");
  step03DiffCommits()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
