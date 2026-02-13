# WorkingCopy Implementation Plan

This plan implements **Proposal D (Hybrid Approach)** from the architecture analysis, introducing clear separation between `Repository` (shared history) and `WorkingCopy` (local checkout state).

## Overview

The goal is to separate concerns that are currently mixed in the `Repository` interface:

- **Repository**: Immutable history storage + shared refs (branches, tags)
- **WorkingCopy**: Local checkout state (HEAD, staging, merge state, worktree access)

This enables:
- Multiple working copies sharing one repository
- Clear boundaries for different storage backends
- Alignment with Fossil's checkout database concept

## Location

All top-level interfaces (`Repository`, `WorkingCopy`, `GitStores`) are defined in `packages/core/src/`.

## Phase 1: Define WorkingCopy Interface

Create the core `WorkingCopy` interface without changing existing code.

### Step 1.1: Create working-copy.ts

Create `packages/core/src/working-copy.ts`:

```typescript
/**
 * WorkingCopy interface - local checkout state
 *
 * A WorkingCopy links a working directory to a Repository.
 * It manages all local state: HEAD, staging area, merge state.
 * Multiple WorkingCopies can share a single Repository.
 *
 * Corresponds to Fossil's "checkout database" concept.
 */

import type { ObjectId } from "./id/index.js";
import type { Repository } from "./repository.js";
import type { StagingStore } from "./staging/index.js";
import type { RepositoryStatus, StatusOptions } from "./status/index.js";
import type { WorkingTreeIterator } from "./worktree/index.js";

/**
 * Working copy configuration
 *
 * Local configuration that may override repository-level settings.
 */
export interface WorkingCopyConfig {
  /** Custom configuration options */
  [key: string]: unknown;
}

/**
 * Stash operations interface
 *
 * Accessed via WorkingCopy, but storage is backend-dependent:
 * - Git file-based: stores in central refs/stash
 * - Other backends: may use per-working-copy storage
 */
export interface StashStore {
  /** List all stash entries */
  list(): AsyncIterable<StashEntry>;
  /** Push current changes to stash */
  push(message?: string): Promise<ObjectId>;
  /** Pop most recent stash entry */
  pop(): Promise<void>;
  /** Apply stash entry without removing it */
  apply(index?: number): Promise<void>;
  /** Drop a stash entry */
  drop(index?: number): Promise<void>;
  /** Clear all stash entries */
  clear(): Promise<void>;
}

/**
 * A single stash entry
 */
export interface StashEntry {
  /** Stash index (0 = most recent) */
  readonly index: number;
  /** Commit ID of stashed state */
  readonly commitId: ObjectId;
  /** Stash message */
  readonly message: string;
  /** When the stash was created */
  readonly timestamp: number;
}

/**
 * Merge state when a merge is in progress
 */
export interface MergeState {
  /** Commit being merged into current branch */
  readonly mergeHead: ObjectId;
  /** Original HEAD before merge started */
  readonly origHead: ObjectId;
  /** Merge message (from MERGE_MSG) */
  readonly message?: string;
  /** Whether this is a squash merge */
  readonly squash?: boolean;
}

/**
 * Rebase state when a rebase is in progress
 */
export interface RebaseState {
  /** Type of rebase operation */
  readonly type: "rebase" | "rebase-merge" | "rebase-apply";
  /** Branch being rebased onto */
  readonly onto: ObjectId;
  /** Original branch being rebased */
  readonly head: ObjectId;
  /** Current step number */
  readonly current: number;
  /** Total number of steps */
  readonly total: number;
}

/**
 * WorkingCopy - a checked-out working directory
 *
 * Links to a Repository and adds local state.
 * Multiple WorkingCopies can share one Repository.
 */
export interface WorkingCopy {
  // ============ Links ============

  /** The repository this working copy is linked to */
  readonly repository: Repository;

  /** Working tree filesystem access */
  readonly worktree: WorkingTreeIterator;

  /** Staging area (the index) */
  readonly staging: StagingStore;

  /** Stash operations (storage is backend-dependent) */
  readonly stash: StashStore;

  /** Working copy local configuration */
  readonly config: WorkingCopyConfig;

  // ============ HEAD Management ============

  /**
   * Get current HEAD commit ID
   *
   * @returns Commit ID or undefined if no commits yet
   */
  getHead(): Promise<ObjectId | undefined>;

  /**
   * Get current branch name
   *
   * @returns Branch name or undefined if detached HEAD
   */
  getCurrentBranch(): Promise<string | undefined>;

  /**
   * Set HEAD to a branch or commit
   *
   * @param target Branch name (refs/heads/...) or commit ID for detached HEAD
   */
  setHead(target: ObjectId | string): Promise<void>;

  /**
   * Check if HEAD is detached (pointing directly to commit, not branch)
   */
  isDetachedHead(): Promise<boolean>;

  // ============ In-Progress Operations ============

  /**
   * Get merge state if a merge is in progress
   */
  getMergeState(): Promise<MergeState | undefined>;

  /**
   * Get rebase state if a rebase is in progress
   */
  getRebaseState(): Promise<RebaseState | undefined>;

  /**
   * Check if any operation is in progress (merge, rebase, cherry-pick, etc.)
   */
  hasOperationInProgress(): Promise<boolean>;

  // ============ Status ============

  /**
   * Calculate full repository status
   *
   * Compares HEAD, staging area, and working tree.
   */
  getStatus(options?: StatusOptions): Promise<RepositoryStatus>;

  // ============ Lifecycle ============

  /**
   * Refresh working copy state from storage
   *
   * Call after external changes to the repository.
   */
  refresh(): Promise<void>;

  /**
   * Close working copy and release resources
   */
  close(): Promise<void>;
}

/**
 * Options for opening a working copy
 */
export interface WorkingCopyOptions {
  /** Create if doesn't exist (default: true) */
  create?: boolean;
  /** Default branch for new repositories (default: "main") */
  defaultBranch?: string;
}

/**
 * Options for adding a new worktree
 */
export interface AddWorktreeOptions {
  /** Branch to check out (creates if doesn't exist) */
  branch?: string;
  /** Commit to check out (detached HEAD) */
  commit?: ObjectId;
  /** Force creation even if branch exists elsewhere */
  force?: boolean;
}

/**
 * Factory for creating working copies
 */
export interface WorkingCopyFactory {
  /**
   * Open or create a working copy at the given path
   *
   * @param worktreePath Path to working directory
   * @param repositoryPath Path to repository (.git directory or bare repo)
   * @param options Creation options
   */
  openWorkingCopy(
    worktreePath: string,
    repositoryPath: string,
    options?: WorkingCopyOptions,
  ): Promise<WorkingCopy>;

  /**
   * Create additional worktree for existing repository
   *
   * Similar to `git worktree add`.
   *
   * @param repository Existing repository
   * @param worktreePath Path for new working directory
   * @param options Worktree options
   */
  addWorktree(
    repository: Repository,
    worktreePath: string,
    options?: AddWorktreeOptions,
  ): Promise<WorkingCopy>;
}
```

### Step 1.2: Export from index.ts

Add to `packages/core/src/index.ts`:

```typescript
// Working copy interface
export * from "./working-copy.js";
```

### Step 1.3: Update Repository Documentation

Update JSDoc in `packages/core/src/repository.ts` to clarify the relationship:

```typescript
/**
 * Repository interface - shared history storage
 *
 * A Repository contains immutable objects (commits, trees, blobs, tags)
 * and shared refs (branches, remote tracking refs).
 *
 * For local checkout state (HEAD, staging, merge state), use WorkingCopy.
 * Multiple WorkingCopies can share a single Repository.
 *
 * Implementations may use different backends:
 * - File-based: .git directory structure
 * - SQL: database tables
 * - Memory: in-memory for testing
 */
```

## Phase 2: Create WorkingCopy Implementation

Implement the interface for file-based Git storage.

### Step 2.1: Create working-copy directory

Create `packages/core/src/working-copy/` with:

```
packages/core/src/working-copy/
├── index.ts
├── working-copy.impl.ts
├── working-copy.files.ts      # File-based implementation
├── working-copy.memory.ts     # In-memory implementation
├── merge-state-reader.ts
└── rebase-state-reader.ts
```

### Step 2.2: Implement GitWorkingCopy

Create `packages/core/src/working-copy/working-copy.files.ts`:

```typescript
/**
 * File-based WorkingCopy implementation
 *
 * Manages local checkout state for a Git working directory.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type { ObjectId } from "../id/index.js";
import type { Repository } from "../repository.js";
import type { StagingStore } from "../staging/index.js";
import type { RepositoryStatus, StatusOptions } from "../status/index.js";
import type { WorkingTreeIterator } from "../worktree/index.js";
import type { MergeState, RebaseState, WorkingCopy } from "../working-copy.js";

export class GitWorkingCopy implements WorkingCopy {
  constructor(
    readonly repository: Repository,
    readonly worktree: WorkingTreeIterator,
    readonly staging: StagingStore,
    private readonly files: FilesApi,
    private readonly gitDir: string,
  ) {}

  async getHead(): Promise<ObjectId | undefined> {
    const ref = await this.repository.refs.resolve("HEAD");
    return ref?.objectId;
  }

  async getCurrentBranch(): Promise<string | undefined> {
    const headRef = await this.repository.refs.get("HEAD");
    if (headRef && "target" in headRef) {
      const target = headRef.target;
      if (target.startsWith("refs/heads/")) {
        return target.substring("refs/heads/".length);
      }
    }
    return undefined;
  }

  async setHead(target: ObjectId | string): Promise<void> {
    if (target.startsWith("refs/") || !target.match(/^[0-9a-f]{40}$/)) {
      // Branch reference
      await this.repository.refs.setSymbolic("HEAD", target);
    } else {
      // Detached HEAD (commit ID)
      await this.repository.refs.set("HEAD", target);
    }
  }

  async isDetachedHead(): Promise<boolean> {
    const headRef = await this.repository.refs.get("HEAD");
    return headRef !== undefined && !("target" in headRef);
  }

  async getMergeState(): Promise<MergeState | undefined> {
    // Read from .git/MERGE_HEAD, .git/MERGE_MSG, etc.
    // Implementation details...
  }

  async getRebaseState(): Promise<RebaseState | undefined> {
    // Read from .git/rebase-merge/ or .git/rebase-apply/
    // Implementation details...
  }

  async hasOperationInProgress(): Promise<boolean> {
    const [merge, rebase] = await Promise.all([
      this.getMergeState(),
      this.getRebaseState(),
    ]);
    return merge !== undefined || rebase !== undefined;
  }

  async getStatus(options?: StatusOptions): Promise<RepositoryStatus> {
    // Use StatusCalculator with this working copy's state
    // Implementation details...
  }

  async refresh(): Promise<void> {
    await this.staging.read();
  }

  async close(): Promise<void> {
    // Release resources if needed
  }
}
```

### Step 2.3: Create Factory Implementation

Create `packages/core/src/working-copy/working-copy-factory.files.ts`:

```typescript
/**
 * Factory for creating file-based working copies
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type { Repository } from "../repository.js";
import type {
  AddWorktreeOptions,
  WorkingCopy,
  WorkingCopyFactory,
  WorkingCopyOptions,
} from "../working-copy.js";
import { GitWorkingCopy } from "./working-copy.files.js";

export class GitWorkingCopyFactory implements WorkingCopyFactory {
  constructor(private readonly files: FilesApi) {}

  async openWorkingCopy(
    worktreePath: string,
    repositoryPath: string,
    options?: WorkingCopyOptions,
  ): Promise<WorkingCopy> {
    // 1. Open or create repository
    // 2. Create staging store
    // 3. Create working tree iterator
    // 4. Return GitWorkingCopy
  }

  async addWorktree(
    repository: Repository,
    worktreePath: string,
    options?: AddWorktreeOptions,
  ): Promise<WorkingCopy> {
    // 1. Create worktree directory
    // 2. Create .git file pointing to main repo
    // 3. Update main repo's worktrees/ directory
    // 4. Create staging store for new worktree
    // 5. Return GitWorkingCopy
  }
}
```

## Phase 3: Migrate Existing Commands

Update commands to accept `WorkingCopy` instead of `Repository`.

### Step 3.1: Update add.command.ts

```typescript
// Before
export interface AddCommand {
  execute(repository: Repository, paths: string[]): Promise<AddResult>;
}

// After
export interface AddCommand {
  execute(workingCopy: WorkingCopy, paths: string[]): Promise<AddResult>;
}
```

### Step 3.2: Update checkout.command.ts

```typescript
// Before
export interface CheckoutCommand {
  execute(repository: Repository, target: string): Promise<CheckoutResult>;
}

// After
export interface CheckoutCommand {
  execute(workingCopy: WorkingCopy, target: string): Promise<CheckoutResult>;
}
```

### Step 3.3: Update status-calculator.ts

The StatusCalculator should work with WorkingCopy:

```typescript
export interface StatusCalculator {
  calculateStatus(
    workingCopy: WorkingCopy,
    options?: StatusOptions,
  ): Promise<RepositoryStatus>;
}
```

Or integrate directly into WorkingCopy as shown in the interface.

## Phase 4: Memory Implementation

Create in-memory WorkingCopy for testing.

### Step 4.1: Create working-copy.memory.ts

```typescript
/**
 * In-memory WorkingCopy for testing
 */

export class MemoryWorkingCopy implements WorkingCopy {
  private headRef: string = "refs/heads/main";
  private headCommit: ObjectId | undefined;
  private mergeState: MergeState | undefined;
  private rebaseState: RebaseState | undefined;

  constructor(
    readonly repository: Repository,
    readonly worktree: WorkingTreeIterator,
    readonly staging: StagingStore,
  ) {}

  // ... implementation
}
```

## Phase 5: Update Tests

### Step 5.1: Create WorkingCopy tests

Create `packages/core/tests/working-copy.test.ts`:

```typescript
describe("WorkingCopy", () => {
  describe("HEAD management", () => {
    it("should get current branch");
    it("should detect detached HEAD");
    it("should switch branches");
  });

  describe("merge state", () => {
    it("should detect merge in progress");
    it("should read merge head");
  });

  describe("status", () => {
    it("should calculate status correctly");
  });
});
```

### Step 5.2: Update existing tests

Migrate tests that use Repository + StagingStore to use WorkingCopy.

## Phase 6: Documentation

### Step 6.1: Update package README

Document the separation of concerns:

```markdown
## Core Concepts

### Repository
Shared history storage. Contains immutable objects and shared refs.

### WorkingCopy
Local checkout state. Links a working directory to a Repository.
Multiple WorkingCopies can share one Repository.
```

### Step 6.2: Add JSDoc examples

```typescript
/**
 * @example
 * ```typescript
 * // Open a working copy
 * const wc = await factory.openWorkingCopy("./project", "./.git");
 *
 * // Check status
 * const status = await wc.getStatus();
 *
 * // Stage files
 * await addCommand.execute(wc, ["src/file.ts"]);
 *
 * // Access repository for history operations
 * const commit = await wc.repository.commits.get(commitId);
 * ```
 */
```

## File Summary

New files to create:

| File | Purpose |
|------|---------|
| `core/src/working-copy.ts` | Main interface definition |
| `core/src/working-copy/index.ts` | Module exports |
| `core/src/working-copy/working-copy.files.ts` | File-based implementation |
| `core/src/working-copy/working-copy.memory.ts` | In-memory implementation |
| `core/src/working-copy/working-copy-factory.files.ts` | File-based factory |
| `core/src/working-copy/merge-state-reader.ts` | Parse .git/MERGE_* files |
| `core/src/working-copy/rebase-state-reader.ts` | Parse rebase state |
| `core/src/working-copy/stash-store.ts` | StashStore interface |
| `core/src/working-copy/stash-store.files.ts` | File-based stash (uses refs/stash) |
| `core/src/working-copy/stash-store.memory.ts` | In-memory stash for testing |
| `core/src/working-copy/working-copy-config.ts` | WorkingCopyConfig implementation |

Files to modify:

| File | Changes |
|------|---------|
| `core/src/index.ts` | Export working-copy module |
| `core/src/repository.ts` | Update documentation |
| `core/src/commands/add.command.ts` | Accept WorkingCopy |
| `core/src/commands/checkout.command.ts` | Accept WorkingCopy |
| `core/src/status/status-calculator.ts` | Work with WorkingCopy |

## Migration Strategy

1. **Phase 1**: Add WorkingCopy interface (non-breaking)
2. **Phase 2**: Add implementations (non-breaking)
3. **Phase 3**: Deprecate old patterns, add new (soft migration)
4. **Phase 4**: Update all commands to use WorkingCopy
5. **Phase 5**: Remove deprecated patterns

This approach allows gradual migration without breaking existing code.

## Design Decisions

1. **refs/stash**: Stash operations accessible via WorkingCopy
   - **Interface**: Stash operations exposed through `WorkingCopy.stash` property
   - **Implementation**: Backend-dependent storage
     - File-based Git: Store in central `.git/refs/stash` for Git compatibility
     - Other backends (SQL, KV): May use separate per-working-copy stash area
   - This separates the interface (where you access stash) from storage (where data lives)

2. **Config**: WorkingCopy has its own config
   - Add `WorkingCopy.config` for local configuration overrides
   - Git supports per-worktree config in `.git/worktrees/NAME/config`
   - Allows working-copy-specific settings (e.g., sparse checkout patterns)

3. **Hooks**: Repository-level, with future worktree override
   - Keep hooks with Repository for now
   - Add worktree-level override capability later (via `core.hooksPath` equivalent)
