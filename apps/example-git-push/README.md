# Git Push Example

This example demonstrates the complete branch/commit/push workflow using the statewalker-vcs library with a native git HTTP server.

## What This Example Demonstrates

The example shows how to:
- Open an existing git repository with the high-level Repository API
- Create branches using `repository.refs`
- Store blobs, trees, and commits using typed stores
- Push changes to a remote using VCS transport

## High-Level APIs Used

| API | Purpose |
|-----|---------|
| `createGitRepository()` | Open repository with high-level API |
| `repository.blobs.store()` | Store file content as blob |
| `repository.trees.storeTree()` | Create directory snapshots |
| `repository.commits.storeCommit()` | Create commit objects |
| `repository.refs.set()` | Create/update branch references |
| `repository.refs.setSymbolic()` | Update HEAD reference |
| `push()` from `@statewalker/vcs-transport` | Push to remote |

## Prerequisites

- Node.js 18+
- pnpm
- Git (for repository setup and verification)

## Running the Example

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-git-push start
```

## Workflow Steps

1. **Setup Remote Repository** - Creates a bare git repository with an initial commit
2. **Start HTTP Server** - Starts a native git HTTP server
3. **Clone Repository** - Clones using native git
4. **Open with VCS** - Opens the repository using `createGitRepository()`
5. **Create Branch** - Creates a new branch using `repository.refs.set()`
6. **Make Commit** - Creates blob, tree, and commit using typed stores
7. **Push Changes** - Pushes using VCS transport with `push()`
8. **Verify** - Verifies the push using native git

## Key Patterns

### Opening Repository with High-Level API

```typescript
import { createGitRepository, type GitRepository } from "@statewalker/vcs-commands";

const repository = await createGitRepository(files, ".git", {
  create: false,
}) as GitRepository;
```

### Creating a Commit with Typed Stores

```typescript
// Store blob
const blobId = await repository.blobs.store([content]);

// Create tree
const treeId = await repository.trees.storeTree([
  { mode: FileMode.REGULAR_FILE, name: "file.txt", id: blobId },
]);

// Create commit
const commitId = await repository.commits.storeCommit({
  tree: treeId,
  parents: [headCommit],
  author,
  committer: author,
  message: "Commit message",
});

// Update branch
await repository.refs.set("refs/heads/branch", commitId);
```

### Pushing with VCS Transport

```typescript
import { push } from "@statewalker/vcs-transport";

const result = await push({
  url: remoteUrl,
  refspecs: ["refs/heads/branch:refs/heads/branch"],
  getLocalRef: async (refName) => {
    const ref = await repository.refs.resolve(refName);
    return ref?.objectId;
  },
  getObjectsToPush: async function* () {
    // Yield objects to include in pack
  },
});
```

## Project Structure

```
apps/example-git-push/
├── package.json
├── README.md
└── src/
    ├── main.ts              # Main entry point
    └── shared/
        ├── config.ts        # Configuration constants
        ├── helpers.ts       # Utility functions
        ├── http-server.ts   # Git HTTP server wrapper
        └── index.ts         # Shared exports
```

## Related Examples

- [example-vcs-http-roundtrip](../example-vcs-http-roundtrip/) - Complete VCS-based HTTP workflow
- [example-git-cycle](../example-git-cycle/) - Basic git operations lifecycle
