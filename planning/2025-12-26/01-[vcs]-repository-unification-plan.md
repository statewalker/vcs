# Repository Unification Plan

**Date:** 2025-12-26
**Status:** Proposed
**Related Analysis:** [notes/src/2025-12-26/01-[vcs]-storage-interfaces-analysis.md](../../notes/src/2025-12-26/01-[vcs]-storage-interfaces-analysis.md)

## Overview

Unify the storage interfaces around `Repository` as the central abstraction. Currently, the codebase has parallel hierarchies (`Repository`/`GitStores` for typed storage and `BinStore`/`RawStore` for binary storage) that don't connect cleanly.

## Goals

1. **Repository as single entry point** - All VCS operations go through Repository
2. **Consistent factory pattern** - One pattern to create repositories across all backends
3. **Expose low-level storage when needed** - Access to BinStore for advanced operations
4. **Unified lifecycle** - flush/refresh/close at Repository level
5. **GitStores becomes implementation detail** - Transport uses Repository directly

## Current Architecture

```
                    ┌────────────────────────────────────────────┐
                    │              Repository                     │
                    │  objects, commits, trees, blobs, tags, refs │
                    │  config, initialize(), close()              │
                    └─────────────────┬──────────────────────────┘
                                      │ (only GitRepository)
                    ┌─────────────────┴──────────────────────────┐
                    │              GitStores                      │
                    │  objects, commits, trees, blobs, tags       │
                    └─────────────────┬──────────────────────────┘
                                      │
    ┌─────────────────────────────────┼─────────────────────────────┐
    │                                 │                              │
    ▼                                 ▼                              ▼
┌───────────────┐           ┌───────────────┐              ┌───────────────┐
│ FileObjectStores │         │ MemObjectStores │            │ SqlObjectStores │
│ (storage-git) │           │ (store-mem)   │              │ (store-sql)   │
└───────┬───────┘           └───────┬───────┘              └───────┬───────┘
        │                           │                              │
        ▼                           ▼                              ▼
   FileBinStore               MemBinStore                    SqlBinStore
        │                           │                              │
        ├── FileRawStore            ├── MemRawStore                ├── SqlRawStore
        └── FileDeltaStore          └── MemDeltaStore              └── SqlDeltaStore
```

**Problems:**
- GitStores is separate from Repository (only GitRepository implements both)
- No way to create Repository from BinStore generically
- Memory/SQL/KV backends create GitStores, not Repository
- Transport uses GitStores, should use Repository

## Proposed Architecture

```
                    ┌────────────────────────────────────────────┐
                    │              Repository                     │
                    │  (EXTENDED with storage property)           │
                    │                                             │
                    │  objects, commits, trees, blobs, tags, refs │
                    │  config                                     │
                    │  storage: BinStore (optional)               │
                    │                                             │
                    │  initialize(), close(), isInitialized()     │
                    │  flush()                                    │
                    │  refresh()                                  │
                    └─────────────────┬──────────────────────────┘
                                      │
    ┌─────────────────────────────────┼─────────────────────────────┐
    │                                 │                              │
    ▼                                 ▼                              ▼
FileRepository              MemoryRepository               SqlRepository
(storage-git)               (store-mem)                    (store-sql)
    │                           │                              │
    ▼                           ▼                              ▼
FileBinStore               MemBinStore                    SqlBinStore
```

## Implementation Plan

### Phase 1: Extend Repository Interface

Add optional low-level access and lifecycle methods to Repository.

**File:** `packages/core/src/repository.ts`

```typescript
export interface Repository {
  // Existing stores
  readonly objects: GitObjectStore;
  readonly commits: CommitStore;
  readonly trees: TreeStore;
  readonly blobs: BlobStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
  readonly config: RepositoryConfig;

  // NEW: Optional low-level storage access
  readonly storage?: BinStore;

  // Existing lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  isInitialized(): Promise<boolean>;

  // NEW: Extended lifecycle
  flush(): Promise<void>;
  refresh(): Promise<void>;
}
```

**Tasks:**
1. Add `storage?: BinStore` property
2. Add `flush(): Promise<void>` method
3. Add `refresh(): Promise<void>` method
4. Update JSDoc comments

### Phase 2: Deprecate GitStores

GitStores becomes an alias for a subset of Repository properties.

**File:** `packages/core/src/repository.ts`

```typescript
/**
 * GitStores - Collection of Git object stores
 *
 * @deprecated Use Repository interface directly. GitStores will be removed
 * in a future version. Transport and storage operations should accept
 * Repository and only use the stores they need.
 */
export interface GitStores {
  readonly objects: GitObjectStore;
  readonly commits: CommitStore;
  readonly trees: TreeStore;
  readonly blobs: BlobStore;
  readonly tags: TagStore;
}

/**
 * Extract GitStores from a Repository
 *
 * @deprecated Use Repository directly instead
 */
export function asGitStores(repo: Repository): GitStores {
  return {
    objects: repo.objects,
    commits: repo.commits,
    trees: repo.trees,
    blobs: repo.blobs,
    tags: repo.tags,
  };
}
```

**Tasks:**
1. Mark GitStores as @deprecated
2. Add asGitStores helper for migration
3. Update transport package to accept Repository

### Phase 3: Create Repository Factory Pattern

Standardize repository creation across all backends.

**File:** `packages/core/src/repository.ts` (new types)

```typescript
/**
 * Options for creating a repository
 */
export interface RepositoryOptions {
  /** Whether to create if it doesn't exist */
  create?: boolean;
  /** Repository configuration */
  config?: RepositoryConfig;
}

/**
 * Factory function signature for creating repositories
 */
export type RepositoryFactory<TOptions extends RepositoryOptions = RepositoryOptions> = (
  options?: TOptions,
) => Promise<Repository>;
```

**Backend implementations:**

```typescript
// packages/store-mem/src/repository.ts
export function createMemoryRepository(options?: RepositoryOptions): Promise<Repository>;

// packages/storage-git/src/repository.ts
export interface FileRepositoryOptions extends RepositoryOptions {
  files: FilesApi;
  gitDir?: string;
  bare?: boolean;
}
export function createFileRepository(options: FileRepositoryOptions): Promise<Repository>;

// packages/store-sql/src/repository.ts
export interface SqlRepositoryOptions extends RepositoryOptions {
  db: Database;
}
export function createSqlRepository(options: SqlRepositoryOptions): Promise<Repository>;

// packages/store-kv/src/repository.ts
export interface KvRepositoryOptions extends RepositoryOptions {
  store: KVStore;
}
export function createKvRepository(options: KvRepositoryOptions): Promise<Repository>;
```

**Tasks:**
1. Define RepositoryOptions in core
2. Add createMemoryRepository to store-mem
3. Rename GitRepository.open/init to createFileRepository in storage-git
4. Add createSqlRepository to store-sql
5. Add createKvRepository to store-kv

### Phase 4: Implement Repository for All Backends

Currently only storage-git has a full Repository implementation. Add implementations to other backends.

#### store-mem Implementation

**File:** `packages/store-mem/src/memory-repository.ts`

```typescript
import type { Repository, RepositoryConfig, RefStore } from "@webrun-vcs/core";
import { createMemoryObjectStores } from "./object-storage/index.js";
import { MemRefStore } from "./ref-store.js";
import { MemBinStore } from "./binary-storage/index.js";

export class MemoryRepository implements Repository {
  readonly objects;
  readonly commits;
  readonly trees;
  readonly blobs;
  readonly tags;
  readonly refs: RefStore;
  readonly config: RepositoryConfig;
  readonly storage: MemBinStore;

  constructor(config: RepositoryConfig = {}) {
    this.config = config;
    this.storage = new MemBinStore();

    const stores = createMemoryObjectStores({ rawStore: this.storage.raw });
    this.objects = stores.objects;
    this.commits = stores.commits;
    this.trees = stores.trees;
    this.blobs = stores.blobs;
    this.tags = stores.tags;

    this.refs = new MemRefStore();
  }

  async initialize(): Promise<void> {
    await this.refs.setSymbolic("HEAD", "refs/heads/main");
  }

  async close(): Promise<void> {
    await this.storage.close();
  }

  async isInitialized(): Promise<boolean> {
    return this.refs.has("HEAD");
  }

  async flush(): Promise<void> {
    await this.storage.flush();
  }

  async refresh(): Promise<void> {
    await this.storage.refresh();
  }
}

export function createMemoryRepository(options?: RepositoryOptions): Promise<Repository> {
  const repo = new MemoryRepository(options?.config);
  if (options?.create) {
    return repo.initialize().then(() => repo);
  }
  return Promise.resolve(repo);
}
```

**Tasks:**
1. Create MemoryRepository class
2. Export createMemoryRepository factory
3. Update tests to use Repository

#### store-sql Implementation

Similar pattern using SqlBinStore and existing SQL stores.

**Tasks:**
1. Create SqlRepository class
2. Export createSqlRepository factory
3. Update tests to use Repository

#### store-kv Implementation

Similar pattern using KvBinStore and existing KV stores.

**Tasks:**
1. Create KvRepository class
2. Export createKvRepository factory
3. Update tests to use Repository

### Phase 5: Update Transport Package

Transport should work with Repository instead of GitStores.

**File:** `packages/transport/src/storage-adapters/vcs-repository-adapter.ts`

```typescript
// Before
export class VcsRepositoryAdapter {
  constructor(private stores: GitStores) {}
}

// After
export class VcsRepositoryAdapter {
  constructor(private repository: Repository) {}

  get objects() { return this.repository.objects; }
  get commits() { return this.repository.commits; }
  // etc.
}
```

**Tasks:**
1. Update VcsRepositoryAdapter to accept Repository
2. Update all transport operations to use Repository
3. Update transport tests

### Phase 6: Update Commands Package

Commands should create/use Repository instances.

**File:** `packages/commands/src/git.ts`

```typescript
// Before
export class Git {
  constructor(
    private readonly files: FilesApi,
    private readonly gitDir: string = ".git",
  ) {}
}

// After
export class Git {
  constructor(
    private readonly repository: Repository,
    private readonly files?: FilesApi,  // Optional, for worktree operations
  ) {}

  static async open(files: FilesApi, gitDir?: string): Promise<Git> {
    const repository = await createFileRepository({ files, gitDir });
    return new Git(repository, files);
  }
}
```

**Tasks:**
1. Update Git class to accept Repository
2. Add static factory methods
3. Update commands to use Repository
4. Update tests

### Phase 7: Update Testing Package

Shared test suites should test Repository interface.

**File:** `packages/testing/src/suites/repository.suite.ts` (new)

```typescript
export function createRepositoryTests(
  name: string,
  createRepository: () => Promise<Repository>,
) {
  describe(`Repository: ${name}`, () => {
    describe("lifecycle", () => {
      it("initializes repository", async () => {
        const repo = await createRepository();
        await repo.initialize();
        expect(await repo.isInitialized()).toBe(true);
        await repo.close();
      });
    });

    describe("refs", () => {
      it("has HEAD after initialization", async () => {
        const repo = await createRepository();
        await repo.initialize();
        expect(await repo.refs.has("HEAD")).toBe(true);
        await repo.close();
      });
    });

    // Include all existing store tests...
  });
}
```

**Tasks:**
1. Create repository.suite.ts
2. Migrate streaming-stores.suite.ts tests to repository.suite.ts
3. Add lifecycle tests
4. Add ref tests
5. Update all backend test files

## Migration Checklist

### Core Package
- [ ] Add `storage?: BinStore` to Repository
- [ ] Add `flush()` to Repository
- [ ] Add `refresh()` to Repository
- [ ] Mark GitStores as @deprecated
- [ ] Add asGitStores helper
- [ ] Define RepositoryOptions type
- [ ] Define RepositoryFactory type

### Storage Backends
- [ ] store-mem: Add MemoryRepository class
- [ ] store-mem: Add createMemoryRepository factory
- [ ] store-sql: Add SqlRepository class
- [ ] store-sql: Add createSqlRepository factory
- [ ] store-kv: Add KvRepository class
- [ ] store-kv: Add createKvRepository factory
- [ ] storage-git: Rename to createFileRepository

### Consumer Packages
- [ ] transport: Update VcsRepositoryAdapter
- [ ] transport: Update operations
- [ ] commands: Update Git class
- [ ] commands: Add factory methods
- [ ] worktree: Update to use Repository

### Testing
- [ ] Create repository.suite.ts
- [ ] Update backend tests
- [ ] Verify all tests pass

## Verification Steps

1. **Build check:** `pnpm build`
2. **Type check:** `pnpm exec tsc --noEmit`
3. **Test suite:** `pnpm test`
4. **Lint/format:** `pnpm lint:fix && pnpm format:fix`

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking transport package | Add asGitStores helper for gradual migration |
| Breaking commands package | Add Git.open() factory alongside constructor |
| Large number of changes | Phase the implementation, verify after each phase |
| GitStores still needed in tests | Keep deprecated but functional until Phase 7 |

## Success Criteria

1. All backends implement full Repository interface
2. Repository has consistent factory pattern across backends
3. Transport and commands use Repository, not GitStores
4. GitStores is deprecated with migration path
5. All tests pass with new architecture
6. BinStore accessible through Repository.storage when needed
