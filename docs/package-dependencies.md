# Package Dependency Diagram

This diagram shows the dependency relationships between packages in the WebRun VCS monorepo.

## Visual Diagram

```mermaid
graph TD
    subgraph "Command Layer"
        commands["@webrun-vcs/commands<br/>High-level Git operations"]
    end

    subgraph "Protocol Layer"
        transport["@webrun-vcs/transport<br/>Git protocols (HTTP, smart protocol)"]
    end

    subgraph "Storage Backends"
        store-mem["@webrun-vcs/store-mem<br/>In-memory storage"]
        store-sql["@webrun-vcs/store-sql<br/>SQLite storage"]
        store-kv["@webrun-vcs/store-kv<br/>Key-value storage"]
    end

    subgraph "Core Layer"
        core["@webrun-vcs/core<br/>Repository, stores, staging, worktree"]
        sandbox["@webrun-vcs/sandbox<br/>Isolated storage utilities"]
    end

    subgraph "Foundation Layer"
        utils["@webrun-vcs/utils<br/>Hash, compression, diff algorithms"]
    end

    subgraph "Development"
        testing["@webrun-vcs/testing<br/>Test utilities & suites"]
    end

    %% Command layer dependencies
    commands --> core
    commands --> transport
    commands --> utils

    %% Protocol layer dependencies
    transport --> core
    transport --> utils

    %% Storage backend dependencies
    store-mem --> core
    store-mem --> sandbox
    store-mem --> utils
    store-sql --> core
    store-sql --> sandbox
    store-sql --> utils
    store-kv --> core
    store-kv --> utils

    %% Core layer dependencies
    core --> utils
    sandbox --> core
    sandbox --> utils

    %% Development dependencies
    testing --> core
```

## Dependency Table

| Package | Runtime Dependencies |
|---------|---------------------|
| `@webrun-vcs/commands` | core, transport, utils |
| `@webrun-vcs/transport` | core, utils |
| `@webrun-vcs/store-mem` | core, sandbox, utils |
| `@webrun-vcs/store-sql` | core, sandbox, utils |
| `@webrun-vcs/store-kv` | core, utils |
| `@webrun-vcs/sandbox` | core, utils |
| `@webrun-vcs/core` | utils |
| `@webrun-vcs/utils` | pako (external) |
| `@webrun-vcs/testing` | core (devDependencies: vitest) |

## Layer Descriptions

### Foundation Layer

**@webrun-vcs/utils** - Pure algorithmic implementations with no VCS-specific dependencies. Provides hashing (SHA-1, CRC32, rolling checksums), compression (zlib via pako), and diff algorithms (Myers diff, binary delta).

### Core Layer

**@webrun-vcs/core** - The heart of the VCS system. Contains:
- Repository interface and factory (`createGitRepository`)
- Object stores (blobs, trees, commits, tags)
- Reference management (branches, tags, HEAD)
- Staging/index area
- Pack file support (reading, writing, indexing)
- Delta compression engine
- Worktree and ignore pattern handling

**@webrun-vcs/sandbox** - Isolated storage utilities for safe experimentation and testing.

### Storage Backends

Multiple backends implementing core storage interfaces:
- **store-mem** - In-memory storage for testing and ephemeral operations
- **store-sql** - SQLite-based persistent storage (via sql.js)
- **store-kv** - Generic key-value store adapter for IndexedDB, LocalStorage, etc.

### Protocol Layer

**@webrun-vcs/transport** - Git network protocols:
- Smart HTTP protocol (v1 and v2)
- Pack transfer and negotiation
- Server-side handlers (UploadPack, ReceivePack)
- HTTP server implementation (works with Deno, Cloudflare Workers, Node.js)

### Command Layer

**@webrun-vcs/commands** - High-level Git operations that compose lower layers:
- Repository commands (init, clone)
- Working tree commands (add, status, checkout)
- History commands (commit, log, diff)
- Branch/tag commands (branch, tag, merge)
- Remote commands (fetch, push, pull)

## ASCII Diagram

For environments that don't render Mermaid:

```
                    ┌──────────────────┐
                    │    commands      │
                    │   (Git API)      │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
│   transport     │  │  store-mem   │  │  store-sql   │
│  (protocols)    │  │  (testing)   │  │  (persist)   │
└────────┬────────┘  └──────┬───────┘  └──────┬───────┘
         │                  │                 │
         └──────────────────┼─────────────────┘
                            │
                            ▼
                   ┌──────────────────┐
                   │       core       │
                   │ (repository,     │
                   │  stores, packs,  │
                   │  staging, refs)  │
                   └────────┬─────────┘
                            │
                            ▼
                      ┌───────────┐
                      │   utils   │
                      │(algorithms)│
                      └───────────┘
```

## Recent Consolidation

The following packages were consolidated into `@webrun-vcs/core` to simplify the architecture:
- `@webrun-vcs/storage-git` → core (Git filesystem storage)
- `@webrun-vcs/staging` → core (index/staging area)
- `@webrun-vcs/vcs` → core (delta engine)
- `@webrun-vcs/worktree` → core (filesystem traversal)

This consolidation reduces the number of packages while keeping the codebase organized with clear module boundaries within core.
