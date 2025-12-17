# @webrun-vcs/worktree

Working tree operations including file tracking, status calculation, and gitignore handling.

## Overview

This package bridges the gap between the VCS storage layer and actual files on disk (or in a virtual file system). It handles staging files for commit, checking out files from commits, calculating repository status, and respecting gitignore patterns. These operations form the core of day-to-day Git workflows.

The working tree represents the actual files you edit, while the index (staging area) holds a snapshot of what will go into the next commit. This package manages both, tracking which files are staged, which are modified, and which are untracked. The status calculator compares these states to produce the familiar output showing what changed.

Like other webrun-vcs packages, this one uses `@statewalker/webrun-files` for file system access. This abstraction enables working with files in browsers through virtual file systems, not just traditional disk access.

## Installation

```bash
pnpm add @webrun-vcs/worktree
```

## Public API

### Main Exports

| Export | Description |
|--------|-------------|
| `AddCommand` | Stage files to the index |
| `CheckoutCommand` | Checkout files from trees |
| `FileTreeIterator` | Iterate working tree files |
| `StatusCalculator` | Calculate repository status |
| `IgnorePattern` | Gitignore pattern matching |

### Interface Exports

| Export | Description |
|--------|-------------|
| `WorktreeStatus` | Status result interface |
| `FileEntry` | File entry interface |
| `StatusEntry` | Individual file status |

## Usage Examples

### Adding Files to Staging

Stage files for the next commit:

```typescript
import { AddCommand } from "@webrun-vcs/worktree";

const add = new AddCommand({
  storage,
  fileSystem,
  workingDirectory: "/path/to/repo",
});

// Add specific files
await add
  .addFilepattern("src/index.ts")
  .addFilepattern("src/utils.ts")
  .call();

// Add all files
await add.addFilepattern(".").call();

// Add all .ts files
await add.addFilepattern("*.ts").call();
```

### Checking Out Files

Restore files from a commit or branch:

```typescript
import { CheckoutCommand } from "@webrun-vcs/worktree";

const checkout = new CheckoutCommand({
  storage,
  fileSystem,
  workingDirectory: "/path/to/repo",
});

// Checkout specific files from HEAD
await checkout
  .addPath("src/index.ts")
  .call();

// Checkout from a specific commit
await checkout
  .setStartPoint("abc123...")
  .addPath(".")
  .call();
```

### Calculating Repository Status

Compare working tree, index, and HEAD:

```typescript
import { StatusCalculator } from "@webrun-vcs/worktree";

const calculator = new StatusCalculator({
  storage,
  fileSystem,
  workingDirectory: "/path/to/repo",
});

const status = await calculator.calculate();

// Files staged for commit (in index, different from HEAD)
for (const file of status.staged) {
  console.log(`Staged: ${file.path} (${file.status})`);
}

// Files modified but not staged (working tree different from index)
for (const file of status.modified) {
  console.log(`Modified: ${file.path}`);
}

// Untracked files (not in index)
for (const file of status.untracked) {
  console.log(`Untracked: ${file.path}`);
}
```

### Working with Gitignore Patterns

```typescript
import { IgnorePattern } from "@webrun-vcs/worktree";

const pattern = new IgnorePattern();

// Load patterns from .gitignore content
pattern.addPatterns(`
node_modules/
*.log
.env
!.env.example
`);

// Check if a file should be ignored
if (pattern.isIgnored("node_modules/package/index.js")) {
  console.log("File is ignored");
}

// Negation patterns work too
if (!pattern.isIgnored(".env.example")) {
  console.log(".env.example is not ignored");
}
```

### Iterating Working Tree Files

```typescript
import { FileTreeIterator } from "@webrun-vcs/worktree";

const iterator = new FileTreeIterator({
  fileSystem,
  rootPath: "/path/to/repo",
  ignorePattern, // Optional gitignore pattern
});

for await (const entry of iterator) {
  console.log(`${entry.path}: ${entry.mode}`);
}
```

## Architecture

### Design Decisions

The command pattern (AddCommand, CheckoutCommand) provides a consistent, builder-style API that mirrors Git's command-line interface. Each command configures itself through method chaining, then executes with `call()`. This approach makes code readable and self-documenting.

Status calculation deliberately separates the three-way comparison (HEAD vs index vs working tree) into distinct stages. This separation simplifies the logic and makes it easier to understand which changes belong to which category.

### Implementation Details

**The Index** (staging area) stores file paths with their blob hashes, modes, and timestamps. The implementation follows Git's index format, enabling interoperability with Git tooling when using the file-based storage backend.

**Gitignore Processing** implements the full gitignore specification, including negation patterns (lines starting with `!`), directory patterns (ending with `/`), and anchored patterns (starting with `/`). Patterns are evaluated in order, with later patterns overriding earlier ones.

**File Tree Iteration** walks the file system while respecting gitignore patterns. It skips ignored directories entirely for performance, avoiding unnecessary traversal into `node_modules` or other excluded areas.

## JGit References

This package maps to JGit's working tree and staging functionality:

| webrun-vcs | JGit |
|------------|------|
| `AddCommand` | `DirCacheBuilder`, `DirCacheEditor` |
| `CheckoutCommand` | `DirCacheCheckout`, `Checkout` |
| `FileTreeIterator` | `FileTreeIterator`, `WorkingTreeIterator` |
| `StatusCalculator` | `IndexDiff` |
| `IgnorePattern` | Pattern matching in treewalk |
| Status interfaces | `Status` (from api package) |

## Dependencies

**Runtime:**
- `@statewalker/webrun-files` - File system abstraction
- `@webrun-vcs/vcs` - Interface definitions
- `@webrun-vcs/utils` - Hashing utilities

**Development:**
- `@webrun-vcs/testing` - Test suites for validation
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
