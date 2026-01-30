# Brainstorming Session Results

**Session Date:** 2026-01-30
**Facilitator:** Business Analyst Mary
**Participant:** Mikhail Kotelnikov

---

## Executive Summary

**Topic:** Clean API Design for Isomorphic, Multi-Backend Version Control System

**Session Goals:**
1. Define clean API surface for developer-facing interfaces
2. Identify layer boundaries
3. Design for: isomorphic JS, multi-backend storage, git-compatible format/transport

**Key Themes Identified:**
- Multi-level API architecture (Porcelain → Core → Storage)
- Factory pattern for all major entry points
- Three-part store architecture (History + Checkout + Worktree)
- Interface-driven design for backend extensibility

---

## API Layers (Target Architecture)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PORCELAIN API                                    │
│  clone, commit, push, add, remove, merge, cherry-pick, rebase, etc.     │
│  User-oriented commands. Storage/transport agnostic.                     │
│  Entry: Git class (31 commands via fluent builder pattern)              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────────┐
│     REPOSITORY      │ │      CHECKOUT       │ │    WORKING DIRECTORY    │
│  History (blobs,    │ │  Current commit,    │ │  User's files           │
│  trees, commits,    │ │  staging, ongoing   │ │  (external to VCS)      │
│  tags) + config     │ │  ops (rebase, etc.) │ │                         │
└─────────────────────┘ └─────────────────────┘ └─────────────────────────┘
          │                         │                         │
          └─────────────────────────┼─────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          TRANSPORT LAYER                                 │
│  Git protocol v1/v2 (HTTP, wire/bidirectional streams)                  │
│  FSM-based state management, pkt-line codec, sideband                   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       STORE IMPLEMENTATIONS                              │
│  Files │ SQL │ KV │ Memory │ OPFS │ S3 │ ...                           │
│  + Storage-specific convenience APIs (e.g., SQL search by author)       │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Existing API Analysis (14 Packages)

### Package Overview

| Package | Purpose | Main Entry Point |
|---------|---------|------------------|
| **vcs-core** | Foundation layer | `createGitRepository()`, `StorageBackend` |
| **vcs-commands** | High-level Git ops | `Git` class (31 commands) |
| **vcs-transport** | Git protocol impl | `TransportApi`, FSM-based fetch/push |
| **vcs-utils** | Shared utilities | hash, compression, streams, diff |
| **vcs-store-mem** | Memory backend | `createMemoryObjectStores()` |
| **vcs-store-sql** | SQL backend | `createSQLStorage()` |
| **vcs-store-kv** | KV backend | `createStreamingStores()` |
| **vcs-transport-adapters** | Protocol adapters | `RepositoryAccess`, `RepositoryFacade` |
| **vcs-port-websocket** | WebSocket adapter | `createWebSocketPort()` |
| **vcs-port-webrtc** | WebRTC P2P | `PeerManager`, `createDataChannelPort()` |
| **vcs-port-peerjs** | PeerJS P2P | `createPeerJsPort()` |
| **vcs-utils-node** | Node.js optimizations | `createNodeFilesApi()` |
| **vcs-testing** | Test utilities | Test suites |
| **vcs-storage-tests** | Storage test suites | Parametrized tests |

### Core Architecture Patterns

#### 1. Three-API Backend Architecture
Every `StorageBackend` provides:
- **StructuredStores** — Typed access (BlobStore, TreeStore, CommitStore, TagStore, RefStore)
- **DeltaApi** — Blob delta operations for optimization
- **SerializationApi** — Git wire format I/O

#### 2. Three-Part Store Architecture (GitStoresConfig)
```typescript
interface GitStoresConfig {
  readonly history: HistoryStore;      // Immutable history
  readonly checkout?: CheckoutStore;   // Mutable state
  readonly worktree?: WorktreeStore;   // Filesystem access
}
```

#### 3. Factory Pattern (All Entry Points)
```typescript
// Core
createGitRepository(options)
createMemoryObjectStores(options)
createSQLStorage(db)
createStreamingStores(kvStore)

// Commands
Git.wrap(store)
Git.fromRepository(options)
Git.fromStores(config)

// Transport
createTransportApi(duplex)
createRepositoryFacade(stores)
```

#### 4. Fluent Command Pattern
```typescript
await git.commit()
  .setMessage("message")
  .setAuthor("name", "email")
  .call();
```

### Key Interfaces

| Interface | Package | Purpose |
|-----------|---------|---------|
| `StorageBackend` | core | Unified storage interface |
| `HistoryStore` | core | Immutable history (commits, trees, blobs, refs) |
| `CheckoutStore` | core | Mutable state (HEAD, staging) |
| `WorktreeStore` | core | Filesystem traversal |
| `GitStore` | commands | Aggregate for commands |
| `TransportApi` | transport | Pkt-line I/O |
| `RepositoryAccess` | transport-adapters | Git object access |
| `FilesApi` | core | Abstract filesystem |

### Command Coverage (31 Commands)

**Repository:** init, clone
**Working Tree:** add, rm, status, checkout, clean
**History:** commit, log, diff, blame
**Branching:** branchCreate, branchDelete, branchList, branchRename, merge, cherryPick, rebase, revert
**Tags:** tag, tagDelete, tagList
**Remote:** fetch, push, pull, lsRemote, remoteAdd, remoteList, remoteRemove, remoteSetUrl
**Advanced:** gc, packRefs, stash*, reflog, describe

---

## Identified Gaps / Areas for Design

### 1. Configuration Entry Point
Current: Multiple factory functions scattered across packages
Target: Unified `createGit(config)` with storage/transport specification

### 2. Missing Core Interfaces (from interfaces.ts)
- `ReflogStore` — Reference history tracking
- `RemoteStore` — Remote configuration management
- `RepositoryConfiguration` — Config key-value storage
- `WorktreeConfiguration` — Worktree-specific config
- `HeadStore` — Extracted from RefStore

### 3. Checkout State Management
Current: Readers for merge/rebase/cherry-pick state
Target: Full stores with read/write/clear operations

### 4. Storage-Specific Extensions
Design pattern for backends to expose additional capabilities (e.g., SQL queries)

---

## Use Cases

| Use Case | Entry Point | API Level |
|----------|-------------|-----------|
| Git replacement in browser | `createGit()` + Porcelain | Full stack |
| Embedded versioning for editors | Core + Store impl | Mid-level |
| AI persistent versioned memory | Core (simplified) | Low-level |
| Chat history with branches | Core (commits/refs only) | Low-level |
| Custom transport implementation | Transport layer | Low-level |

---

## Next Steps

1. Define `createGit(config)` specification
2. Resolve interface gaps (ReflogStore, RemoteStore, etc.)
3. Design storage-specific extension pattern
4. Document layer boundaries precisely

---

*Session facilitated using the BMAD-METHOD brainstorming framework*
