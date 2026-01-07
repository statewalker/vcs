# @statewalker/vcs-commands

High-level Git command API for building version control applications.

## Overview

This package provides a Git-like command interface for VCS operations. Rather than working directly with low-level stores, you interact through familiar commands like `add`, `commit`, `push`, and `merge`. Each command encapsulates the complex multi-step workflows into a simple, type-safe API.

The design follows the command pattern with a fluent builder interface. You create commands through a `Git` factory, configure them with chainable methods, and execute with a single `call()`. This approach mirrors how developers interact with Git while providing the type safety and error handling expected from a library.

Commands work with any storage backend that implements the required store interfaces. Whether your repository lives in the filesystem, SQLite, IndexedDB, or memory, the same commands work identically. For remote operations like fetch and push, the package integrates with the transport layer to handle protocol negotiation and data transfer.

## Installation

```bash
pnpm add @statewalker/vcs-commands
```

**Dependencies:**
- `@statewalker/vcs-core` - Core types, store interfaces, and repository factories
- `@statewalker/vcs-transport` - Remote protocol implementation
- `@statewalker/vcs-utils` - Utility functions

## Quick Start

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { createNodeFilesApi } from "@statewalker/vcs-utils/files";
import * as fs from "node:fs/promises";

// Create a Git-compatible repository
const files = createNodeFilesApi({ fs, rootDir: "/path/to/repo" });
const repository = await createGitRepository(files, ".git");

// Create a staging store (or use one from store-mem/store-sql)
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";
const staging = new MemoryStagingStore();

// Create the Git command interface
const store = createGitStore({ repository, staging });
const git = Git.wrap(store);

// Stage and commit changes
await git.add().addFilepattern(".").call();
await git.commit().setMessage("Initial commit").call();

// Check status
const status = await git.status().call();
console.log("Clean:", status.isClean());

// Clean up
git.dispose();
```

## Public API

### Main Export

```typescript
import {
  // Main entry point
  Git,
  GitCommand,
  TransportCommand,

  // Store creation
  createGitStore,

  // Types
  type GitStore,
  type GitStoreWithWorkTree,
  type CreateGitStoreOptions,

  // Enums
  ResetMode,
  ListBranchMode,
} from "@statewalker/vcs-commands";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@statewalker/vcs-commands/commands` | Individual command classes |
| `@statewalker/vcs-commands/errors` | Error types |
| `@statewalker/vcs-commands/results` | Result types and enums |

### Git Class Methods

The `Git` class provides factory methods for all commands:

| Category | Methods |
|----------|---------|
| **Staging** | `add()`, `rm()`, `status()` |
| **Committing** | `commit()`, `log()` |
| **Branches** | `branchCreate()`, `branchDelete()`, `branchList()`, `branchRename()`, `checkout()` |
| **Tags** | `tag()`, `tagDelete()`, `tagList()` |
| **History** | `reset()`, `rebase()`, `merge()`, `cherryPick()`, `revert()` |
| **Inspection** | `diff()`, `describe()` |
| **Remote** | `fetch()`, `push()`, `pull()`, `clone()`, `lsRemote()` |
| **Remotes** | `remoteAdd()`, `remoteRemove()`, `remoteList()`, `remoteSetUrl()` |
| **Stash** | `stashCreate()`, `stashApply()`, `stashDrop()`, `stashList()` |

## Usage Examples

### Staging and Committing

```typescript
import { Git } from "@statewalker/vcs-commands";

// Stage specific files
await git.add()
  .addFilepattern("src/")
  .addFilepattern("package.json")
  .call();

// Stage all changes including deletions
await git.add()
  .addFilepattern(".")
  .setUpdate(true)
  .call();

// Create a commit
const commitId = await git.commit()
  .setMessage("Add new feature")
  .setAuthor({ name: "Developer", email: "dev@example.com" })
  .call();

// Amend the previous commit
await git.commit()
  .setMessage("Add new feature (fixed)")
  .setAmend(true)
  .call();
```

### Branch Operations

```typescript
// Create a new branch
await git.branchCreate()
  .setName("feature/login")
  .call();

// Create and switch to a new branch
await git.branchCreate()
  .setName("feature/login")
  .setStartPoint("main")
  .call();
await git.checkout()
  .setName("feature/login")
  .call();

// List all branches
const branches = await git.branchList()
  .setListMode(ListBranchMode.ALL)
  .call();
for (const branch of branches) {
  console.log(branch.name, branch.objectId);
}

// Delete a merged branch
await git.branchDelete()
  .setBranchNames("feature/old")
  .call();

// Force delete unmerged branch
await git.branchDelete()
  .setBranchNames("feature/abandoned")
  .setForce(true)
  .call();
```

### Working with History

```typescript
// View commit log
for await (const commit of git.log().setMaxCount(10).call()) {
  console.log(`${commit.id.slice(0, 7)} ${commit.message.split("\n")[0]}`);
}

// Log with filters
const commits = git.log()
  .setMaxCount(50)
  .setAuthor("developer@example.com")
  .addPath("src/")
  .call();

// Reset to previous commit (mixed mode - keeps changes unstaged)
await git.reset()
  .setRef("HEAD~1")
  .setMode(ResetMode.MIXED)
  .call();

// Hard reset (discards all changes)
await git.reset()
  .setRef("main")
  .setMode(ResetMode.HARD)
  .call();
```

### Merging and Rebasing

```typescript
import { MergeStatus, FastForwardMode } from "@statewalker/vcs-commands/results";

// Merge a branch
const result = await git.merge()
  .include("feature/login")
  .call();

if (result.status === MergeStatus.CONFLICTING) {
  console.log("Conflicts in:", result.conflicts);
  // Resolve conflicts, then commit
}

// Merge with no fast-forward (always create merge commit)
await git.merge()
  .include("feature/login")
  .setFastForward(FastForwardMode.NO_FF)
  .setMessage("Merge feature/login")
  .call();

// Rebase onto main
const rebaseResult = await git.rebase()
  .setUpstream("main")
  .call();

// Continue after resolving conflicts
await git.rebase()
  .setOperation("continue")
  .call();

// Abort rebase
await git.rebase()
  .setOperation("abort")
  .call();
```

### Cherry-Pick and Revert

```typescript
// Cherry-pick a specific commit
const cherryResult = await git.cherryPick()
  .include("abc1234")
  .call();

// Revert a commit
const revertResult = await git.revert()
  .include("def5678")
  .call();

// Revert without committing (stage only)
await git.revert()
  .include("def5678")
  .setNoCommit(true)
  .call();
```

### Remote Operations

```typescript
// Configure a remote
await git.remoteAdd()
  .setName("origin")
  .setUri("https://github.com/user/repo.git")
  .call();

// Fetch from remote
const fetchResult = await git.fetch()
  .setRemote("origin")
  .setCredentials({ username: "user", password: "token" })
  .setProgressCallback((progress) => {
    console.log(`${progress.phase}: ${progress.completed}/${progress.total}`);
  })
  .call();

console.log(`Fetched ${fetchResult.trackingRefUpdates.length} refs`);

// Push to remote
const pushResult = await git.push()
  .setRemote("origin")
  .add("refs/heads/main")
  .setCredentials({ username: "user", password: "token" })
  .call();

if (!pushResult.isSuccessful()) {
  console.log("Push failed:", pushResult.messages);
}

// Pull (fetch + merge)
await git.pull()
  .setRemote("origin")
  .setRemoteBranchName("main")
  .call();
```

### Cloning Repositories

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

// Create an in-memory repository for the clone
const repository = await createGitRepository();
const staging = new MemoryStagingStore();
const store = createGitStore({ repository, staging });

// Clone a repository
const result = await Git.clone()
  .setUri("https://github.com/user/repo.git")
  .setStore(store)
  .setCredentials({ token: "github_pat_xxx" })
  .setProgressCallback((progress) => {
    console.log(`${progress.phase}: ${progress.message}`);
  })
  .call();

console.log(`Cloned to branch: ${result.defaultBranch}`);
```

### Stash Operations

```typescript
// Create a stash with a message
const stashResult = await git.stashCreate()
  .setMessage("WIP: feature work")
  .call();

console.log(`Created stash: ${stashResult.stashRef}`);

// Include untracked files (like git stash -u)
await git.stashCreate()
  .setMessage("WIP with new files")
  .setIncludeUntracked(true)
  .call();

// List stashes
const stashes = await git.stashList().call();
for (const stash of stashes) {
  console.log(`stash@{${stash.index}}: ${stash.message}`);
}

// Apply latest stash (keeps stash in list)
await git.stashApply()
  .setStashRef("stash@{0}")
  .call();

// Pop stash (apply and remove)
await git.stashPop()
  .setStashRef("stash@{0}")
  .call();

// Drop a specific stash
await git.stashDrop()
  .setStashRef("stash@{1}")
  .call();

// Clear all stashes
await git.stashClear().call();
```

Stash commits follow Git's structure with 2-3 parents:
- Parent 1: HEAD at time of stash
- Parent 2: Index state commit
- Parent 3 (optional): Untracked files commit (when `includeUntracked: true`)

### Checkout Operations

```typescript
// Switch to a branch
await git.checkout()
  .setName("feature/login")
  .call();

// Create and switch to new branch (like git checkout -b)
await git.checkout()
  .setName("feature/new")
  .setCreateBranch(true)
  .call();

// Checkout specific commit (detached HEAD)
await git.checkout()
  .setName("abc1234")
  .call();

// Checkout specific files from another branch
await git.checkout()
  .setName("main")
  .addPath("src/config.ts")
  .addPath("package.json")
  .call();

// Force checkout (discard local changes)
await git.checkout()
  .setName("main")
  .setForce(true)
  .call();
```

Checkout performs three-way conflict detection before switching branches:

```typescript
import { CheckoutConflictError } from "@statewalker/vcs-commands/errors";

try {
  await git.checkout().setName("main").call();
} catch (error) {
  if (error instanceof CheckoutConflictError) {
    // Local modifications would be overwritten
    console.log("Conflicting paths:");
    for (const conflict of error.conflicts) {
      console.log(`  ${conflict.path}: ${conflict.message}`);
    }

    // Options: stash changes, force checkout, or abort
  }
}
```

Conflict types detected:
- **DIRTY_WORKTREE**: Modified file would be overwritten
- **DIRTY_INDEX**: Staged changes would be lost
- **UNTRACKED_FILE**: New file would be overwritten

### Tags

```typescript
// Create annotated tag
await git.tag()
  .setName("v1.0.0")
  .setMessage("Release version 1.0.0")
  .setTagger({ name: "Developer", email: "dev@example.com" })
  .call();

// Create tag at specific commit
await git.tag()
  .setName("v0.9.0")
  .setObjectId("abc1234")
  .call();

// List tags
const tags = await git.tagList().call();
for (const tag of tags) {
  console.log(tag.name);
}

// Delete tag
await git.tagDelete()
  .setTags("v0.9.0")
  .call();
```

## Error Handling

Commands throw specific error types for different failure modes:

```typescript
import {
  RefNotFoundError,
  MergeConflictError,
  AuthenticationError,
  PushRejectedException,
} from "@statewalker/vcs-commands/errors";

try {
  await git.checkout().setName("nonexistent").call();
} catch (error) {
  if (error instanceof RefNotFoundError) {
    console.log(`Branch not found: ${error.refName}`);
  }
}

try {
  await git.merge().include("feature").call();
} catch (error) {
  if (error instanceof MergeConflictError) {
    console.log("Conflicts:", error.conflicts);
  }
}

try {
  await git.push().setRemote("origin").call();
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.log("Authentication failed");
  } else if (error instanceof PushRejectedException) {
    console.log("Push rejected:", error.message);
  }
}
```

### Error Categories

| Category | Errors |
|----------|--------|
| **Command** | `MissingArgumentError`, `InvalidArgumentError`, `NotImplementedError` |
| **Reference** | `RefNotFoundError`, `RefAlreadyExistsError`, `CannotDeleteCurrentBranchError` |
| **Commit** | `NoMessageError`, `EmptyCommitError`, `UnmergedPathsError` |
| **Merge** | `MergeConflictError`, `NotFastForwardError`, `NoMergeBaseError` |
| **Transport** | `AuthenticationError`, `PushRejectedException`, `NonFastForwardError` |
| **Checkout** | `CheckoutConflictError`, `DirCacheCheckoutError` |
| **Stash** | `NoStashError`, `StashDropError` |

## Result Types

Commands return rich result objects with status information:

```typescript
import {
  MergeStatus,
  PushStatus,
  RebaseStatus,
} from "@statewalker/vcs-commands/results";

// Check merge result
const mergeResult = await git.merge().include("feature").call();
switch (mergeResult.status) {
  case MergeStatus.FAST_FORWARD:
    console.log("Fast-forwarded");
    break;
  case MergeStatus.MERGED:
    console.log("Created merge commit");
    break;
  case MergeStatus.CONFLICTING:
    console.log("Conflicts need resolution");
    break;
}

// Check push result
const pushResult = await git.push().call();
for (const update of pushResult.remoteUpdates) {
  if (update.status === PushStatus.OK) {
    console.log(`Updated: ${update.remoteName}`);
  } else if (update.status === PushStatus.REJECTED_NONFASTFORWARD) {
    console.log(`Rejected: ${update.remoteName} (non-fast-forward)`);
  }
}
```

## Configuration

### Transport Options

Remote commands support authentication and progress tracking:

```typescript
// Username/password authentication
await git.fetch()
  .setRemote("origin")
  .setCredentials({
    username: "user",
    password: "password",
  })
  .call();

// Token authentication
await git.push()
  .setRemote("origin")
  .setCredentials({
    token: "github_pat_xxxx",
  })
  .call();

// Custom headers
await git.fetch()
  .setRemote("origin")
  .setHeaders({
    "X-Custom-Header": "value",
  })
  .call();

// Progress tracking
await git.clone()
  .setUri("https://github.com/user/repo.git")
  .setProgressCallback((progress) => {
    // Structured progress
    console.log(progress.phase, progress.completed, progress.total);
  })
  .setMessageCallback((message) => {
    // Raw server messages
    console.log("Server:", message);
  })
  .call();
```

## Related Packages

| Package | Description |
|---------|-------------|
| `@statewalker/vcs-core` | Core types, store interfaces, and repository factories |
| `@statewalker/vcs-transport` | Git protocol implementation |
| `@statewalker/vcs-store-sql` | SQLite storage backend |
| `@statewalker/vcs-store-mem` | In-memory storage for testing |
| `@statewalker/vcs-store-kv` | Key-value storage abstraction |

## License

MIT
