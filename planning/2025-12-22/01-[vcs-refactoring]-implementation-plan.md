# WebRun VCS Package Implementation Plan

This document provides detailed implementation planning for 6 packages in the VCS refactoring. After validation, these will be transformed into bd issues.

## Overview

The migration restructures the codebase from scattered responsibilities into a clean layered architecture. This plan covers:

1. **@webrun-vcs/core** - Central API Layer (interfaces + formats)
2. **@webrun-vcs/storage-git** - Git File Backend (FilesApi-based, no native APIs)
3. **@webrun-vcs/staging** - Staging Area Implementation
4. **@webrun-vcs/worktree** - Working Tree Operations
5. **@webrun-vcs/transport** - Protocol Layer
6. **@webrun-vcs/commands** - Porcelain Layer

**Key Constraint**: storage-git must use only FilesApi abstraction - no native/Node.js APIs.

**Reference**: JGit at `tmp/jgit/org.eclipse.jgit` provides reference implementations and test cases.

**Backwards Compatibility**: No backwards compatibility required - clean break from old package names.

**Phased Approach**: This plan focuses on Phase 1 - clean architecture with one storage backend (storage-git). Low-level abstractions (ObjectStore, RawStore, DeltaStore, BinStore, TempStore) remain internal to storage-git. These will be extracted to a shared storage-common package in Phase 2 when adding additional backends (mem, sql, kv).

**Streaming API Preference**: All interfaces should prefer streaming APIs (`AsyncIterable<Uint8Array>`) over accumulating binary chunks in memory. Use stream utilities from `@webrun-vcs/utils` (migrated from `vcs/src/format/stream-utils.ts`) for:
- `splitStream()` - Split streams at delimiter boundaries
- `readHeader()` - Read headers without buffering entire content
- `mapStream()` - Transform stream items
- `collect()` - Use sparingly, only when streaming is impossible

---

## Pre-Migration: Stream Utilities to @webrun-vcs/utils

Before migrating core, stream utilities must move to utils package.

### Source Migration

| Source | Target | Content |
|--------|--------|---------|
| `vcs/src/format/stream-utils.ts` | `utils/src/streams/` | Stream utilities |

### Stream Utilities to Migrate

```
packages/utils/src/streams/
├── concat.ts                 # Uint8Array concatenation
├── async-iterable.ts         # isAsyncIterable, asAsyncIterable
├── collect.ts                # toArray, collect (use sparingly!)
├── encoding.ts               # encodeString, decodeString
├── map-stream.ts             # mapStream transform
├── to-lines.ts               # Stream to lines conversion
├── split-stream.ts           # splitStream, newSplitter, newByteSplitter
├── read-header.ts            # readHeader, readAhead, readBlock
└── index.ts
```

### Tests Required

| Test | Purpose |
|------|---------|
| `concat.test.ts` | Array concatenation |
| `split-stream.test.ts` | Stream splitting at delimiters |
| `read-header.test.ts` | Header extraction from streams |
| `to-lines.test.ts` | Line parsing from byte streams |

---

## Package 1: @webrun-vcs/core (Central API Layer)

### Purpose
Single source of truth for all public interfaces and Git-compatible serialization formats. All backends implement these interfaces.

### Source Migration Map

| Source Location | Target Location | Content |
|-----------------|-----------------|---------|
| `vcs/src/object-storage/interfaces/types.ts` | `core/src/types/` | ObjectId, FileMode, PersonIdent, ObjectType |
| `vcs/src/object-storage/interfaces/blob-store.ts` | `core/src/stores/` | BlobStore interface |
| `vcs/src/object-storage/interfaces/tree-store.ts` | `core/src/stores/` | TreeStore, TreeEntry |
| `vcs/src/object-storage/interfaces/commit-store.ts` | `core/src/stores/` | CommitStore, Commit |
| `vcs/src/object-storage/interfaces/tag-store.ts` | `core/src/stores/` | TagStore, AnnotatedTag |
| `vcs/src/object-storage/interfaces/ref-store.ts` | `core/src/stores/` | RefStore, Ref, SymbolicRef |
| `vcs/src/interfaces/staging-store.ts` | `core/src/staging/` | StagingStore, StagingEntry |
| `vcs/src/interfaces/staging-edits.ts` | `core/src/staging/` | StagingEdit implementations |
| `vcs/src/format/*` | `core/src/format/` | Git object format serialization |
| `vcs/src/interfaces/utils/tree-utils.ts` | `core/src/utils/` | Tree manipulation helpers |

### Target Directory Structure

```
packages/core/src/
├── types/
│   ├── object-id.ts              # ObjectId type (SHA-1 hex string)
│   ├── object-types.ts           # BLOB, TREE, COMMIT, TAG enum
│   ├── file-mode.ts              # 100644, 100755, 040000, etc.
│   ├── tree-entry.ts             # { mode, name, id }
│   ├── person-ident.ts           # Author/committer identity
│   └── index.ts
│
├── stores/
│   ├── blob-store.ts             # Binary content storage
│   ├── tree-store.ts             # Directory snapshots
│   ├── commit-store.ts           # Commits with ancestry
│   ├── tag-store.ts              # Annotated tags
│   ├── ref-store.ts              # Branch/tag refs
│   ├── repository.ts             # Composite: all stores + metadata
│   └── index.ts
│
├── staging/
│   ├── staging-store.ts          # Git index abstraction
│   ├── staging-entry.ts          # Entry with conflict stages
│   ├── staging-edits.ts          # Edit operation classes
│   └── index.ts
│
├── format/
│   ├── blob-format.ts            # Blob serialization (trivial prefix)
│   ├── tree-format.ts            # Binary tree format
│   ├── commit-format.ts          # Text commit format
│   ├── tag-format.ts             # Text tag format
│   ├── object-header.ts          # "type size\0" prefix
│   ├── person-ident-format.ts    # Author/committer parsing
│   └── index.ts
│
├── utils/
│   ├── tree-utils.ts             # collectTreeEntries, sortTreeEntries, etc.
│   └── index.ts
│
└── index.ts                      # Main exports
```

### Implementation Tasks

1. **Create package structure**
   - Initialize `packages/core/` with package.json, tsconfig.json
   - Set up build configuration (rolldown)
   - Configure exports in package.json

2. **Migrate types (no dependencies)**
   - Move ObjectId, ObjectType, FileMode, PersonIdent
   - Ensure all constants are properly exported

3. **Migrate store interfaces**
   - BlobStore, TreeStore, CommitStore, TagStore, RefStore
   - Repository composite interface
   - Staging interfaces (StagingStore, StagingEntry, StagingEdits)

4. **Migrate format serializers**
   - Object header parsing
   - PersonIdent parsing/formatting
   - Commit, Tree, Tag, Blob format handlers

5. **Migrate utility functions**
   - tree-utils.ts helpers

6. **Remove vcs package exports**
   - No backwards compatibility - clean break
   - Delete deprecated interfaces after migration

### Test Migration

| Source Test | Target Test |
|-------------|-------------|
| `vcs/tests/format/*.test.ts` | `core/tests/format/` |
| `vcs/tests/object-storage/*.test.ts` | `core/tests/stores/` |

### JGit References

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `lib/ObjectId.java` | 20-byte SHA-1 hash | `types/object-id.ts` |
| `lib/FileMode.java` | File mode constants | `types/file-mode.ts` |
| `lib/PersonIdent.java` | Author identity | `types/person-ident.ts` |
| `lib/Constants.java` | Object type constants | `types/object-types.ts` |
| `lib/Repository.java` | Repository abstraction | `stores/repository.ts` |

---

## Package 2: @webrun-vcs/storage-git (Git File Backend)

### Purpose
Complete Git-compatible file storage with loose objects, pack files, refs, and GC. Uses only FilesApi abstraction - no native Node.js APIs.

### Critical Constraint: FilesApi Only

The storage-git package MUST:
- Accept `FilesApi` instance in constructor/factory
- Never import Node.js `fs`, `path`, or other native modules
- Work with `MemFilesApi` for testing
- Work with `NodeFilesApi` for production
- Support any custom `IFilesApi` implementation

### Source Migration Map

| Source Location | Target Location | Content |
|-----------------|-----------------|---------|
| `store-files/src/git-storage.ts` | `storage-git/src/` | Main factory |
| `store-files/src/git-*.ts` | `storage-git/src/objects/` | Object stores |
| `store-files/src/attik.loose/` | `storage-git/src/loose/` | Loose object handling |
| `store-files/src/pack/` | `storage-git/src/pack/` | Pack file handling |
| `store-files/src/refs/` | `storage-git/src/refs/` | Ref file handling |
| `store-files/src/staging/` | `staging/src/file/` | Moves to staging package |
| `store-files/src/worktree/` | `storage-git/src/worktree/` | Checkout to filesystem |
| `store-files/src/format/` | Stays in core | Git formats (shared) |
| `vcs/src/delta-compression/` | `storage-git/src/delta/` | Delta compression |
| `vcs/src/garbage-collection/` | `storage-git/src/gc/` | GC algorithms |

### Target Directory Structure

```
packages/storage-git/src/
├── git-repository.ts             # Main Repository implementation
├── create-git-storage.ts         # Factory: (files: FilesApi) => Repository
│
├── objects/
│   ├── loose-storage.ts          # .git/objects/xx/yy... files
│   ├── pack-storage.ts           # .git/objects/pack/*.pack
│   ├── object-database.ts        # Combines loose + pack lookup
│   └── index.ts
│
├── loose/
│   ├── loose-object-reader.ts    # Read .git/objects/xx/yy
│   ├── loose-object-writer.ts    # Write loose objects (atomic)
│   └── index.ts
│
├── pack/
│   ├── pack-reader.ts            # Read .pack files
│   ├── pack-writer.ts            # Write .pack files
│   ├── pack-index-reader.ts      # Read .idx files
│   ├── pack-index-writer.ts      # Write .idx files
│   ├── pack-indexer.ts           # Index pack on receive
│   ├── pack-entries-parser.ts    # Parse pack entries
│   ├── delta-resolver.ts         # Resolve delta chains
│   ├── types.ts                  # Pack-specific types
│   └── index.ts
│
├── delta/
│   ├── delta-storage-impl.ts     # Delta relationship storage
│   ├── resolve-delta-chain.ts    # Chain resolution
│   ├── strategies/
│   │   ├── commit-window-candidate.ts
│   │   ├── similar-size-candidate.ts
│   │   ├── rolling-hash-compute.ts
│   │   └── index.ts
│   └── index.ts
│
├── refs/
│   ├── ref-directory.ts          # .git/refs/ handling
│   ├── packed-refs-reader.ts     # .git/packed-refs parsing
│   ├── packed-refs-writer.ts     # packed-refs writing
│   ├── ref-reader.ts             # Read individual refs
│   ├── ref-writer.ts             # Write refs (atomic)
│   └── index.ts
│
├── gc/
│   ├── gc-controller.ts          # Orchestrates GC
│   ├── storage-analyzer.ts       # Find unreachable objects
│   ├── packing-orchestrator.ts   # Repack loose → pack
│   └── index.ts
│
├── worktree/
│   ├── checkout-command.ts       # Materialize tree to working dir
│   ├── file-tree-iterator.ts     # Iterate working directory
│   └── index.ts
│
├── utils/
│   ├── file-utils.ts             # FilesApi helpers (atomic write, etc.)
│   ├── varint.ts                 # Variable-length integers
│   └── index.ts
│
└── index.ts
```

### Implementation Tasks

1. **Rename package**
   - `store-files` → `storage-git`
   - Update package.json name to `@webrun-vcs/storage-git`
   - Update all workspace references

2. **Consolidate delta compression**
   - Move `vcs/src/delta-compression/` → `storage-git/src/delta/`
   - This is Git-specific optimization

3. **Consolidate garbage collection**
   - Move `vcs/src/garbage-collection/` → `storage-git/src/gc/`
   - GC is storage-specific

4. **Reorganize internal structure**
   - `attik.loose/` → `loose/`
   - Ensure consistent naming

5. **Implement Repository interface**
   - Create `git-repository.ts` implementing core's Repository
   - Factory function accepting FilesApi

6. **Verify FilesApi-only usage**
   - Audit all file operations
   - Replace any direct fs calls with FilesApi
   - Ensure MemFilesApi compatibility

7. **Update imports to use core**
   - All interfaces from `@webrun-vcs/core`
   - Remove vcs interface imports

### Test Migration

| Source Test | Target Test |
|-------------|-------------|
| `store-files/tests/pack/*.test.ts` | `storage-git/tests/pack/` |
| `store-files/tests/refs/*.test.ts` | `storage-git/tests/refs/` |
| `store-files/tests/staging/*.test.ts` | `storage-git/tests/staging/` |
| `store-files/tests/attik.loose/*.test.ts` | `storage-git/tests/loose/` |
| `store-files/tests/format/*.test.ts` | `storage-git/tests/format/` |
| `vcs/tests/delta-compression/*.test.ts` | `storage-git/tests/delta/` |
| `vcs/tests/garbage-collection/*.test.ts` | `storage-git/tests/gc/` |

### JGit References

**Repository & Object Database:**

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `internal/storage/file/FileRepository.java` | File-based repo | `git-repository.ts` |
| `internal/storage/file/FileObjectDatabase.java` | Object database | `objects/object-database.ts` |
| `internal/storage/file/ObjectDirectory.java` | Loose + pack lookup | `objects/object-database.ts` |
| `internal/storage/file/RefDirectory.java` | Ref files | `refs/ref-directory.ts` |

**Pack File Reading:**

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `internal/storage/file/Pack.java` | Pack file reader | `pack/pack-reader.ts` |
| `internal/storage/file/PackIndex.java` | Pack index reader | `pack/pack-index-reader.ts` |
| `internal/storage/file/PackIndexV1.java` | Index version 1 | `pack/pack-index-reader.ts` |
| `internal/storage/file/PackIndexV2.java` | Index version 2 | `pack/pack-index-reader.ts` |
| `internal/storage/pack/PackParser.java` | Parse incoming pack | `pack/pack-entries-parser.ts` |
| `internal/storage/pack/PackOutputStream.java` | Pack output stream | `pack/pack-writer.ts` |

**Pack File Writing & Indexing:**

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `internal/storage/pack/PackWriter.java` | Create pack files | `pack/pack-writer.ts` |
| `internal/storage/pack/PackIndexWriter.java` | Write .idx files | `pack/pack-index-writer.ts` |
| `internal/storage/pack/PackIndexWriterV2.java` | Index v2 format | `pack/pack-index-writer.ts` |
| `transport/PackedObjectInfo.java` | Object info for indexing | `pack/types.ts` |
| `lib/ObjectIdOwnerMap.java` | Efficient object ID storage | `pack/pack-indexer.ts` |

**Delta Compression Strategies:**

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `internal/storage/pack/DeltaEncoder.java` | Create delta instructions | `delta/delta-encoder.ts` |
| `internal/storage/pack/DeltaIndex.java` | Delta index for matching | `delta/delta-index.ts` |
| `internal/storage/pack/DeltaIndexScanner.java` | Scan for delta candidates | `delta/strategies/similar-size-candidate.ts` |
| `internal/storage/pack/DeltaWindow.java` | Window for delta search | `delta/strategies/commit-window-candidate.ts` |
| `internal/storage/pack/DeltaCache.java` | Cache computed deltas | `delta/delta-cache.ts` |
| `internal/storage/pack/ObjectToPack.java` | Object with delta info | `delta/object-to-pack.ts` |
| `internal/storage/pack/BinaryDelta.java` | Apply binary delta | `pack/delta-resolver.ts` |

**Garbage Collection:**

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `internal/storage/file/GC.java` | Main GC controller | `gc/gc-controller.ts` |
| `internal/storage/file/PackInserter.java` | Insert objects to pack | `gc/packing-orchestrator.ts` |
| `internal/storage/pack/PackStatistics.java` | Pack statistics | `gc/storage-analyzer.ts` |
| `revwalk/ObjectWalk.java` | Walk object graph | `gc/storage-analyzer.ts` |
| `lib/ObjectReader.java` | Read objects for GC | `gc/storage-analyzer.ts` |

**Loose Objects:**

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `internal/storage/file/LooseObjects.java` | Loose object store | `loose/loose-object-reader.ts` |
| `internal/storage/file/UnpackedObject.java` | Read loose object | `loose/loose-object-reader.ts` |
| `lib/ObjectInserter.java` | Write loose objects | `loose/loose-object-writer.ts` |

### JGit Test Cases to Port

**Basic Operations:**

| JGit Test | Purpose |
|-----------|---------|
| `T0003_BasicTest.java` | Basic repository operations |
| `ObjectDirectoryTest.java` | Object database operations |

**Pack Files:**

| JGit Test | Purpose |
|-----------|---------|
| `PackTest.java` | Pack file reading |
| `PackIndexTest.java` | Pack index operations |
| `PackWriterTest.java` | Pack file creation |
| `PackParserTest.java` | Pack stream parsing |
| `DeltaIndexTest.java` | Delta index creation |
| `BinaryDeltaTest.java` | Delta application |

**Garbage Collection:**

| JGit Test | Purpose |
|-----------|---------|
| `GCTest.java` | GC operations |
| `PackStatisticsTest.java` | Pack statistics |

**Refs:**

| JGit Test | Purpose |
|-----------|---------|
| `RefDirectoryTest.java` | Ref file handling |
| `PackedRefsTest.java` | Packed refs format |

---

## Package 3: @webrun-vcs/staging (Staging Area)

### Purpose
Staging area implementations providing both file-based (Git-compatible) and in-memory options. Uses FilesApi abstraction for file operations.

### Source Analysis

The staging interfaces are in `vcs/src/interfaces/`:
- `staging-store.ts` - Interface definitions
- `staging-edits.ts` - Edit operation classes

Existing implementations:
- `store-files/src/staging/` - File-based (Git index format)
- `store-mem/` - Memory-based

### Target Directory Structure

```
packages/staging/src/
├── file/
│   ├── file-staging-store.ts     # Git-compatible .git/index implementation
│   ├── index-format.ts           # Binary index format reader/writer
│   ├── index-entry.ts            # Index entry serialization
│   └── index.ts
│
├── memory/
│   ├── memory-staging-store.ts   # Pure in-memory implementation
│   └── index.ts
│
├── staging-builder.ts            # Bulk modification builder
├── staging-editor.ts             # Targeted edit operations
│
├── utils/
│   ├── conflict-utils.ts         # Conflict detection/resolution
│   ├── entry-utils.ts            # Entry manipulation helpers
│   └── index.ts
│
└── index.ts
```

### Implementation Tasks

1. **Create package structure**
   - Initialize `packages/staging/`
   - Configure dependencies on `@webrun-vcs/core`

2. **Implement file-based staging (Git-compatible)**
   - Uses FilesApi for file operations
   - Reads/writes Git index format (.git/index)
   - Supports index versions 2, 3, 4
   - Handles extensions (tree cache, resolve undo)

3. **Implement memory staging**
   - Pure in-memory StagingStore
   - For testing and temporary operations

4. **Implement StagingBuilder**
   - Bulk operations for performance
   - Batch add/remove/update

5. **Implement StagingEditor**
   - Targeted modifications
   - Conflict management

6. **Create conflict utilities**
   - Detect conflicts (same path, different stages)
   - Resolution helpers

7. **Integrate with TreeStore**
   - Generate tree from staged entries
   - Maintain canonical ordering

### Test Migration

| Source Test | Target Test |
|-------------|-------------|
| `store-files/tests/staging/*.test.ts` | `staging/tests/file/` |
| Tests from `testing/src/suites/staging-store.test.ts` | `staging/tests/` |
| Memory staging tests from store-mem | `staging/tests/memory/` |

### JGit References

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `dircache/DirCache.java` | Main staging abstraction | `file/file-staging-store.ts` |
| `dircache/DirCacheBuilder.java` | Bulk builder | `staging-builder.ts` |
| `dircache/DirCacheEditor.java` | Targeted edits | `staging-editor.ts` |
| `dircache/DirCacheEntry.java` | Entry structure | `file/index-entry.ts` |

### JGit Test Cases to Port

| JGit Test | Purpose |
|-----------|---------|
| `DirCacheBasicTest.java` | Basic index operations |
| `DirCacheCGitCompatabilityTest.java` | C Git compatibility |
| `DirCacheBuilderTest.java` | Builder operations |
| `DirCacheEntryTest.java` | Entry serialization |

---

## Package 4: @webrun-vcs/worktree (Working Tree)

### Purpose
Working tree operations including status calculation, add command, and .gitignore handling.

### Current State

Already exists at `packages/worktree/` with:
- `add-command.ts` - Stage files for commit
- `status-calculator.ts` - Calculate working tree status
- `ignore/` - Gitignore pattern handling

### Target Directory Structure

```
packages/worktree/src/
├── status-calculator.ts          # HEAD vs Index vs WorkTree
├── add-command.ts                # git add implementation
│
├── ignore/
│   ├── ignore-manager.ts         # Manages ignore patterns
│   ├── ignore-rules.ts           # Pattern matching
│   ├── gitignore-parser.ts       # Parse .gitignore files
│   ├── ignore-node-tree.ts       # Tree of ignore patterns
│   └── index.ts
│
├── interfaces/
│   ├── status.ts                 # Status result types
│   ├── working-tree-iterator.ts  # WorkingTreeIterator interface
│   └── index.ts
│
├── utils/
│   ├── path-utils.ts             # Path manipulation
│   └── index.ts
│
└── index.ts
```

### Implementation Tasks

1. **Update imports to use core**
   - Replace `@webrun-vcs/vcs` imports with `@webrun-vcs/core`
   - Update interface references

2. **Add staging dependency**
   - Depend on `@webrun-vcs/staging` for StagingStore
   - Remove direct staging implementations

3. **Enhance status calculator**
   - Compare HEAD, Index, and WorkTree
   - Detect modified, added, deleted, renamed files
   - Handle conflict markers

4. **Improve gitignore handling**
   - Support nested .gitignore files
   - Support .git/info/exclude
   - Support core.excludesFile config

5. **Add checkout support**
   - Move checkout logic from storage-git if needed
   - Or keep checkout in storage-git (it needs FilesApi)

### Test Migration

Tests already exist at `worktree/tests/`:
- `add-command.test.ts`
- `status-calculator.test.ts`
- `ignore/ignore-rule.test.ts`

Update tests to use core interfaces.

### JGit References

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `treewalk/WorkingTreeIterator.java` | Working dir iteration | `interfaces/working-tree-iterator.ts` |
| `treewalk/FileTreeIterator.java` | File-based iterator | storage-git owns this |
| `ignore/IgnoreNode.java` | Ignore pattern handling | `ignore/ignore-rules.ts` |
| `api/StatusCommand.java` | Status calculation | `status-calculator.ts` |
| `api/AddCommand.java` | Add to index | `add-command.ts` |

---

## Package 5: @webrun-vcs/transport (Protocol Layer)

### Purpose
Git network protocol implementation for clone, fetch, push operations.

### Current State

Already exists at `packages/transport/` with comprehensive implementation:
- Protocol v2 support
- Pkt-line codec
- Upload-pack/receive-pack handlers
- HTTP connection handling
- Fetch/push negotiation

### Target Directory Structure

Current structure is already well-organized:

```
packages/transport/src/
├── protocol/
│   ├── pkt-line-codec.ts         # Packet line format
│   ├── capabilities.ts           # Protocol capabilities
│   ├── sideband.ts               # Multiplexing
│   ├── ack-nak.ts                # Acknowledgments
│   └── index.ts
│
├── handlers/
│   ├── upload-pack-handler.ts    # Server: send objects
│   ├── receive-pack-handler.ts   # Server: receive objects
│   ├── protocol-v2-handler.ts    # Modern protocol
│   └── index.ts
│
├── operations/
│   ├── clone.ts
│   ├── fetch.ts
│   ├── push.ts
│   └── index.ts
│
├── connection/
│   ├── http-connection.ts
│   ├── git-connection.ts
│   ├── connection-factory.ts
│   └── index.ts
│
├── negotiation/
│   ├── fetch-negotiator.ts
│   ├── push-negotiator.ts
│   └── index.ts
│
├── storage-adapters/
│   ├── vcs-storage-adapter.ts    # Adapts Repository to transport
│   └── index.ts
│
├── http-server/
│   ├── git-http-server.ts
│   └── index.ts
│
└── index.ts
```

### Implementation Tasks

1. **Update imports to use core**
   - Replace `@webrun-vcs/vcs` with `@webrun-vcs/core`
   - Update all interface references

2. **Update storage adapters**
   - Work with Repository interface from core
   - Remove backend-specific code

3. **Ensure backend-agnostic operation**
   - Transport should work with any Repository implementation
   - No assumptions about storage backend

4. **Review protocol compliance**
   - Ensure Git protocol v2 compatibility
   - Test with real Git servers

### Test Migration

Tests exist at `transport/tests/`:
- Protocol tests (22 files)
- Handler tests
- Connection tests

Update to use core interfaces and test with different backends.

### JGit References

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `transport/Transport.java` | Transport abstraction | `connection/connection-factory.ts` |
| `transport/UploadPack.java` | Server fetch handler | `handlers/upload-pack-handler.ts` |
| `transport/ReceivePack.java` | Server push handler | `handlers/receive-pack-handler.ts` |
| `transport/PacketLineIn/Out.java` | Pkt-line codec | `protocol/pkt-line-codec.ts` |
| `transport/FetchProcess.java` | Fetch orchestration | `operations/fetch.ts` |
| `transport/PushProcess.java` | Push orchestration | `operations/push.ts` |

---

## Package 6: @webrun-vcs/commands (Porcelain Layer)

### Purpose
High-level Git commands for end users. The user-facing API.

### Current State

Already exists at `packages/commands/` with 26 command implementations:
- Repository: init, clone
- Branches: branch, checkout
- Commits: commit, log, show
- Merging: merge, rebase, cherry-pick, revert
- Remote: fetch, push, pull, remote, ls-remote
- Working tree: status, diff, add, rm, reset
- Tags: tag, describe
- Stash: stash

### Target Directory Structure

Current structure is well-organized:

```
packages/commands/src/
├── git.ts                        # Main entry point (Git class)
├── git-command.ts                # Base command class
├── transport-command.ts          # Base for transport commands
│
├── commands/
│   ├── init.ts
│   ├── clone.ts
│   ├── add.ts
│   ├── commit.ts
│   ├── push.ts
│   ├── pull.ts
│   ├── fetch.ts
│   ├── checkout.ts
│   ├── branch.ts
│   ├── merge.ts
│   ├── rebase.ts
│   ├── cherry-pick.ts
│   ├── revert.ts
│   ├── reset.ts
│   ├── log.ts
│   ├── status.ts
│   ├── diff.ts
│   ├── tag.ts
│   ├── stash.ts
│   ├── remote.ts
│   ├── ls-remote.ts
│   ├── describe.ts
│   ├── rm.ts
│   └── index.ts
│
├── results/
│   ├── diff-formatter.ts
│   ├── diff-entry.ts
│   ├── status-result.ts
│   ├── merge-result.ts
│   └── index.ts
│
├── errors/
│   ├── command-errors.ts
│   └── index.ts
│
└── index.ts
```

### Implementation Tasks

1. **Update imports to use core**
   - Replace `@webrun-vcs/vcs` with `@webrun-vcs/core`
   - Update interface references

2. **Update dependencies**
   - Depend on `@webrun-vcs/staging` for staging operations
   - Depend on `@webrun-vcs/worktree` for working tree
   - Depend on `@webrun-vcs/transport` for remote operations

3. **Support multiple backends**
   - Git class should accept any Repository implementation
   - Factory functions for different backends

4. **Enhance error handling**
   - Consistent error types across commands
   - Helpful error messages

5. **Add missing commands** (if needed)
   - Review JGit api/ for any missing porcelain commands
   - Consider: blame, archive, bisect, clean, grep

### Test Migration

Tests exist at `commands/tests/` (24 test files):
- Command-specific tests
- Workflow integration tests

Update to use core interfaces and test with multiple backends.

### JGit References

| JGit Class | Purpose | WebRun Equivalent |
|------------|---------|-------------------|
| `api/Git.java` | Main entry point | `git.ts` |
| `api/GitCommand.java` | Base command | `git-command.ts` |
| `api/CommitCommand.java` | Commit operation | `commands/commit.ts` |
| `api/MergeCommand.java` | Merge operation | `commands/merge.ts` |
| `api/CheckoutCommand.java` | Checkout operation | `commands/checkout.ts` |
| `api/StatusCommand.java` | Status calculation | `commands/status.ts` |

---

## Implementation Order

The packages should be implemented in dependency order:

### Phase 0: Prerequisites
0. **Stream utilities to @webrun-vcs/utils** - Required by core and all packages

### Phase 1: Foundation
1. **@webrun-vcs/core** - Must be first (all others depend on it)

### Phase 2: Storage Layer
2. **@webrun-vcs/storage-git** - Rename and consolidate store-files

### Phase 3: Mid-Level Components
3. **@webrun-vcs/staging** - Depends on core
4. **@webrun-vcs/worktree** - Depends on core, staging

### Phase 4: High-Level Components
5. **@webrun-vcs/transport** - Depends on core
6. **@webrun-vcs/commands** - Depends on all above

---

## Testing Strategy

### Shared Test Suites

The `packages/testing/` package provides parametrized test suites:
- `createStreamingStoresTests()` - Tests BlobStore, TreeStore, CommitStore, TagStore
- `createRefStoreTests()` - Tests RefStore
- `createStagingStoreTests()` - Tests StagingStore
- `createCommitStoreTests()` - Tests CommitStore with ancestry

Note: Low-level repository tests (ObjectRepository, DeltaRepository, MetadataRepository) will be reintroduced in Phase 2 when adding multiple backends.

### JGit Test Porting

For each package, identify key JGit test cases to port:

1. **core**: Format parsing tests from `lib/`
2. **storage-git**: Pack/index tests from `internal/storage/`
3. **staging**: DirCache tests from `dircache/`
4. **worktree**: WorkingTree tests from `treewalk/`
5. **transport**: Protocol tests from `transport/`
6. **commands**: API tests from `api/`

### Test Fixtures

JGit test fixtures are available at:
- `tmp/jgit/org.eclipse.jgit.test/tst-rsrc/` - Sample pack files, repos
- `packages/store-files/tests/fixtures/jgit/` - Already ported fixtures

---

## BD Issues Structure

After validation, create the following issue hierarchy:

### Epic: VCS Architecture Refactoring

**Utils Package Issues (Phase 0):**
- Create @webrun-vcs/utils package structure
- Migrate stream utilities from vcs/src/format/stream-utils.ts
- Implement streaming tests (concat, splitStream, readHeader, toLines)
- Add newSplitter and newByteSplitter tests
- Update vcs package to depend on @webrun-vcs/utils

**Core Package Issues:**
- Create @webrun-vcs/core package structure
- Migrate type definitions to core
- Migrate store interfaces to core (BlobStore, TreeStore, CommitStore, TagStore, RefStore, Repository)
- Migrate staging interfaces to core
- Migrate format serializers to core
- Migrate core tests

**Storage-Git Package Issues:**
- Rename store-files to storage-git
- Move delta compression to storage-git
- Move garbage collection to storage-git
- Reorganize internal structure (loose/, pack/, etc.)
- Implement Repository interface
- Verify FilesApi-only usage
- Update imports to use core
- Migrate storage-git tests

**Staging Package Issues:**
- Create @webrun-vcs/staging package
- Implement file-based StagingStore (Git index format, FilesApi)
- Implement memory StagingStore
- Implement StagingBuilder
- Implement StagingEditor
- Add conflict utilities
- Migrate staging tests

**Worktree Package Issues:**
- Update worktree imports to use core
- Add staging package dependency
- Enhance status calculator
- Improve gitignore handling
- Update worktree tests

**Transport Package Issues:**
- Update transport imports to use core
- Update storage adapters for Repository interface
- Ensure backend-agnostic operation
- Update transport tests

**Commands Package Issues:**
- Update commands imports to use core
- Update package dependencies
- Support multiple backends
- Enhance error handling
- Update commands tests

---

## Next Steps

1. Review this plan document
2. Transform into bd issues using `bd create` commands
3. Set up dependencies between issues (utils blocks core, core blocks all others)
4. Begin implementation with @webrun-vcs/utils package (stream utilities)
5. Continue with @webrun-vcs/core package
