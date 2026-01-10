# JGit Analyzer Example Application Plan

This document outlines the implementation plan for an example application that demonstrates webrun-vcs capabilities by cloning and analyzing the Eclipse JGit repository.

## Overview

The application demonstrates the complete workflow of working with a real-world Git repository using the webrun-vcs commands API:

1. **Clone** the Eclipse JGit repository from GitHub
2. **Analyze** the last ~1000 commits and compute contributor statistics
3. **Display** top 10 contributors with commit counts
4. **Show** changed files for the last 3 commits of the top contributor
5. **Checkout** the latest commit to a working directory
6. **Verify** synchronization with native Git

## Application Structure

```
apps/example-jgit-analyzer/
├── package.json
├── README.md
├── tsconfig.json
└── src/
    ├── main.ts                    # Entry point - orchestrates all steps
    ├── shared/
    │   ├── index.ts               # Re-exports all shared utilities
    │   ├── config.ts              # Constants and configuration
    │   ├── helpers.ts             # Git helper functions
    │   ├── output.ts              # Console output formatting
    │   └── storage.ts             # Repository and store creation
    └── steps/
        ├── 01-clone-repository.ts # Clone jgit from GitHub
        ├── 02-analyze-commits.ts  # Collect commit statistics
        ├── 03-show-contributors.ts # Display top contributors
        ├── 04-show-changes.ts     # Show file changes for commits
        ├── 05-checkout-workdir.ts # Extract files to working directory
        └── 06-verify-sync.ts      # Verify with native git
```

## Implementation Details

### Step 0: Package Configuration

Create `package.json` with dependencies:

```json
{
  "name": "@webrun-vcs/example-jgit-analyzer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Example analyzing Eclipse JGit repository with webrun-vcs",
  "scripts": {
    "start": "tsx src/main.ts",
    "step:01": "tsx src/steps/01-clone-repository.ts",
    "step:02": "tsx src/steps/02-analyze-commits.ts",
    "step:03": "tsx src/steps/03-show-contributors.ts",
    "step:04": "tsx src/steps/04-show-changes.ts",
    "step:05": "tsx src/steps/05-checkout-workdir.ts",
    "step:06": "tsx src/steps/06-verify-sync.ts"
  },
  "dependencies": {
    "@statewalker/webrun-files": "catalog:",
    "@statewalker/vcs-commands": "workspace:*",
    "@statewalker/vcs-core": "workspace:*",
    "@statewalker/vcs-store-mem": "workspace:*",
    "@statewalker/vcs-utils": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "catalog:",
    "tsx": "catalog:",
    "typescript": "catalog:"
  }
}
```

### Step 1: Clone Repository

**File:** `src/steps/01-clone-repository.ts`

Uses the `CloneCommand` from the commands API to clone the JGit repository.

```typescript
import * as fs from "node:fs/promises";
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import { createGitRepository } from "@statewalker/vcs-core";
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";
import { setCompression } from "@statewalker/vcs-utils";
import { createNodeCompression } from "@statewalker/vcs-utils-node";

const JGIT_URL = "https://github.com/eclipse-jgit/jgit";
const REPO_DIR = "/tmp/webrun-vcs-example/jgit-repo";

export async function step01CloneRepository() {
  // Initialize compression (required for Git operations)
  setCompression(createNodeCompression());

  // Create directory structure
  await fs.mkdir(REPO_DIR, { recursive: true });

  // Create file-based repository
  const files = new FilesApi(new NodeFilesApi({ fs, rootDir: REPO_DIR }));
  const repository = await createGitRepository(files, ".git", {
    create: true,
    defaultBranch: "master",
  });

  // Create staging store and Git facade
  const staging = new MemoryStagingStore();
  const store = createGitStore({ repository, staging });
  const git = Git.wrap(store);

  // Clone the repository (this may take a while for a large repo)
  console.log(`Cloning ${JGIT_URL}...`);
  const result = await git.clone()
    .setURI(JGIT_URL)
    .setNoCheckout(true)  // We'll checkout later
    .call();

  console.log(`Clone complete. Default branch: ${result.defaultBranch}`);
  console.log(`HEAD commit: ${result.headCommit}`);

  return { repository, git, staging };
}
```

**Key Implementation Points:**

- Use `NodeFilesApi` for file-based storage in `/tmp/webrun-vcs-example/jgit-repo`
- Initialize compression with `createNodeCompression()` - required for Git pack handling
- Use `setNoCheckout(true)` during clone to avoid immediate file extraction
- Store repository reference for subsequent steps

### Step 2: Analyze Commits

**File:** `src/steps/02-analyze-commits.ts`

Uses the `LogCommand` to traverse commit history and collect statistics.

```typescript
import type { Git, GitStore } from "@statewalker/vcs-commands";

interface ContributorStats {
  name: string;
  email: string;
  commitCount: number;
  latestCommitId: string;
  commits: string[];  // Store commit IDs for later analysis
}

export async function step02AnalyzeCommits(git: Git): Promise<Map<string, ContributorStats>> {
  const contributors = new Map<string, ContributorStats>();
  const MAX_COMMITS = 1000;

  console.log(`Analyzing last ${MAX_COMMITS} commits...`);

  let count = 0;
  for await (const commit of await git.log().setMaxCount(MAX_COMMITS).call()) {
    count++;

    const authorKey = `${commit.author.name} <${commit.author.email}>`;

    if (!contributors.has(authorKey)) {
      contributors.set(authorKey, {
        name: commit.author.name,
        email: commit.author.email,
        commitCount: 0,
        latestCommitId: commit.id,
        commits: [],
      });
    }

    const stats = contributors.get(authorKey)!;
    stats.commitCount++;

    // Store up to 3 commit IDs for the top contributor analysis
    if (stats.commits.length < 3) {
      stats.commits.push(commit.id);
    }
  }

  console.log(`Analyzed ${count} commits from ${contributors.size} contributors`);

  return contributors;
}
```

**Key Implementation Points:**

- Use `git.log().setMaxCount(1000).call()` to limit history traversal
- Commits are yielded as `Commit` objects with `author`, `committer`, `message`, `tree`, `parents`
- Track commit IDs for later diff analysis
- Use author email as unique key (same person may use different name variations)

### Step 3: Show Top Contributors

**File:** `src/steps/03-show-contributors.ts`

Sorts and displays the top 10 contributors.

```typescript
import type { ContributorStats } from "./02-analyze-commits.js";

export function step03ShowContributors(
  contributors: Map<string, ContributorStats>,
): ContributorStats[] {
  // Sort by commit count (descending)
  const sorted = [...contributors.values()]
    .sort((a, b) => b.commitCount - a.commitCount);

  console.log("\n┌─────────────────────────────────────────────────────────────────┐");
  console.log("│                    Top 10 Contributors                          │");
  console.log("├────┬───────────────────────────────────────────────┬────────────┤");
  console.log("│ #  │ Author                                        │ Commits    │");
  console.log("├────┼───────────────────────────────────────────────┼────────────┤");

  const top10 = sorted.slice(0, 10);
  for (let i = 0; i < top10.length; i++) {
    const c = top10[i];
    const rank = String(i + 1).padStart(2);
    const name = `${c.name} <${c.email}>`.slice(0, 45).padEnd(45);
    const count = String(c.commitCount).padStart(8);
    console.log(`│ ${rank} │ ${name} │ ${count}   │`);
  }

  console.log("└────┴───────────────────────────────────────────────┴────────────┘");

  return top10;
}
```

### Step 4: Show Changed Files

**File:** `src/steps/04-show-changes.ts`

Uses the `DiffCommand` to show files changed in the top contributor's last 3 commits.

```typescript
import type { Git } from "@statewalker/vcs-commands";
import { ChangeType } from "@statewalker/vcs-commands";
import type { ContributorStats } from "./02-analyze-commits.js";

export async function step04ShowChanges(
  git: Git,
  topContributor: ContributorStats,
): Promise<void> {
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  Last 3 Commits by ${topContributor.name}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  for (const commitId of topContributor.commits) {
    // Load commit to get message and parent
    const store = git.getStore();
    const commit = await store.commits.loadCommit(commitId);

    // Get first line of commit message
    const subject = commit.message.split("\n")[0].slice(0, 60);

    console.log(`Commit: ${commitId.slice(0, 7)}`);
    console.log(`Subject: ${subject}`);
    console.log(`Date: ${new Date(commit.committer.timestamp * 1000).toISOString()}`);

    // Calculate diff with parent (if exists)
    if (commit.parents.length > 0) {
      const entries = await git.diff()
        .setOldTree(commit.parents[0])
        .setNewTree(commitId)
        .call();

      console.log(`Changed files (${entries.length}):`);
      for (const entry of entries.slice(0, 20)) {
        const changeChar = getChangeChar(entry.changeType);
        const path = entry.newPath ?? entry.oldPath ?? "unknown";
        console.log(`  ${changeChar} ${path}`);
      }

      if (entries.length > 20) {
        console.log(`  ... and ${entries.length - 20} more files`);
      }
    } else {
      console.log("  (Initial commit - no parent)");
    }

    console.log("");
  }
}

function getChangeChar(type: ChangeType): string {
  switch (type) {
    case ChangeType.ADD: return "A";
    case ChangeType.DELETE: return "D";
    case ChangeType.MODIFY: return "M";
    case ChangeType.RENAME: return "R";
    case ChangeType.COPY: return "C";
  }
}
```

**Key Implementation Points:**

- Use `git.diff().setOldTree(parent).setNewTree(commit).call()` to compare commits
- `DiffEntry` contains `changeType`, `oldPath`, `newPath`, `oldId`, `newId`
- Handle initial commits (no parents) gracefully
- Limit displayed files to keep output readable

### Step 5: Checkout to Working Directory

**File:** `src/steps/05-checkout-workdir.ts`

Extracts files from the latest commit to a working directory.

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Git, GitStore } from "@statewalker/vcs-commands";
import { FileMode } from "@statewalker/vcs-core";

const WORKDIR = "/tmp/webrun-vcs-example/jgit-workdir";

export async function step05CheckoutWorkdir(git: Git): Promise<string> {
  const store = git.getStore();

  // Get HEAD commit
  const headRef = await store.refs.resolve("HEAD");
  if (!headRef?.objectId) {
    throw new Error("No HEAD commit found");
  }

  console.log(`Checking out commit ${headRef.objectId.slice(0, 7)} to ${WORKDIR}`);

  // Load commit to get tree
  const commit = await store.commits.loadCommit(headRef.objectId);

  // Clean and create work directory
  await fs.rm(WORKDIR, { recursive: true, force: true });
  await fs.mkdir(WORKDIR, { recursive: true });

  // Extract tree recursively
  let fileCount = 0;
  await extractTree(store, commit.tree, WORKDIR, () => fileCount++);

  console.log(`Extracted ${fileCount} files to working directory`);

  // Update staging area to match extracted tree
  await store.staging.readTree(store.trees, commit.tree);
  await store.staging.write();

  // Create .git directory symlink or copy essential files for native git
  await setupGitDirectory(WORKDIR, headRef.objectId);

  return WORKDIR;
}

async function extractTree(
  store: GitStore,
  treeId: string,
  basePath: string,
  onFile: () => void,
): Promise<void> {
  for await (const entry of store.trees.loadTree(treeId)) {
    const fullPath = path.join(basePath, entry.name);

    if (entry.mode === FileMode.TREE) {
      // Create directory and recurse
      await fs.mkdir(fullPath, { recursive: true });
      await extractTree(store, entry.id, fullPath, onFile);
    } else {
      // Extract file content
      const content = await loadBlobContent(store, entry.id);
      await fs.writeFile(fullPath, content, {
        mode: entry.mode === FileMode.EXECUTABLE_FILE ? 0o755 : 0o644,
      });
      onFile();
    }
  }
}

async function loadBlobContent(store: GitStore, blobId: string): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of store.blobs.load(blobId)) {
    chunks.push(chunk);
  }

  // Concatenate chunks
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function setupGitDirectory(workdir: string, headCommitId: string): Promise<void> {
  // Create minimal .git directory for native git verification
  const gitDir = path.join(workdir, ".git");
  await fs.mkdir(gitDir, { recursive: true });

  // Create HEAD pointing to detached commit
  await fs.writeFile(path.join(gitDir, "HEAD"), headCommitId + "\n");

  // Copy or link objects directory from our repository
  // This requires access to the repository's objects directory
  // For verification, we may need to use native git init + fetch approach
}
```

**Key Implementation Points:**

- Load commit tree and extract all files recursively
- Use `store.blobs.load(blobId)` to stream file content
- Handle file modes (executable vs regular)
- Update staging area with `readTree()` to track current state
- Set up minimal `.git` directory for native git compatibility

### Step 6: Verify with Native Git

**File:** `src/steps/06-verify-sync.ts`

Verifies that native git shows the repository as "in sync".

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function step06VerifySync(
  repoDir: string,
  workdir: string,
  expectedHead: string,
): Promise<boolean> {
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("  Verification with Native Git");
  console.log("═══════════════════════════════════════════════════════════════\n");

  try {
    // Initialize git in workdir if not already
    await runGit(["init"], workdir);

    // Add the repository as a remote
    await runGit(["remote", "add", "origin", repoDir], workdir).catch(() => {
      // Remote may already exist
      return runGit(["remote", "set-url", "origin", repoDir], workdir);
    });

    // Fetch from our repository
    await runGit(["fetch", "origin"], workdir);

    // Check current HEAD
    const headCommit = await runGit(["rev-parse", "HEAD"], repoDir);
    console.log(`Repository HEAD: ${headCommit.slice(0, 7)}`);

    // Run git status in workdir
    const status = await runGit(["status", "--porcelain"], workdir);

    if (status.trim() === "") {
      console.log("✓ Working directory is clean (in sync with repository)");
      return true;
    } else {
      console.log("Working directory has uncommitted changes:");
      console.log(status);
      return false;
    }
  } catch (error) {
    console.error("Verification failed:", error);
    return false;
  }
}

async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}
```

**Alternative Verification Approach:**

Since webrun-vcs uses its own object storage format, direct native git verification requires:

1. **Option A: Use git fsck on our repository**
   - Run `git fsck` on the repository directory to verify object integrity
   - This works if our objects are Git-compatible

2. **Option B: Re-clone with native git and compare**
   - Clone the same repository with native git
   - Compare file checksums between our checkout and native checkout
   - More reliable but slower

3. **Option C: Use our library to verify**
   - Compute tree hash from working directory
   - Compare with HEAD tree hash
   - Pure JavaScript verification

```typescript
// Option C: Pure verification with webrun-vcs
async function verifyWithVcs(git: Git, workdir: string): Promise<boolean> {
  const store = git.getStore();

  // Get expected tree from HEAD
  const headRef = await store.refs.resolve("HEAD");
  const commit = await store.commits.loadCommit(headRef.objectId);
  const expectedTree = commit.tree;

  // Build actual tree from staging area (which matches workdir)
  const actualTree = await store.staging.writeTree(store.trees);

  if (expectedTree === actualTree) {
    console.log("✓ Working directory tree matches HEAD");
    return true;
  } else {
    console.log("✗ Tree mismatch:");
    console.log(`  Expected: ${expectedTree}`);
    console.log(`  Actual: ${actualTree}`);
    return false;
  }
}
```

### Main Entry Point

**File:** `src/main.ts`

Orchestrates all steps with progress output and error handling.

```typescript
import { step01CloneRepository } from "./steps/01-clone-repository.js";
import { step02AnalyzeCommits } from "./steps/02-analyze-commits.js";
import { step03ShowContributors } from "./steps/03-show-contributors.js";
import { step04ShowChanges } from "./steps/04-show-changes.js";
import { step05CheckoutWorkdir } from "./steps/05-checkout-workdir.js";
import { step06VerifySync } from "./steps/06-verify-sync.js";
import { printSection, printStep, printSuccess, printError } from "./shared/output.js";

async function main() {
  printSection("JGit Repository Analyzer");
  console.log("This example demonstrates webrun-vcs by analyzing the Eclipse JGit repository.");
  console.log("");

  try {
    // Step 1: Clone repository
    printStep(1, "Cloning JGit repository from GitHub");
    const { repository, git } = await step01CloneRepository();
    printSuccess("Repository cloned successfully");

    // Step 2: Analyze commits
    printStep(2, "Analyzing commit history");
    const contributors = await step02AnalyzeCommits(git);
    printSuccess(`Analyzed ${contributors.size} contributors`);

    // Step 3: Show top contributors
    printStep(3, "Displaying top contributors");
    const top10 = step03ShowContributors(contributors);

    // Step 4: Show changes for top contributor
    printStep(4, "Showing recent changes by top contributor");
    await step04ShowChanges(git, top10[0]);

    // Step 5: Checkout to working directory
    printStep(5, "Checking out latest commit");
    const workdir = await step05CheckoutWorkdir(git);
    printSuccess(`Files extracted to ${workdir}`);

    // Step 6: Verify with native git
    printStep(6, "Verifying synchronization");
    const verified = await step06VerifySync(repository, workdir, "HEAD");

    if (verified) {
      printSuccess("All verification checks passed!");
    }

    // Cleanup
    git.close();
    await repository.close();

    printSection("Complete!");
  } catch (error) {
    printError(`Error: ${error instanceof Error ? error.message : error}`);
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
```

## Configuration and Constants

**File:** `src/shared/config.ts`

```typescript
import * as path from "node:path";
import * as os from "node:os";

// Base directory for all example data
export const BASE_DIR = path.join(os.tmpdir(), "webrun-vcs-example");

// Repository directory (contains .git with all objects)
export const REPO_DIR = path.join(BASE_DIR, "jgit-repo");

// Working directory (checked out files)
export const WORKDIR = path.join(BASE_DIR, "jgit-workdir");

// JGit repository URL
export const JGIT_URL = "https://github.com/eclipse-jgit/jgit";

// Number of commits to analyze
export const MAX_COMMITS = 1000;

// Number of top contributors to show
export const TOP_CONTRIBUTORS = 10;

// Number of commits to show changed files for
export const COMMITS_TO_DETAIL = 3;
```

## Error Handling and Edge Cases

### Clone Failures

```typescript
try {
  await git.clone().setURI(url).call();
} catch (error) {
  if (error.message.includes("network")) {
    console.error("Network error - check your internet connection");
  } else if (error.message.includes("authentication")) {
    console.error("Authentication required - this example uses public repos only");
  }
  throw error;
}
```

### Large Repository Handling

The JGit repository is substantial. Handle memory efficiently:

```typescript
// Use streaming for large files
for await (const chunk of store.blobs.load(blobId)) {
  await writeStream.write(chunk);
}

// Process commits in batches if needed
const BATCH_SIZE = 100;
let batch: Commit[] = [];
for await (const commit of git.log().call()) {
  batch.push(commit);
  if (batch.length >= BATCH_SIZE) {
    processBatch(batch);
    batch = [];
  }
}
```

### Partial Clone Fallback

If full clone is too slow, consider shallow clone:

```typescript
// Shallow clone for faster testing
const result = await git.clone()
  .setURI(JGIT_URL)
  .setDepth(1000)  // Only last 1000 commits
  .setNoCheckout(true)
  .call();
```

## Testing Strategy

### Unit Tests

Test individual components:

- Statistics calculation
- Tree traversal
- File extraction

### Integration Tests

Test against a smaller repository first:

```typescript
// Use a smaller test repo for CI
const TEST_URL = "https://github.com/octocat/Hello-World";
```

### Manual Testing

Run the complete workflow:

```bash
cd apps/example-jgit-analyzer
pnpm start
```

## Performance Considerations

### Clone Performance

- JGit repository is ~1GB with full history
- Network bandwidth is the primary bottleneck
- Consider using `setDepth()` for shallow clone during development

### Memory Usage

- Stream large blobs instead of loading into memory
- Process commits incrementally
- Clear references to allow garbage collection

### Disk Space

- Repository: ~500MB-1GB
- Working directory: ~50MB (source files only)
- Total: ~1.5GB required in temp directory

## Dependencies Summary

| Package | Purpose |
|---------|---------|
| `@statewalker/vcs-commands` | High-level Git command API |
| `@statewalker/vcs-core` | Repository, object stores, tree/blob handling |
| `@statewalker/vcs-store-mem` | In-memory staging store |
| `@statewalker/vcs-utils` | Compression utilities |
| `@statewalker/webrun-files` | File system abstraction |

## Implementation Checklist

- [ ] Create `apps/example-jgit-analyzer` directory structure
- [ ] Set up `package.json` with dependencies
- [ ] Implement shared utilities (config, helpers, output)
- [ ] Implement Step 1: Clone repository
- [ ] Implement Step 2: Analyze commits
- [ ] Implement Step 3: Show contributors
- [ ] Implement Step 4: Show changed files
- [ ] Implement Step 5: Checkout workdir
- [ ] Implement Step 6: Verify sync
- [ ] Create main.ts orchestration
- [ ] Write README.md with usage instructions
- [ ] Test complete workflow
- [ ] Handle edge cases and errors

## Success Criteria

1. **Clone completes** - Repository is fully cloned to local storage
2. **Statistics accurate** - Commit counts match `git shortlog -sn | head -10`
3. **Diff correct** - Changed files match `git show --stat <commit>`
4. **Checkout complete** - All files extracted with correct content
5. **Verification passes** - Native git confirms repository is in sync
