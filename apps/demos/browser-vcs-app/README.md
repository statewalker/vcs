# Browser VCS App

A browser-based Git application demonstrating WebRun VCS with swappable storage backends.

## Quick Start

```bash
pnpm dev
```

Then open http://localhost:5173 in your browser.

## Features

### Storage Backends

Toggle between two storage options:

1. **In-Memory** - Fast, ephemeral storage that resets on page refresh
2. **Browser Filesystem** - Persistent storage using the File System Access API

### Git Operations

- Initialize a new repository
- Add files to staging
- Create commits
- View commit history

## Browser Compatibility

### File System Access API Support

| Browser | Supported |
|---------|-----------|
| Chrome 86+ | Yes |
| Edge 86+ | Yes |
| Opera 72+ | Yes |
| Firefox | No (uses in-memory fallback) |
| Safari | No (uses in-memory fallback) |

### Fallback Behavior

In browsers without File System Access API support:
- The "Browser Filesystem" button is disabled
- Only in-memory storage is available
- All functionality works, but data is lost on refresh

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser VCS Application                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    @statewalker/vcs-core                    │ │
│  │                    @statewalker/vcs-commands                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                              ↓                                   │
│                    FilesApi Interface                            │
│                    (@statewalker/webrun-files)                   │
│                              ↓                                   │
│  ┌──────────────────────┬──────────────────────────────────────┐│
│  │                      │                                       ││
│  │  webrun-files-mem    │     File System Access API            ││
│  │  (In-Memory)         │     (Browser Native)                  ││
│  │                      │                                       ││
│  │  - Quick testing     │     - Persistent storage              ││
│  │  - No permission     │     - User picks directory            ││
│  │  - Lost on refresh   │     - Survives refresh                ││
│  │                      │     - Works with local files          ││
│  └──────────────────────┴──────────────────────────────────────┘│
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Concepts Demonstrated

### Storage Abstraction

```typescript
import type { FilesApi } from "@statewalker/webrun-files";
import { createFilesApi as createMemoryFiles } from "@statewalker/webrun-files-mem";

// In-memory storage
const memoryFiles = createMemoryFiles();

// Browser filesystem (File System Access API)
const dirHandle = await window.showDirectoryPicker();
const browserFiles = await createBrowserFilesApi(dirHandle);
```

### Repository Creation

```typescript
import { createGitRepository } from "@statewalker/vcs-core";
import { createGitStore, Git } from "@statewalker/vcs-commands";

const repository = await createGitRepository(files, ".git", {
  create: true,
  defaultBranch: "main",
});

const store = createGitStore({ repository, staging });
const git = Git.wrap(store);
```

### Git Operations

```typescript
// Add file
const objectId = await store.blobs.store([data]);
const editor = store.staging.editor();
editor.add({ path, apply: () => ({ path, mode, objectId, stage, size, mtime }) });
await editor.finish();

// Commit
const commit = await git.commit().setMessage("Add files").call();
const commitId = await store.commits.storeCommit(commit);
```

## Development

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview
```

## No Server Required

This application runs entirely in the browser. No backend server is needed. Git operations are performed locally using the VCS library compiled to JavaScript.
