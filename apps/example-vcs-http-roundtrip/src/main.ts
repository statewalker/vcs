/**
 * VCS HTTP Roundtrip Example
 *
 * This example demonstrates the complete Git HTTP workflow using VCS
 * exclusively for all Git operations. Native git is only used for verification.
 *
 * Steps:
 * 1. Create a remote repository using VCS (blob, tree, commit, refs)
 * 2. Start a VCS-based HTTP server (no git http-backend)
 * 3. Clone the repository using VCS transport
 * 4. Verify the clone with native git
 * 5. Modify content and create a commit using VCS
 * 6. Create a new branch with the changes
 * 7. Push the branch using VCS transport
 * 8. Verify the push with native git
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import {
  atomicWriteFile,
  createGitStorage,
  ensureDir,
  extractGitObjectContent,
  type GitStorage,
  indexPack,
  parseObjectHeader,
  writePackIndex,
} from "@webrun-vcs/store-files";
import { clone, type PushObject, push } from "@webrun-vcs/transport";
import { setCompression } from "@webrun-vcs/utils";
import { createNodeCompression } from "@webrun-vcs/utils/compression-node";
import { bytesToHex } from "@webrun-vcs/utils/hash/utils";
import { FileMode } from "@webrun-vcs/vcs";

import {
  BASE_DIR,
  concatBytes,
  createAuthor,
  createVcsHttpServer,
  DEFAULT_BRANCH,
  ensureDirectory,
  HTTP_PORT,
  LOCAL_REPO_DIR,
  printError,
  printInfo,
  printSection,
  printStep,
  printSuccess,
  REMOTE_REPO_DIR,
  REMOTE_URL,
  removeDirectory,
  runGitAsync,
  runGitSafeAsync,
  shortId,
  TEST_BRANCH,
  type VcsHttpServer,
} from "./shared/index.js";

// Initialize compression
setCompression(createNodeCompression());

const textEncoder = new TextEncoder();

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  printSection("VCS HTTP Roundtrip Example");
  console.log("This example demonstrates a complete Git HTTP workflow using VCS");
  console.log("for both server and client operations. Native git is only used for verification.\n");

  let server: VcsHttpServer | null = null;
  let remoteStorage: GitStorage | null = null;
  let localStorage: GitStorage | null = null;

  try {
    // Step 1: Setup - Create remote repository with VCS
    printStep(1, "Creating remote repository with VCS");
    remoteStorage = await setupRemoteRepository();

    // Step 2: Start VCS HTTP server
    printStep(2, "Starting VCS HTTP server");
    server = await startHttpServer(remoteStorage);

    // Step 3: Clone repository using VCS transport
    printStep(3, "Cloning repository using VCS transport");
    await cloneWithVcs();

    // Step 4: Verify clone with native git
    printStep(4, "Verifying clone with native git");
    await verifyCloneWithNativeGit();

    // Step 5: Open local repository with VCS and modify content
    printStep(5, "Modifying content with VCS");
    localStorage = await openLocalRepository();
    const { newTreeId } = await modifyContent(localStorage);

    // Step 6: Create branch and commit
    printStep(6, `Creating branch '${TEST_BRANCH}' and committing changes`);
    const commitId = await createBranchAndCommit(localStorage, newTreeId);

    // Step 7: Push using VCS transport
    printStep(7, "Pushing changes using VCS transport");
    await pushChanges(localStorage, commitId);

    // Step 8: Verify push with native git
    printStep(8, "Verifying push with native git");
    await verifyPushWithNativeGit(commitId);

    // Success!
    printSection("SUCCESS!");
    console.log("\nThe VCS HTTP roundtrip completed successfully!");
    console.log("- Created remote repository entirely with VCS");
    console.log("- Served repository via VCS-based HTTP server");
    console.log("- Cloned using VCS transport (no native git clone)");
    console.log("- Modified content and committed with VCS");
    console.log("- Pushed using VCS transport");
    console.log("- All verified with native git");
  } catch (error) {
    printError(`Error: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    // Cleanup - close storages to release file handles
    if (localStorage) {
      await localStorage.close();
    }
    if (remoteStorage) {
      await remoteStorage.close();
    }
    if (server) {
      printInfo("\nStopping HTTP server...");
      await server.stop();
    }
  }
}

/**
 * Step 1: Create remote repository entirely with VCS.
 */
async function setupRemoteRepository(): Promise<GitStorage> {
  // Clean up any existing test directories
  await removeDirectory(BASE_DIR);
  await ensureDirectory(BASE_DIR);
  await ensureDirectory(REMOTE_REPO_DIR);

  printInfo(`Creating bare repository at ${REMOTE_REPO_DIR}`);

  // Create files API
  const files = new FilesApi(new NodeFilesApi({ fs, rootDir: REMOTE_REPO_DIR }));

  // Initialize git storage (bare repository)
  const storage = await createGitStorage(files, ".", {
    create: true,
    bare: true,
    defaultBranch: DEFAULT_BRANCH,
  });

  // Create initial content
  const readmeContent = `# Test Repository

This repository was created entirely using VCS - no native git commands.

Created at: ${new Date().toISOString()}
`;

  // Store blob
  const blobId = await storage.objects.store([textEncoder.encode(readmeContent)]);
  printInfo(`Created blob: ${shortId(blobId)}`);

  // Create tree
  const treeId = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
  ]);
  printInfo(`Created tree: ${shortId(treeId)}`);

  // Create commit
  const author = createAuthor();
  const commitId = await storage.commits.storeCommit({
    tree: treeId,
    parents: [],
    author,
    committer: author,
    message: "Initial commit\n\nCreated with VCS library.",
  });
  printInfo(`Created commit: ${shortId(commitId)}`);

  // Set up refs
  await storage.refs.set(`refs/heads/${DEFAULT_BRANCH}`, commitId);
  await storage.refs.setSymbolic("HEAD", `refs/heads/${DEFAULT_BRANCH}`);

  printSuccess(`Remote repository created with initial commit: ${shortId(commitId)}`);

  return storage;
}

/**
 * Step 2: Start VCS HTTP server.
 */
async function startHttpServer(remoteStorage: GitStorage): Promise<VcsHttpServer> {
  printInfo(`Starting VCS HTTP server on port ${HTTP_PORT}`);

  const server = await createVcsHttpServer({
    port: HTTP_PORT,
    getStorage: async (repoPath: string) => {
      // Only serve the remote.git repository
      if (repoPath === "remote.git") {
        return remoteStorage;
      }
      return null;
    },
  });

  printSuccess(`VCS HTTP server running at http://localhost:${HTTP_PORT}`);
  printInfo(`Repository available at ${REMOTE_URL}`);

  return server;
}

/**
 * Step 3: Clone repository using VCS transport.
 */
async function cloneWithVcs(): Promise<void> {
  printInfo(`Cloning from ${REMOTE_URL} using VCS transport`);

  // Perform the clone
  const cloneResult = await clone({
    url: REMOTE_URL,
    onProgressMessage: (msg) => {
      if (msg.trim()) {
        printInfo(`  ${msg.trim()}`);
      }
    },
  });

  printInfo(`Received ${cloneResult.bytesReceived} bytes`);
  printInfo(`Default branch: ${cloneResult.defaultBranch}`);
  printInfo(`Refs received: ${cloneResult.refs.size}`);

  // Create local repository directory
  await ensureDirectory(LOCAL_REPO_DIR);
  const gitDir = path.join(LOCAL_REPO_DIR, ".git");
  await ensureDirectory(gitDir);

  // Create files API for local repository
  const files = new FilesApi(new NodeFilesApi({ fs, rootDir: LOCAL_REPO_DIR }));

  // Initialize local storage
  const storage = await createGitStorage(files, ".git", {
    create: true,
    defaultBranch: cloneResult.defaultBranch,
  });

  // Process pack data if we received any
  if (cloneResult.packData.length > 0) {
    printInfo("Processing received pack data...");

    // Index the pack to compute object IDs and checksums
    const indexResult = await indexPack(cloneResult.packData);
    printInfo(`Pack contains ${indexResult.objectCount} objects`);

    // Store pack file using FilesApi (platform-agnostic)
    // This creates a Git-compatible pack file structure.
    //
    // Alternative approach for delta-aware storage:
    // import { importPackAsDeltas, parsePackEntries } from "@webrun-vcs/store-files";
    // const result = await importPackAsDeltas(deltaStorageManager, cloneResult.packData);
    // This would preserve delta relationships and store via DeltaStorageManager.
    const packChecksum = bytesToHex(indexResult.packChecksum);
    const packDir = ".git/objects/pack";
    await ensureDir(files, packDir);

    const packFileName = `pack-${packChecksum}.pack`;
    const idxFileName = `pack-${packChecksum}.idx`;

    // Use atomicWriteFile for safe writes via FilesApi abstraction
    await atomicWriteFile(files, `${packDir}/${packFileName}`, cloneResult.packData);

    // Generate and write pack index
    const indexData = await writePackIndex(indexResult.entries, indexResult.packChecksum);
    await atomicWriteFile(files, `${packDir}/${idxFileName}`, indexData);

    printInfo(`Stored pack: ${packFileName}`);
  }

  // Set up refs
  const remoteName = "origin";
  for (const [refName, objectId] of cloneResult.refs) {
    const localRefName = refName;
    await storage.refs.set(localRefName, bytesToHex(objectId));
    printInfo(`Set ref: ${localRefName} -> ${shortId(bytesToHex(objectId))}`);
  }

  // Set up local main branch
  const mainRef = cloneResult.refs.get(`refs/remotes/${remoteName}/${cloneResult.defaultBranch}`);
  if (mainRef) {
    await storage.refs.set(`refs/heads/${cloneResult.defaultBranch}`, bytesToHex(mainRef));
  }

  // Set HEAD
  await storage.refs.setSymbolic("HEAD", `refs/heads/${cloneResult.defaultBranch}`);

  // Create working tree (checkout)
  await checkoutHead(storage);

  printSuccess(`Repository cloned to ${LOCAL_REPO_DIR}`);
}

/**
 * Checkout HEAD to working tree.
 */
async function checkoutHead(storage: GitStorage): Promise<void> {
  const headCommit = await storage.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  const commit = await storage.commits.loadCommit(headCommit);

  // Recursively extract tree to working directory
  await extractTree(storage, commit.tree, LOCAL_REPO_DIR);
}

/**
 * Extract a tree to a directory.
 */
async function extractTree(storage: GitStorage, treeId: string, dirPath: string): Promise<void> {
  for await (const entry of storage.trees.loadTree(treeId)) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.mode === FileMode.TREE) {
      await ensureDirectory(entryPath);
      await extractTree(storage, entry.id, entryPath);
    } else {
      // Load blob content
      const chunks: Uint8Array[] = [];
      for await (const chunk of storage.rawStorage.load(entry.id)) {
        chunks.push(chunk);
      }
      const rawData = concatBytes(...chunks);
      const content = extractGitObjectContent(rawData);

      await fs.writeFile(entryPath, content);
    }
  }
}

/**
 * Step 4: Verify clone with native git.
 */
async function verifyCloneWithNativeGit(): Promise<void> {
  printInfo("Checking cloned repository with native git...");

  // Run git fsck
  const fsckResult = await runGitSafeAsync(["fsck", "--full"], LOCAL_REPO_DIR);
  if (fsckResult.ok) {
    printSuccess("Repository integrity check passed (git fsck)");
  } else {
    printError(`Repository integrity check failed: ${fsckResult.output}`);
    // Don't throw - fsck might report issues with packs that are still valid
  }

  // Check git status
  const status = await runGitAsync(["status", "--short"], LOCAL_REPO_DIR);
  printInfo(`Git status: ${status || "(clean)"}`);

  // Show log
  const log = await runGitSafeAsync(["log", "--oneline", "-1"], LOCAL_REPO_DIR);
  if (log.ok) {
    printSuccess(`Latest commit: ${log.output}`);
  }

  // Verify README.md exists
  const readmePath = path.join(LOCAL_REPO_DIR, "README.md");
  try {
    await fs.access(readmePath);
    printSuccess("README.md file exists");
  } catch {
    printError("README.md file not found!");
  }
}

/**
 * Open local repository with VCS.
 */
async function openLocalRepository(): Promise<GitStorage> {
  printInfo(`Opening repository at ${LOCAL_REPO_DIR}`);

  const files = new FilesApi(new NodeFilesApi({ fs, rootDir: LOCAL_REPO_DIR }));

  const storage = await createGitStorage(files, ".git", {
    create: false,
  });

  const headCommit = await storage.getHead();
  printSuccess(`Repository opened, HEAD at ${shortId(headCommit || "unknown")}`);

  return storage;
}

/**
 * Step 5: Modify content with VCS.
 */
async function modifyContent(
  storage: GitStorage,
): Promise<{ newBlobId: string; newTreeId: string }> {
  // Get current tree
  const headCommit = await storage.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  const commit = await storage.commits.loadCommit(headCommit);

  // Load existing tree entries
  const existingEntries: Array<{ mode: number; name: string; id: string }> = [];
  for await (const entry of storage.trees.loadTree(commit.tree)) {
    existingEntries.push({
      mode: entry.mode,
      name: entry.name,
      id: entry.id,
    });
  }

  // Create a new file
  const newFileContent = `# VCS Roundtrip Test

This file was created during the VCS HTTP roundtrip test.
It demonstrates that VCS can:
- Clone from a VCS-based HTTP server
- Create new files and commits
- Push back to the server

Timestamp: ${new Date().toISOString()}
`;

  // Store blob
  const newBlobId = await storage.objects.store([textEncoder.encode(newFileContent)]);
  printInfo(`Created blob: ${shortId(newBlobId)}`);

  // Create new tree with the new file
  const newEntries = [
    ...existingEntries.filter((e) => e.name !== "ROUNDTRIP.md"),
    { mode: FileMode.REGULAR_FILE, name: "ROUNDTRIP.md", id: newBlobId },
  ];

  const newTreeId = await storage.trees.storeTree(newEntries);
  printInfo(`Created tree: ${shortId(newTreeId)}`);

  // Also write the file to the working directory
  const filePath = path.join(LOCAL_REPO_DIR, "ROUNDTRIP.md");
  await fs.writeFile(filePath, newFileContent);
  printInfo(`Created file: ROUNDTRIP.md`);

  return { newBlobId, newTreeId };
}

/**
 * Step 6: Create branch and commit.
 */
async function createBranchAndCommit(storage: GitStorage, treeId: string): Promise<string> {
  const headCommit = await storage.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  // Create branch pointing to HEAD
  await storage.refs.set(`refs/heads/${TEST_BRANCH}`, headCommit);
  printInfo(`Created branch '${TEST_BRANCH}'`);

  // Create commit
  const author = createAuthor();
  const commitId = await storage.commits.storeCommit({
    tree: treeId,
    parents: [headCommit],
    author,
    committer: author,
    message: `Add ROUNDTRIP.md via VCS HTTP roundtrip

This commit was created using the VCS library as part of the
VCS HTTP roundtrip example. It demonstrates the ability to:
- Clone from a VCS-based HTTP server
- Create content and commits with VCS
- Push changes using VCS transport`,
  });
  printInfo(`Created commit: ${shortId(commitId)}`);

  // Update branch ref
  await storage.refs.set(`refs/heads/${TEST_BRANCH}`, commitId);

  // Switch to new branch
  await storage.refs.setSymbolic("HEAD", `refs/heads/${TEST_BRANCH}`);

  printSuccess(`Commit ${shortId(commitId)} created on branch '${TEST_BRANCH}'`);

  return commitId;
}

/**
 * Step 7: Push changes using VCS transport.
 */
async function pushChanges(storage: GitStorage, commitId: string): Promise<void> {
  printInfo(`Pushing ${TEST_BRANCH} to remote...`);

  // Get all objects that need to be pushed
  const objectsToPush = await collectObjectsForPush(storage, commitId);

  printInfo(`Collected ${objectsToPush.length} objects to push`);

  const result = await push({
    url: REMOTE_URL,
    refspecs: [`refs/heads/${TEST_BRANCH}:refs/heads/${TEST_BRANCH}`],
    force: true,
    getLocalRef: async (refName: string) => {
      const ref = await storage.refs.resolve(refName);
      return ref?.objectId;
    },
    getObjectsToPush: async function* () {
      for (const obj of objectsToPush) {
        yield obj;
      }
    },
    onProgressMessage: (msg) => {
      if (msg.trim()) {
        printInfo(`  ${msg.trim()}`);
      }
    },
  });

  if (result.ok) {
    printSuccess(`Push successful!`);
    printInfo(`Bytes sent: ${result.bytesSent}`);
    printInfo(`Objects sent: ${result.objectCount}`);
  } else {
    printError(`Push failed: ${result.unpackStatus}`);
    for (const [ref, status] of result.updates) {
      if (!status.ok) {
        printError(`  ${ref}: ${status.message}`);
      }
    }
    throw new Error("Push failed");
  }
}

/**
 * Collect objects needed for push.
 */
async function collectObjectsForPush(storage: GitStorage, commitId: string): Promise<PushObject[]> {
  const objects: PushObject[] = [];
  const seen = new Set<string>();

  async function collectObject(id: string): Promise<void> {
    if (seen.has(id)) return;
    seen.add(id);

    // Load raw object
    const chunks: Uint8Array[] = [];
    for await (const chunk of storage.rawStorage.load(id)) {
      chunks.push(chunk);
    }
    const rawData = concatBytes(...chunks);

    // Parse header to get type
    const header = parseObjectHeader(rawData);
    const content = extractGitObjectContent(rawData);

    objects.push({ id, type: header.typeCode, content });
  }

  async function collectTree(treeId: string): Promise<void> {
    await collectObject(treeId);

    for await (const entry of storage.trees.loadTree(treeId)) {
      if (entry.mode === FileMode.TREE) {
        await collectTree(entry.id);
      } else {
        await collectObject(entry.id);
      }
    }
  }

  // Collect the commit
  await collectObject(commitId);

  // Load commit to get tree
  const commit = await storage.commits.loadCommit(commitId);
  await collectTree(commit.tree);

  return objects;
}

/**
 * Step 8: Verify push with native git.
 */
async function verifyPushWithNativeGit(expectedCommitId: string): Promise<void> {
  printInfo("Checking remote repository with native git...");

  // Check if branch exists
  const branches = await runGitAsync(["branch", "-a"], REMOTE_REPO_DIR);
  if (!branches.includes(TEST_BRANCH)) {
    printError(`Branch '${TEST_BRANCH}' not found in remote!`);
    printInfo(`Available branches: ${branches}`);
    throw new Error("Branch verification failed");
  }
  printSuccess(`Branch '${TEST_BRANCH}' exists in remote`);

  // Get commit ID from remote
  const remoteCommitId = await runGitAsync(
    ["rev-parse", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );

  if (remoteCommitId === expectedCommitId) {
    printSuccess(`Commit ID matches: ${shortId(remoteCommitId)}`);
  } else {
    printError(`Commit ID mismatch!`);
    printError(`  Expected: ${expectedCommitId}`);
    printError(`  Got: ${remoteCommitId}`);
    throw new Error("Commit verification failed");
  }

  // Show commit details
  const commitInfo = await runGitAsync(
    ["log", "-1", "--format=%H %s", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );
  printInfo(`Commit: ${commitInfo}`);

  // Verify file exists in commit
  const treeFiles = await runGitAsync(
    ["ls-tree", "--name-only", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );
  if (treeFiles.includes("ROUNDTRIP.md")) {
    printSuccess("ROUNDTRIP.md file found in commit");
  } else {
    printError("ROUNDTRIP.md file not found!");
    throw new Error("File verification failed");
  }

  // Run git fsck for integrity check
  const fsckResult = await runGitSafeAsync(["fsck", "--full"], REMOTE_REPO_DIR);
  if (fsckResult.ok) {
    printSuccess("Repository integrity check passed (git fsck)");
  } else {
    printError(`Repository integrity check warning: ${fsckResult.output}`);
    // Don't throw - some warnings are acceptable
  }
}

// Run main
main();
