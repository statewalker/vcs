# Transport and Commands Migration to Core

This plan outlines the migration of `packages/transport` and `packages/commands` to use `@webrun-vcs/core` exclusively.

## Current Architecture

### Package Dependencies

```
packages/commands
├── @webrun-vcs/core
├── @webrun-vcs/transport
├── @webrun-vcs/utils
└── @webrun-vcs/worktree

packages/transport
├── @webrun-vcs/core
└── @webrun-vcs/utils
```

### Target Architecture

```
packages/commands
└── @webrun-vcs/core (only)

packages/transport
└── @webrun-vcs/core (only)
```

---

## Package Analysis

### packages/transport Structure

| Module | Files | Purpose |
|--------|-------|---------|
| protocol/ | 9 | Git protocol primitives (pkt-line, capabilities, ack-nak, sideband) |
| streams/ | 5 | Stream handling (git-stream, pack-receiver, progress-reporter) |
| connection/ | 5 | Connection management (http, git, factory) |
| storage-adapters/ | 4 | Repository abstraction layer |
| operations/ | 4 | High-level operations (clone, fetch, push) |
| negotiation/ | 6 | Protocol negotiation (fetch, push, refspec, uri) |
| http-server/ | 3 | HTTP smart protocol server |
| handlers/ | 7 | Request handlers (upload-pack, receive-pack, protocol-v2) |

### packages/commands Structure

| Module | Files | Purpose |
|--------|-------|---------|
| commands/ | 20+ | Git command implementations |
| results/ | 13 | Command result types |
| errors/ | 12 | Error type definitions |

---

## Migration Strategy

### Decision: Keep Transport Separate or Merge into Core?

**Option A: Keep packages/transport as thin wrapper**
- Transport remains separate package
- Only depends on core interfaces
- Contains connection/network-specific code
- Core contains protocol primitives

**Option B: Merge transport into core**
- All transport code moves to packages/core/src/transport/
- Single package for all Git functionality
- Simpler dependency graph

**Recommendation**: Option A - Keep transport separate but thin. Network/HTTP code shouldn't be in core.

---

## Phase 1: Core Protocol Foundation

Before migrating transport, ensure core has necessary protocol primitives.

### 1.1 Move Protocol Types to Core

Create `packages/core/src/protocol/` with:

```
packages/core/src/protocol/
├── index.ts
├── types.ts          # Protocol type definitions
├── constants.ts      # Protocol constants (FLUSH_PKT, etc.)
├── pkt-line.ts       # Pkt-line encoding/decoding
├── capabilities.ts   # Capability parsing
└── errors.ts         # Protocol errors
```

**Files to migrate from transport:**
- `packages/transport/src/protocol/types.ts` → core
- `packages/transport/src/protocol/constants.ts` → core
- `packages/transport/src/protocol/pkt-line-codec.ts` → core
- `packages/transport/src/protocol/capabilities.ts` → core
- `packages/transport/src/protocol/errors.ts` → core

### 1.2 Add Sideband and ACK/NAK to Core

```
packages/core/src/protocol/
├── ack-nak.ts        # ACK/NAK message handling
├── sideband.ts       # Sideband demultiplexing
└── report-status.ts  # Push status parsing
```

### 1.3 Update Core Exports

Update `packages/core/src/index.ts`:
```typescript
export * from "./protocol/index.js";
```

---

## Phase 2: Repository Adapter Interface

### 2.1 Define Repository Interface in Core

Create `packages/core/src/repository/` with unified repository interface:

```typescript
// packages/core/src/repository/types.ts
export interface Repository {
  // Object access
  readonly objects: RawStoreWithDelta;
  readonly blobs: BlobStore;
  readonly trees: TreeStore;
  readonly commits: CommitStore;
  readonly tags: TagStore;

  // Reference management
  readonly refs: RefStore;

  // Configuration
  readonly config: ConfigStore;

  // Operations
  close(): Promise<void>;
}

export interface RepositoryOptions {
  bare?: boolean;
  shallowSince?: Date;
  shallowExclude?: string[];
}
```

### 2.2 Migrate Storage Adapters

Refactor transport storage adapters to implement core Repository interface:

```
packages/transport/src/storage-adapters/
├── storage-adapter.ts      → Use core Repository interface
├── repository-adapter.ts   → Thin wrapper around Repository
└── vcs-repository-adapter.ts → Concrete implementation
```

---

## Phase 3: Transport Module Refactoring

### 3.1 Update Protocol Imports

Replace all `@webrun-vcs/utils` imports with core:

```typescript
// Before
import { PktLineCodec } from "@webrun-vcs/utils";

// After
import { PktLineCodec } from "@webrun-vcs/core/protocol";
```

### 3.2 Refactor Streams Module

Update streams to use core types:

| File | Changes |
|------|---------|
| git-stream.ts | Use core pkt-line codec |
| pack-receiver.ts | Use core PackReader, PackIndexer |
| progress-reporter.ts | Use core progress interfaces |
| protocol-session.ts | Use core protocol types |

### 3.3 Refactor Handlers Module

Update handlers to use core stores:

| File | Core Dependencies |
|------|-------------------|
| upload-pack-handler.ts | CommitStore, RefStore, PackWriter |
| receive-pack-handler.ts | RefStore, PackIndexer, RawStore |
| protocol-v2-handler.ts | Protocol types, capabilities |
| negotiation-state.ts | CommitStore for ancestry |
| shallow-negotiation.ts | CommitStore for depth limiting |

### 3.4 Refactor Operations Module

Update operations to use core interfaces:

| File | Core Dependencies |
|------|-------------------|
| clone.ts | Repository, RefStore, PackIndexer |
| fetch.ts | Repository, RefStore, PackReceiver |
| push.ts | Repository, RefStore, PackWriter |

### 3.5 Refactor Negotiation Module

| File | Core Dependencies |
|------|-------------------|
| fetch-negotiator.ts | CommitStore, RefStore |
| push-negotiator.ts | RefStore, protocol types |
| ref-advertiser.ts | RefStore |
| refspec.ts | Pure logic, no dependencies |
| uri.ts | Pure logic, no dependencies |

---

## Phase 4: Worktree Consolidation

### 4.1 Analyze Current Worktree Package

```
packages/worktree/src/
├── index.ts
├── working-tree-iterator.ts
└── ... (analyze for complete list)
```

### 4.2 Core Already Has Worktree

Check `packages/core/src/worktree/`:
- working-tree-iterator.ts (exists)
- working-tree-iterator.impl.ts (exists)

### 4.3 Migration Decision

If core worktree is complete:
- Update commands to import from core
- Deprecate packages/worktree

If core worktree is incomplete:
- Move missing functionality to core
- Then deprecate packages/worktree

---

## Phase 5: Commands Package Refactoring

### 5.1 Dependency Audit

For each command file, identify imports:

| Command | Transport Deps | Utils Deps | Worktree Deps |
|---------|---------------|------------|---------------|
| clone-command.ts | operations/clone | ? | ? |
| fetch-command.ts | operations/fetch | ? | ? |
| push-command.ts | operations/push | ? | ? |
| ... | ... | ... | ... |

### 5.2 Update Transport Commands

Commands that use transport operations:
- clone-command.ts
- fetch-command.ts
- push-command.ts
- pull-command.ts
- ls-remote-command.ts
- remote-command.ts

Update to use core interfaces (transport still provides operations).

### 5.3 Update Local Commands

Commands that don't need transport:
- commit-command.ts → core stores
- merge-command.ts → core stores
- rebase-command.ts → core stores
- checkout-command.ts → core stores + worktree
- branch-command.ts → core RefStore
- tag-command.ts → core TagStore
- add-command.ts → core staging
- rm-command.ts → core staging
- status-command.ts → core staging + worktree
- diff-command.ts → core diff utilities
- log-command.ts → core CommitStore
- stash-*.ts → core stores
- cherry-pick-command.ts → core stores
- revert-command.ts → core stores
- reset-command.ts → core stores
- describe-command.ts → core stores

### 5.4 Update Result Types

Ensure result types use core ObjectId, Ref types:

```typescript
// Before
import { ObjectId } from "@webrun-vcs/utils";

// After
import { ObjectId } from "@webrun-vcs/core";
```

### 5.5 Update Error Types

Consolidate with core errors or keep command-specific.

---

## Phase 6: Test Migration

### 6.1 Transport Tests

Tests previously in core (now deleted per git status):

```
packages/core/tests/transport/
├── ack-nak.test.ts
├── capabilities.test.ts
├── git-http-server.test.ts
├── git-stream.test.ts
├── malformed-input.test.ts
├── negotiation-state.test.ts
├── object-filtering.test.ts
├── pkt-line-codec.test.ts
├── progress-reporter.test.ts
├── protocol-session.test.ts
├── protocol-v2-handler.test.ts
├── receive-pack-handler.test.ts
├── ref-advertiser.test.ts
├── refspec.test.ts
├── shallow-negotiation.test.ts
├── sideband.test.ts
├── storage-adapter.test.ts
├── tag-chain-handling.test.ts
├── unicode-ref-names.test.ts
├── upload-pack-handler.test.ts
├── uri.test.ts
└── vcs-repository-adapter.test.ts
```

### 6.2 Test Location Strategy

**Protocol tests** → `packages/core/tests/protocol/`
- pkt-line-codec.test.ts
- capabilities.test.ts
- ack-nak.test.ts
- sideband.test.ts

**Transport tests** → `packages/transport/tests/`
- Keep handler, operation, stream tests in transport
- Update to use core protocol types

---

## Implementation Order

### Dependency Graph

```
┌─────────────────────────────────────────────────────────┐
│                     Phase 1                              │
│  Core Protocol Foundation                                │
│  ├── 1.1 Move protocol types                            │
│  ├── 1.2 Add sideband/ack-nak                           │
│  └── 1.3 Update exports                                 │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Phase 2                              │
│  Repository Interface                                    │
│  ├── 2.1 Define Repository interface                    │
│  └── 2.2 Migrate storage adapters                       │
└─────────────────────────────────────────────────────────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
┌─────────────────────────┐  ┌─────────────────────────┐
│       Phase 3           │  │       Phase 4           │
│  Transport Refactoring  │  │  Worktree Consolidation │
│  ├── 3.1 Protocol       │  │  ├── 4.1 Analyze        │
│  ├── 3.2 Streams        │  │  ├── 4.2 Check core     │
│  ├── 3.3 Handlers       │  │  └── 4.3 Migrate        │
│  ├── 3.4 Operations     │  │                         │
│  └── 3.5 Negotiation    │  │                         │
└─────────────────────────┘  └─────────────────────────┘
              │                         │
              └────────────┬────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Phase 5                              │
│  Commands Refactoring                                    │
│  ├── 5.1 Dependency audit                               │
│  ├── 5.2 Transport commands                             │
│  ├── 5.3 Local commands                                 │
│  ├── 5.4 Result types                                   │
│  └── 5.5 Error types                                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                     Phase 6                              │
│  Test Migration                                          │
│  ├── 6.1 Protocol tests to core                         │
│  └── 6.2 Transport tests remain in transport            │
└─────────────────────────────────────────────────────────┘
```

---

## Detailed Task Breakdown

### Phase 1 Tasks

| Task | Description | Est. Effort |
|------|-------------|-------------|
| 1.1.1 | Create `packages/core/src/protocol/` directory structure | Small |
| 1.1.2 | Move `types.ts` from transport to core | Small |
| 1.1.3 | Move `constants.ts` from transport to core | Small |
| 1.1.4 | Move `pkt-line-codec.ts` to core, update imports | Medium |
| 1.1.5 | Move `capabilities.ts` to core | Small |
| 1.1.6 | Move `errors.ts` to core | Small |
| 1.2.1 | Move `ack-nak.ts` to core | Small |
| 1.2.2 | Move `sideband.ts` to core | Small |
| 1.2.3 | Move `report-status.ts` to core | Small |
| 1.3.1 | Create `packages/core/src/protocol/index.ts` | Small |
| 1.3.2 | Update `packages/core/src/index.ts` exports | Small |
| 1.3.3 | Update transport to import from core | Medium |

### Phase 2 Tasks

| Task | Description | Est. Effort |
|------|-------------|-------------|
| 2.1.1 | Define `Repository` interface in core | Medium |
| 2.1.2 | Define `RepositoryOptions` interface | Small |
| 2.1.3 | Define `ConfigStore` interface if needed | Small |
| 2.2.1 | Update `storage-adapter.ts` to use core Repository | Medium |
| 2.2.2 | Update `repository-adapter.ts` | Medium |
| 2.2.3 | Update `vcs-repository-adapter.ts` | Medium |
| 2.2.4 | Remove utils dependencies from adapters | Small |

### Phase 3 Tasks

| Task | Description | Est. Effort |
|------|-------------|-------------|
| 3.1.1 | Update all protocol imports in transport | Medium |
| 3.2.1 | Update `git-stream.ts` | Medium |
| 3.2.2 | Update `pack-receiver.ts` | Medium |
| 3.2.3 | Update `progress-reporter.ts` | Small |
| 3.2.4 | Update `protocol-session.ts` | Medium |
| 3.3.1 | Update `upload-pack-handler.ts` | Large |
| 3.3.2 | Update `receive-pack-handler.ts` | Large |
| 3.3.3 | Update `protocol-v2-handler.ts` | Medium |
| 3.3.4 | Update `negotiation-state.ts` | Medium |
| 3.3.5 | Update `shallow-negotiation.ts` | Medium |
| 3.4.1 | Update `clone.ts` | Medium |
| 3.4.2 | Update `fetch.ts` | Medium |
| 3.4.3 | Update `push.ts` | Medium |
| 3.5.1 | Update negotiation module | Medium |

### Phase 4 Tasks

| Task | Description | Est. Effort |
|------|-------------|-------------|
| 4.1.1 | Analyze `packages/worktree` contents | Small |
| 4.2.1 | Compare with `packages/core/src/worktree` | Small |
| 4.3.1 | Move missing functionality to core | Medium |
| 4.3.2 | Update worktree imports across monorepo | Medium |
| 4.3.3 | Deprecate `packages/worktree` | Small |

### Phase 5 Tasks

| Task | Description | Est. Effort |
|------|-------------|-------------|
| 5.1.1 | Audit all command imports | Medium |
| 5.2.1 | Update clone-command.ts | Medium |
| 5.2.2 | Update fetch-command.ts | Medium |
| 5.2.3 | Update push-command.ts | Medium |
| 5.2.4 | Update pull-command.ts | Medium |
| 5.2.5 | Update ls-remote-command.ts | Small |
| 5.2.6 | Update remote-command.ts | Small |
| 5.3.x | Update each local command (15+) | Large |
| 5.4.1 | Update result type imports | Medium |
| 5.5.1 | Consolidate error types | Medium |
| 5.6.1 | Update package.json dependencies | Small |

### Phase 6 Tasks

| Task | Description | Est. Effort |
|------|-------------|-------------|
| 6.1.1 | Create `packages/core/tests/protocol/` | Small |
| 6.1.2 | Migrate protocol tests to core | Medium |
| 6.2.1 | Update transport tests for core imports | Medium |
| 6.2.2 | Verify all tests pass | Medium |

---

## Success Criteria

1. **Transport package.json** shows only `@webrun-vcs/core` dependency
2. **Commands package.json** shows only `@webrun-vcs/core` dependency
3. **No circular dependencies** detected by tooling
4. **All existing tests pass**
5. **No `@webrun-vcs/utils` imports** in transport or commands
6. **No `@webrun-vcs/worktree` imports** in commands
7. **Clean separation**: Core has types/interfaces, transport has network code

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes in core interfaces | High | Add tests before migration, use deprecation warnings |
| Missing functionality in core | Medium | Audit thoroughly before removing dependencies |
| Test coverage gaps | Medium | Migrate tests alongside code |
| Build/bundle size increase | Low | Monitor bundle sizes, use tree-shaking |

---

## Open Questions

1. **Should connection module stay in transport or move to core?**
   - HTTP/git protocol connections seem transport-specific
   - Recommendation: Keep in transport

2. **Should negotiation module move to core?**
   - It's protocol logic, could be in core
   - Recommendation: Keep in transport, uses core protocol types

3. **What happens to packages/vcs?**
   - Analyze its relationship to commands
   - May need similar migration

4. **How to handle @webrun-vcs/utils?**
   - Some utilities may need to move to core
   - Or utils becomes a leaf dependency of core

---

## References

- [Notes: Core Store Architecture](../notes/src/2025-12-25/01-[vcs-refactoring]-core-store-architecture.md)
- [Plan: Missing Unit Tests](./01-[vcs-refactoring]-missing-unit-tests-implementation.md)
- Git Protocol Documentation: https://git-scm.com/docs/protocol-v2
