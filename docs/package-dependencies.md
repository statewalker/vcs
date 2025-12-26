# Package Dependency Diagram

This diagram shows the dependency relationships between packages in the WebRun VCS monorepo.

## Visual Diagram

```mermaid
graph TD
    subgraph "Command Layer"
        commands["@webrun-vcs/commands<br/>High-level operations"]
    end

    subgraph "Protocol Layer"
        transport["@webrun-vcs/transport<br/>Git protocols"]
        staging["@webrun-vcs/staging<br/>Index/staging area"]
    end

    subgraph "Storage Layer"
        storage-git["@webrun-vcs/storage-git<br/>Git filesystem"]
        store-mem["@webrun-vcs/store-mem<br/>In-memory"]
        store-sql["@webrun-vcs/store-sql<br/>SQLite"]
        store-kv["@webrun-vcs/store-kv<br/>Key-value"]
        sandbox["@webrun-vcs/sandbox<br/>Isolated storage"]
    end

    subgraph "Engine Layer"
        vcs["@webrun-vcs/vcs<br/>Delta engine"]
        worktree["@webrun-vcs/worktree<br/>Filesystem traversal"]
    end

    subgraph "Core Layer"
        core["@webrun-vcs/core<br/>Interfaces & formats"]
    end

    subgraph "Foundation Layer"
        utils["@webrun-vcs/utils<br/>Algorithms"]
    end

    subgraph "Development"
        testing["@webrun-vcs/testing<br/>Test utilities"]
        storage-tests["@webrun-vcs/storage-tests<br/>Storage test suites"]
    end

    %% Command layer dependencies
    commands --> core
    commands --> transport
    commands --> storage-git
    commands --> utils

    %% Protocol layer dependencies
    transport --> core
    transport --> utils
    staging --> core

    %% Storage layer dependencies
    storage-git --> core
    storage-git --> vcs
    storage-git --> worktree
    storage-git --> utils
    store-mem --> core
    store-mem --> sandbox
    store-mem --> utils
    store-sql --> core
    store-sql --> sandbox
    store-sql --> utils
    store-kv --> core
    store-kv --> utils
    sandbox --> vcs
    sandbox --> utils

    %% Engine layer dependencies
    vcs --> core
    vcs --> utils
    worktree --> core
    worktree --> utils

    %% Core layer dependencies
    core --> utils

    %% Development dependencies
    testing --> core
```

## Dependency Table

| Package | Dependencies |
|---------|-------------|
| `@webrun-vcs/commands` | core, transport, storage-git, utils |
| `@webrun-vcs/transport` | core, utils |
| `@webrun-vcs/staging` | core |
| `@webrun-vcs/storage-git` | core, vcs, worktree, utils |
| `@webrun-vcs/store-mem` | core, sandbox, utils |
| `@webrun-vcs/store-sql` | core, sandbox, utils |
| `@webrun-vcs/store-kv` | core, utils |
| `@webrun-vcs/sandbox` | vcs, utils |
| `@webrun-vcs/vcs` | core, utils |
| `@webrun-vcs/worktree` | core, utils |
| `@webrun-vcs/core` | utils |
| `@webrun-vcs/utils` | pako (external) |
| `@webrun-vcs/testing` | core |

## Layer Descriptions

### Foundation Layer
**@webrun-vcs/utils** - Pure algorithmic implementations with no VCS-specific dependencies. Provides hashing, compression, and diff algorithms.

### Core Layer
**@webrun-vcs/core** - Defines the VCS contracts: store interfaces, object model, pack file format, and delta compression system.

### Engine Layer
**@webrun-vcs/vcs** - Delta storage engine with candidate selection and compression optimization.
**@webrun-vcs/worktree** - Platform-agnostic filesystem traversal with ignore pattern matching.

### Storage Layer
Multiple backends implementing core interfaces:
- **storage-git** - Native Git `.git/` directory structure
- **store-mem** - In-memory storage for testing
- **store-sql** - SQLite-based persistent storage
- **store-kv** - Generic key-value store adapter
- **sandbox** - Isolated storage for safe experimentation

### Protocol Layer
**@webrun-vcs/transport** - Git smart HTTP protocol (v1/v2), pack transfer, server handlers.
**@webrun-vcs/staging** - Git index format, merge conflict tracking.

### Command Layer
**@webrun-vcs/commands** - High-level operations (clone, fetch, push, commit) that compose lower layers.

## ASCII Diagram

For environments that don't render Mermaid:

```
                    ┌──────────────────┐
                    │    commands      │
                    │   (CLI/API)      │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐  ┌──────────────┐  ┌──────────────┐
│   transport     │  │  storage-git │  │   staging    │
│  (protocols)    │  │ (filesystem) │  │   (index)    │
└────────┬────────┘  └──────┬───────┘  └──────┬───────┘
         │                  │                 │
         │           ┌──────┴───────┐         │
         │           │              │         │
         │           ▼              ▼         │
         │    ┌───────────┐  ┌───────────┐    │
         │    │  worktree │  │    vcs    │    │
         │    │  (files)  │  │  (engine) │    │
         │    └─────┬─────┘  └─────┬─────┘    │
         │          │              │          │
         └──────────┼──────────────┼──────────┘
                    │              │
                    ▼              ▼
              ┌───────────────────────┐
              │         core          │
              │ (interfaces, formats) │
              └───────────┬───────────┘
                          │
                          ▼
                    ┌───────────┐
                    │   utils   │
                    │(algorithms)│
                    └───────────┘
```
