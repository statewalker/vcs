# StateWalker VCS

A TypeScript implementation of Git-compatible version control for browsers and Node.js.

## About

StateWalker VCS provides a complete Git-compatible version control system that runs entirely in JavaScript/TypeScript environments. It supports multiple storage backends including IndexedDB, SQLite, and in-memory storage.

## Features

- Full Git object model (blobs, trees, commits, tags)
- Delta compression and pack files
- Multiple storage backends
- WebRTC peer-to-peer synchronization
- HTTP smart protocol support

## Links

- [GitHub Repository](https://github.com/statewalker/vcs)
- [Architecture Documentation](https://github.com/statewalker/vcs/blob/main/ARCHITECTURE.md)

## Quick Start

```bash
npm install @statewalker/vcs-commands
```

```typescript
import { init, add, commit } from "@statewalker/vcs-commands";

// Initialize a new repository
await init({ dir: "/my-repo" });

// Stage and commit files
await add({ dir: "/my-repo", filepath: "." });
await commit({ dir: "/my-repo", message: "Initial commit" });
```
