# Repository Unification Plan

**Date:** 2025-12-26
**Status:** Proposed
**Related Analysis:** [notes/src/2025-12-26/01-[vcs]-storage-interfaces-analysis.md](../../notes/src/2025-12-26/01-[vcs]-storage-interfaces-analysis.md)

## Overview

Unify the storage interfaces around `Repository` as the single entry point for all VCS operations. Remove GitStores interface entirely.

## Target Architecture

```
                    ┌────────────────────────────────────────────┐
                    │              Repository                     │
                    │                                             │
                    │  objects, commits, trees, blobs, tags, refs │
                    │  config                                     │
                    │  storage: BinStore                          │
                    │                                             │
                    │  initialize(), close(), isInitialized()     │
                    │  flush(), refresh()                         │
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

## Repository Interface (Final)

**File:** `packages/core/src/repository.ts`

```typescript
import type { BlobStore } from "./blob/blob-store.js";
import type { CommitStore } from "./commits/commit-store.js";
import type { GitObjectStore } from "./objects/object-store.js";
import type { RefStore } from "./refs/ref-store.js";
import type { TagStore } from "./tags/tag-store.js";
import type { TreeStore } from "./trees/tree-store.js";
import type { BinStore } from "./binary/raw-store.js";

export interface RepositoryConfig {
  name?: string;
  bare?: boolean;
  [key: string]: unknown;
}

export interface Repository {
  // Object stores
  readonly objects: GitObjectStore;
  readonly commits: CommitStore;
  readonly trees: TreeStore;
  readonly blobs: BlobStore;
  readonly tags: TagStore;

  // References
  readonly refs: RefStore;

  // Configuration
  readonly config: RepositoryConfig;

  // Low-level storage access
  readonly storage: BinStore;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  isInitialized(): Promise<boolean>;
  flush(): Promise<void>;
  refresh(): Promise<void>;
}
```

## Factory Pattern

**File:** `packages/core/src/repository.ts`

```typescript
export interface RepositoryOptions {
  create?: boolean;
  config?: RepositoryConfig;
}

export type RepositoryFactory<TOptions extends RepositoryOptions = RepositoryOptions> = (
  options?: TOptions,
) => Promise<Repository>;
```

**Backend factories:**

```typescript
// packages/store-mem/src/index.ts
export function createMemoryRepository(options?: RepositoryOptions): Promise<Repository>;

// packages/storage-git/src/index.ts
export interface FileRepositoryOptions extends RepositoryOptions {
  files: FilesApi;
  gitDir?: string;
  bare?: boolean;
}
export function createFileRepository(options: FileRepositoryOptions): Promise<Repository>;

// packages/store-sql/src/index.ts
export interface SqlRepositoryOptions extends RepositoryOptions {
  db: Database;
}
export function createSqlRepository(options: SqlRepositoryOptions): Promise<Repository>;

// packages/store-kv/src/index.ts
export interface KvRepositoryOptions extends RepositoryOptions {
  store: KVStore;
}
export function createKvRepository(options: KvRepositoryOptions): Promise<Repository>;
```

## Implementation Plan

### Phase 1: Update Core Interface

1. Add `storage: BinStore` property to Repository (required, not optional)
2. Add `flush(): Promise<void>` method
3. Add `refresh(): Promise<void>` method
4. Remove GitStores interface entirely
5. Add RepositoryOptions and RepositoryFactory types

### Phase 2: Implement Repository for All Backends

#### MemoryRepository (store-mem)

```typescript
export class MemoryRepository implements Repository {
  readonly objects: GitObjectStore;
  readonly commits: CommitStore;
  readonly trees: TreeStore;
  readonly blobs: BlobStore;
  readonly tags: TagStore;
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
```

#### FileRepository (storage-git)

Update existing GitRepository to match new interface.

#### SqlRepository (store-sql)

Similar pattern using SqlBinStore.

#### KvRepository (store-kv)

Similar pattern using KvBinStore.

### Phase 3: Update Consumer Packages

#### Transport Package

```typescript
// packages/transport/src/storage-adapters/vcs-repository-adapter.ts
export class VcsRepositoryAdapter {
  constructor(private readonly repository: Repository) {}

  get objects() { return this.repository.objects; }
  get commits() { return this.repository.commits; }
  get trees() { return this.repository.trees; }
  get blobs() { return this.repository.blobs; }
  get tags() { return this.repository.tags; }
}
```

#### Commands Package

```typescript
// packages/commands/src/git.ts
export class Git {
  constructor(
    private readonly repository: Repository,
    private readonly files?: FilesApi,
  ) {}

  static async open(files: FilesApi, gitDir?: string): Promise<Git> {
    const repository = await createFileRepository({ files, gitDir });
    return new Git(repository, files);
  }

  static async memory(): Promise<Git> {
    const repository = await createMemoryRepository({ create: true });
    return new Git(repository);
  }
}
```

### Phase 4: Update Testing Package

Create repository test suite:

```typescript
// packages/testing/src/suites/repository.suite.ts
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

      it("has HEAD after initialization", async () => {
        const repo = await createRepository();
        await repo.initialize();
        expect(await repo.refs.has("HEAD")).toBe(true);
        await repo.close();
      });
    });

    describe("stores", () => {
      // All typed store tests...
    });

    describe("storage", () => {
      it("exposes BinStore", async () => {
        const repo = await createRepository();
        expect(repo.storage).toBeDefined();
        expect(repo.storage.raw).toBeDefined();
        expect(repo.storage.delta).toBeDefined();
        await repo.close();
      });
    });
  });
}
```

## Files to Modify

### Core Package
- `packages/core/src/repository.ts` - Update interface, remove GitStores

### Storage Backends
- `packages/store-mem/src/memory-repository.ts` - Create new file
- `packages/store-mem/src/index.ts` - Export createMemoryRepository
- `packages/storage-git/src/git-repository.ts` - Update to match interface
- `packages/storage-git/src/index.ts` - Export createFileRepository
- `packages/store-sql/src/sql-repository.ts` - Create new file
- `packages/store-sql/src/index.ts` - Export createSqlRepository
- `packages/store-kv/src/kv-repository.ts` - Create new file
- `packages/store-kv/src/index.ts` - Export createKvRepository

### Consumer Packages
- `packages/transport/src/storage-adapters/vcs-repository-adapter.ts` - Update
- `packages/commands/src/git.ts` - Update

### Testing
- `packages/testing/src/suites/repository.suite.ts` - Create new file
- Delete `packages/testing/src/suites/streaming-stores.suite.ts`

## Files to Delete

- Remove GitStores from `packages/core/src/repository.ts`
- Delete `packages/store-mem/src/create-streaming-stores.ts`
- Delete `packages/store-sql/src/create-streaming-stores.ts`
- Delete `packages/store-kv/src/create-streaming-stores.ts`
- Delete `packages/storage-git/src/create-streaming-stores.ts`

## Verification

```bash
pnpm build
pnpm test
pnpm lint:fix
pnpm format:fix
```

## Success Criteria

1. Repository is the only interface for VCS operations
2. All backends implement full Repository interface
3. GitStores interface removed entirely
4. Consistent factory pattern across all backends
5. Transport and commands use Repository directly
6. All tests pass
