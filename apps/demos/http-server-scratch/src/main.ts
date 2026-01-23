/**
 * HTTP Git Server Demo - Full Roundtrip
 *
 * Demonstrates a complete Git HTTP workflow using VCS for both server and client:
 *
 * 1. Create a remote repository using VCS (blob, tree, commit, refs)
 * 2. Start a VCS-based HTTP server (no git http-backend)
 * 3. Clone the repository using VCS transport
 * 4. Verify the clone with native git
 * 5. Modify content and create a commit using VCS
 * 6. Create a new branch with the changes
 * 7. Push the branch using VCS transport
 * 8. Verify the push with native git
 *
 * Run: pnpm start
 *      pnpm start -- --port 9000   # Custom port
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createGitRepository,
  FileMode,
  type GitRepository,
  indexPack,
  writePackIndex,
} from "@statewalker/vcs-core";
import { clone, type PushObject, push } from "@statewalker/vcs-transport";
import { setCompressionUtils } from "@statewalker/vcs-utils";
import { bytesToHex } from "@statewalker/vcs-utils/hash/utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";

import {
  atomicWriteFile,
  BASE_DIR,
  concatBytes,
  createAuthor,
  createVcsHttpServer,
  DEFAULT_BRANCH,
  ensureDirectory,
  ensureDirFiles,
  HTTP_PORT,
  LOCAL_REPO_DIR,
  printError,
  printInfo,
  printSection,
  printStep,
  printSuccess,
  REMOTE_REPO_DIR,
  removeDirectory,
  runGitAsync,
  runGitSafeAsync,
  shortId,
  TEST_BRANCH,
  type VcsHttpServer,
} from "./shared/index.js";

// Parse command line arguments
function parseArgs(): { port: number } {
  const args = process.argv.slice(2);
  let port = HTTP_PORT;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    }
  }

  return { port };
}

// Parse args early to get port for REMOTE_URL
const { port: httpPort } = parseArgs();
const REMOTE_URL = `http://localhost:${httpPort}/remote.git`;

// Initialize compression
setCompressionUtils(createNodeCompression());

const textEncoder = new TextEncoder();

/**
 * Main entry point.
 */
async function main(): Promise<void> {
  printSection("HTTP Git Server Demo - Full Roundtrip");
  console.log("Building a Git HTTP server from scratch using VCS.");
  console.log("Native git is only used for verification.\n");

  let server: VcsHttpServer | null = null;
  let remoteStorage: GitRepository | null = null;
  let localStorage: GitRepository | null = null;

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
    console.log("\nThe HTTP Git server demo completed successfully!");
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
async function setupRemoteRepository(): Promise<GitRepository> {
  await removeDirectory(BASE_DIR);
  await ensureDirectory(BASE_DIR);
  await ensureDirectory(REMOTE_REPO_DIR);

  printInfo(`Creating bare repository at ${REMOTE_REPO_DIR}`);

  const files = createNodeFilesApi({ rootDir: REMOTE_REPO_DIR });

  const storage = await createGitRepository(files, ".", {
    create: true,
    bare: true,
    defaultBranch: DEFAULT_BRANCH,
  });

  const readmeContent = `# Test Repository

This repository was created entirely using VCS - no native git commands.

Created at: ${new Date().toISOString()}
`;

  const blobId = await storage.blobs.store([textEncoder.encode(readmeContent)]);
  printInfo(`Created blob: ${shortId(blobId)}`);

  const treeId = await storage.trees.storeTree([
    { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
  ]);
  printInfo(`Created tree: ${shortId(treeId)}`);

  const author = createAuthor();
  const commitId = await storage.commits.storeCommit({
    tree: treeId,
    parents: [],
    author,
    committer: author,
    message: "Initial commit\n\nCreated with VCS library.",
  });
  printInfo(`Created commit: ${shortId(commitId)}`);

  await storage.refs.set(`refs/heads/${DEFAULT_BRANCH}`, commitId);
  await storage.refs.setSymbolic("HEAD", `refs/heads/${DEFAULT_BRANCH}`);

  printSuccess(`Remote repository created with initial commit: ${shortId(commitId)}`);

  return storage;
}

/**
 * Step 2: Start VCS HTTP server.
 */
async function startHttpServer(remoteStorage: GitRepository): Promise<VcsHttpServer> {
  printInfo(`Starting VCS HTTP server on port ${httpPort}`);

  const server = await createVcsHttpServer({
    port: httpPort,
    getStorage: async (repoPath: string) => {
      if (repoPath === "remote.git") {
        return remoteStorage;
      }
      return null;
    },
  });

  printSuccess(`VCS HTTP server running at http://localhost:${httpPort}`);
  printInfo(`Repository available at ${REMOTE_URL}`);

  return server;
}

/**
 * Step 3: Clone repository using VCS transport.
 */
async function cloneWithVcs(): Promise<void> {
  printInfo(`Cloning from ${REMOTE_URL} using VCS transport`);

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

  await ensureDirectory(LOCAL_REPO_DIR);
  const gitDir = path.join(LOCAL_REPO_DIR, ".git");
  await ensureDirectory(gitDir);

  const files = createNodeFilesApi({ rootDir: LOCAL_REPO_DIR });

  const repository = (await createGitRepository(files, ".git", {
    create: true,
    defaultBranch: cloneResult.defaultBranch,
  })) as GitRepository;

  if (cloneResult.packData.length > 0) {
    printInfo("Processing received pack data...");

    const indexResult = await indexPack(cloneResult.packData);
    printInfo(`Pack contains ${indexResult.objectCount} objects`);

    const packChecksum = bytesToHex(indexResult.packChecksum);
    const packDir = ".git/objects/pack";
    await ensureDirFiles(files, packDir);

    const packFileName = `pack-${packChecksum}.pack`;
    const idxFileName = `pack-${packChecksum}.idx`;
    const packPath = `${packDir}/${packFileName}`;
    const idxPath = `${packDir}/${idxFileName}`;

    await atomicWriteFile(files, packPath, cloneResult.packData);
    const indexData = await writePackIndex(indexResult.entries, indexResult.packChecksum);
    await atomicWriteFile(files, idxPath, indexData);

    printInfo(`Stored pack file with ${indexResult.objectCount} objects`);
  }

  const remoteName = "origin";
  for (const [refName, objectId] of cloneResult.refs) {
    const localRefName = refName;
    await repository.refs.set(localRefName, bytesToHex(objectId));
    printInfo(`Set ref: ${localRefName} -> ${shortId(bytesToHex(objectId))}`);
  }

  const mainRef = cloneResult.refs.get(`refs/remotes/${remoteName}/${cloneResult.defaultBranch}`);
  if (mainRef) {
    await repository.refs.set(`refs/heads/${cloneResult.defaultBranch}`, bytesToHex(mainRef));
  }

  await repository.refs.setSymbolic("HEAD", `refs/heads/${cloneResult.defaultBranch}`);

  await checkoutHead(repository);
  await repository.close();

  printSuccess(`Repository cloned to ${LOCAL_REPO_DIR}`);
}

/**
 * Checkout HEAD to working tree.
 */
async function checkoutHead(repository: GitRepository): Promise<void> {
  const headCommit = await repository.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  const commit = await repository.commits.loadCommit(headCommit);
  await extractTree(repository, commit.tree, LOCAL_REPO_DIR);
}

/**
 * Extract a tree to a directory.
 */
async function extractTree(
  repository: GitRepository,
  treeId: string,
  dirPath: string,
): Promise<void> {
  for await (const entry of repository.trees.loadTree(treeId)) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.mode === FileMode.TREE) {
      await ensureDirectory(entryPath);
      await extractTree(repository, entry.id, entryPath);
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of repository.blobs.load(entry.id)) {
        chunks.push(chunk);
      }
      const content = concatBytes(...chunks);

      await fs.writeFile(entryPath, content);
    }
  }
}

/**
 * Step 4: Verify clone with native git.
 */
async function verifyCloneWithNativeGit(): Promise<void> {
  printInfo("Checking cloned repository with native git...");

  const fsckResult = await runGitSafeAsync(["fsck", "--full"], LOCAL_REPO_DIR);
  if (fsckResult.ok) {
    printSuccess("Repository integrity check passed (git fsck)");
  } else {
    printError(`Repository integrity check failed: ${fsckResult.output}`);
  }

  const status = await runGitAsync(["status", "--short"], LOCAL_REPO_DIR);
  printInfo(`Git status: ${status || "(clean)"}`);

  const log = await runGitSafeAsync(["log", "--oneline", "-1"], LOCAL_REPO_DIR);
  if (log.ok) {
    printSuccess(`Latest commit: ${log.output}`);
  }

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
async function openLocalRepository(): Promise<GitRepository> {
  printInfo(`Opening repository at ${LOCAL_REPO_DIR}`);

  const files = createNodeFilesApi({ rootDir: LOCAL_REPO_DIR });

  const repository = (await createGitRepository(files, ".git", {
    create: false,
  })) as GitRepository;

  const headCommit = await repository.getHead();
  printSuccess(`Repository opened, HEAD at ${shortId(headCommit || "unknown")}`);

  return repository;
}

/**
 * Step 5: Modify content with VCS.
 */
async function modifyContent(
  repository: GitRepository,
): Promise<{ newBlobId: string; newTreeId: string }> {
  const headCommit = await repository.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  const commit = await repository.commits.loadCommit(headCommit);

  const existingEntries: Array<{ mode: number; name: string; id: string }> = [];
  for await (const entry of repository.trees.loadTree(commit.tree)) {
    existingEntries.push({
      mode: entry.mode,
      name: entry.name,
      id: entry.id,
    });
  }

  const newFileContent = `# HTTP Server Demo

This file was created during the HTTP Git server demo.
It demonstrates that VCS can:
- Clone from a VCS-based HTTP server
- Create new files and commits
- Push back to the server

Timestamp: ${new Date().toISOString()}
`;

  const newBlobId = await repository.blobs.store([textEncoder.encode(newFileContent)]);
  printInfo(`Created blob: ${shortId(newBlobId)}`);

  const newEntries = [
    ...existingEntries.filter((e) => e.name !== "DEMO.md"),
    { mode: FileMode.REGULAR_FILE, name: "DEMO.md", id: newBlobId },
  ];

  const newTreeId = await repository.trees.storeTree(newEntries);
  printInfo(`Created tree: ${shortId(newTreeId)}`);

  const filePath = path.join(LOCAL_REPO_DIR, "DEMO.md");
  await fs.writeFile(filePath, newFileContent);
  printInfo(`Created file: DEMO.md`);

  return { newBlobId, newTreeId };
}

/**
 * Step 6: Create branch and commit.
 */
async function createBranchAndCommit(repository: GitRepository, treeId: string): Promise<string> {
  const headCommit = await repository.getHead();
  if (!headCommit) {
    throw new Error("No HEAD commit found");
  }

  await repository.refs.set(`refs/heads/${TEST_BRANCH}`, headCommit);
  printInfo(`Created branch '${TEST_BRANCH}'`);

  const author = createAuthor();
  const commitId = await repository.commits.storeCommit({
    tree: treeId,
    parents: [headCommit],
    author,
    committer: author,
    message: `Add DEMO.md via HTTP server demo

This commit was created using the VCS library as part of the
HTTP Git server demo. It demonstrates the ability to:
- Clone from a VCS-based HTTP server
- Create content and commits with VCS
- Push changes using VCS transport`,
  });
  printInfo(`Created commit: ${shortId(commitId)}`);

  await repository.refs.set(`refs/heads/${TEST_BRANCH}`, commitId);
  await repository.refs.setSymbolic("HEAD", `refs/heads/${TEST_BRANCH}`);

  printSuccess(`Commit ${shortId(commitId)} created on branch '${TEST_BRANCH}'`);

  return commitId;
}

/**
 * Step 7: Push changes using VCS transport.
 */
async function pushChanges(repository: GitRepository, commitId: string): Promise<void> {
  printInfo(`Pushing ${TEST_BRANCH} to remote...`);

  const objectsToPush = await collectObjectsForPush(repository, commitId);

  printInfo(`Collected ${objectsToPush.length} objects to push`);

  const result = await push({
    url: REMOTE_URL,
    refspecs: [`refs/heads/${TEST_BRANCH}:refs/heads/${TEST_BRANCH}`],
    force: true,
    getLocalRef: async (refName: string) => {
      const ref = await repository.refs.resolve(refName);
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
async function collectObjectsForPush(
  repository: GitRepository,
  commitId: string,
): Promise<PushObject[]> {
  const objects: PushObject[] = [];
  const seen = new Set<string>();

  const typeStringToCode: Record<string, number> = {
    commit: 1,
    tree: 2,
    blob: 3,
    tag: 4,
  };

  async function collectObject(id: string): Promise<void> {
    if (seen.has(id)) return;
    seen.add(id);

    const header = await repository.objects.getHeader(id);
    const typeCode = typeStringToCode[header.type];

    const chunks: Uint8Array[] = [];
    for await (const chunk of repository.objects.load(id)) {
      chunks.push(chunk);
    }
    const content = concatBytes(...chunks);

    objects.push({ id, type: typeCode, content });
  }

  async function collectTree(treeId: string): Promise<void> {
    await collectObject(treeId);

    for await (const entry of repository.trees.loadTree(treeId)) {
      if (entry.mode === FileMode.TREE) {
        await collectTree(entry.id);
      } else {
        await collectObject(entry.id);
      }
    }
  }

  await collectObject(commitId);

  const commit = await repository.commits.loadCommit(commitId);
  await collectTree(commit.tree);

  return objects;
}

/**
 * Step 8: Verify push with native git.
 */
async function verifyPushWithNativeGit(expectedCommitId: string): Promise<void> {
  printInfo("Checking remote repository with native git...");

  const branches = await runGitAsync(["branch", "-a"], REMOTE_REPO_DIR);
  if (!branches.includes(TEST_BRANCH)) {
    printError(`Branch '${TEST_BRANCH}' not found in remote!`);
    printInfo(`Available branches: ${branches}`);
    throw new Error("Branch verification failed");
  }
  printSuccess(`Branch '${TEST_BRANCH}' exists in remote`);

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

  const commitInfo = await runGitAsync(
    ["log", "-1", "--format=%H %s", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );
  printInfo(`Commit: ${commitInfo}`);

  const treeFiles = await runGitAsync(
    ["ls-tree", "--name-only", `refs/heads/${TEST_BRANCH}`],
    REMOTE_REPO_DIR,
  );
  if (treeFiles.includes("DEMO.md")) {
    printSuccess("DEMO.md file found in commit");
  } else {
    printError("DEMO.md file not found!");
    throw new Error("File verification failed");
  }

  const fsckResult = await runGitSafeAsync(["fsck", "--full"], REMOTE_REPO_DIR);
  if (fsckResult.ok) {
    printSuccess("Repository integrity check passed (git fsck)");
  } else {
    printError(`Repository integrity check warning: ${fsckResult.output}`);
  }
}

// Run main
main();
