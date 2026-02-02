/**
 * Step 5: Checkout Files
 *
 * Demonstrates checking out files from specific commits.
 */

import {
  addFileToStaging,
  getGit,
  MergeStage,
  printSection,
  printStep,
  resetState,
  shortId,
} from "../shared.js";

export async function step05CheckoutFiles(): Promise<void> {
  printStep(5, "Checkout Files");

  await resetState();
  const { git, workingCopy, history } = await getGit();

  // Create commits with file changes
  console.log("\n--- Creating commit history ---");

  await addFileToStaging(workingCopy, "config.json", '{"version": 1}');
  await git.commit().setMessage("v1 config").call();
  const head1 = await history.refs.resolve("HEAD");
  const commit1 = head1?.objectId ?? "";
  console.log(`  Commit 1: ${shortId(commit1)} - v1 config`);

  await addFileToStaging(workingCopy, "config.json", '{"version": 2, "feature": true}');
  await git.commit().setMessage("v2 config with feature").call();
  const head2 = await history.refs.resolve("HEAD");
  const commit2 = head2?.objectId ?? "";
  console.log(`  Commit 2: ${shortId(commit2)} - v2 config with feature`);

  await addFileToStaging(
    workingCopy,
    "config.json",
    '{"version": 3, "feature": true, "debug": false}',
  );
  await git.commit().setMessage("v3 config with debug").call();
  const head3 = await history.refs.resolve("HEAD");
  const commit3 = head3?.objectId ?? "";
  console.log(`  Commit 3: ${shortId(commit3)} - v3 config with debug`);

  // Show current file content
  console.log("\n--- Current config.json (HEAD) ---");
  const currentEntry = await getEntry(workingCopy, "config.json");
  if (currentEntry) {
    const content = await getBlobContent(history, currentEntry.objectId);
    console.log(`  ${content}`);
  }

  // Checkout file from commit1
  console.log("\n--- Checkout config.json from commit 1 ---");
  console.log(`
  To checkout a file from a specific commit:

    await git.checkout()
      .setStartPoint(commitId)
      .addPath("config.json")
      .call();
  `);

  // Manual checkout by reading from commit tree
  console.log("  Manually restoring from commit 1...");

  const commit1Data = await history.commits.load(commit1);
  if (!commit1Data) {
    console.log("  Commit not found");
    return;
  }
  const blobId = await getFileBlobId(history, commit1Data.tree, "config.json");

  if (blobId) {
    // Update staging with old version
    const editor = workingCopy.checkout.staging.createEditor();
    editor.add({
      path: "config.json",
      apply: (existing) => ({
        path: "config.json",
        mode: existing?.mode ?? 0o100644,
        objectId: blobId,
        stage: MergeStage.MERGED,
        size: existing?.size ?? 0,
        mtime: Date.now(),
      }),
    });
    await editor.finish();

    const content = await getBlobContent(history, blobId);
    console.log(`  Restored content: ${content}`);
  }

  // Explain checkout scope
  console.log("\n--- Checkout scope ---");
  console.log(`
  File checkout vs Branch checkout:

  File checkout (git checkout <commit> -- <file>):
    - Only affects specified files
    - Updates staging area
    - Updates working tree
    - Does NOT move HEAD

  Branch checkout (git checkout <branch>):
    - Moves HEAD to branch
    - Updates entire staging area
    - Updates entire working tree
  `);

  // Restore to HEAD
  console.log("\n--- Restoring to HEAD ---");
  const headCommit = await history.commits.load(commit3);
  if (!headCommit) {
    console.log("  Commit not found");
    return;
  }
  const headBlobId = await getFileBlobId(history, headCommit.tree, "config.json");

  if (headBlobId) {
    const editor = workingCopy.checkout.staging.createEditor();
    editor.add({
      path: "config.json",
      apply: (existing) => ({
        path: "config.json",
        mode: existing?.mode ?? 0o100644,
        objectId: headBlobId,
        stage: MergeStage.MERGED,
        size: existing?.size ?? 0,
        mtime: Date.now(),
      }),
    });
    await editor.finish();

    const content = await getBlobContent(history, headBlobId);
    console.log(`  Restored to HEAD: ${content}`);
  }

  console.log("\n--- Checkout API ---");
  console.log(`
  // Checkout file from specific commit
  await git.checkout()
    .setStartPoint(commitId)    // Source commit
    .addPath("path/to/file")    // File(s) to checkout
    .call();

  // Low-level: Read blob from commit tree
  const commit = await history.commits.load(commitId);
  const blobId = await history.trees.getEntry(commit.tree, "file");
  // Then update staging with blobId
  `);

  console.log("\nStep 5 completed!");
}

// Helper: Get staging entry
async function getEntry(
  workingCopy: Awaited<ReturnType<typeof getGit>>["workingCopy"],
  path: string,
) {
  for await (const entry of workingCopy.checkout.staging.entries()) {
    if (entry.path === path) return entry;
  }
  return undefined;
}

// Helper: Get blob content
async function getBlobContent(
  history: Awaited<ReturnType<typeof getGit>>["history"],
  blobId: string,
): Promise<string> {
  const chunks: Uint8Array[] = [];
  const content = await history.blobs.load(blobId);
  if (content) {
    for await (const chunk of content) {
      chunks.push(chunk);
    }
  }
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(result);
}

// Helper: Get blob ID from tree
async function getFileBlobId(
  history: Awaited<ReturnType<typeof getGit>>["history"],
  treeId: string,
  path: string,
): Promise<string | undefined> {
  const entry = await history.trees.getEntry(treeId, path);
  return entry?.id;
}

// Run standalone
if (import.meta.url === `file://${process.argv[1]}`) {
  printSection("Step 5: Checkout Files");
  step05CheckoutFiles()
    .then(() => console.log("\nDone!"))
    .catch((err) => {
      console.error("Error:", err);
      process.exit(1);
    });
}
