# Production Commands Implementation Plan

This document details the implementation plan for commands missing for production use, leveraging existing VCS code where possible.

---

## Architectural Constraints

### Porcelain API Layer Separation

**CRITICAL: The `@statewalker/vcs-commands` package (porcelain API) must use EXCLUSIVELY APIs from these packages:**

| Package | Purpose | Example APIs |
|---------|---------|--------------|
| `@statewalker/vcs-core` | All VCS primitives | `Repository`, `CommitStore`, `TreeStore`, `RefStore`, `GCController`, `StatusCalculator` |
| `@statewalker/vcs-transport` | Network operations | `HttpTransport`, `PackProtocol`, `fetchPack`, `sendPack` |
| `@statewalker/vcs-utils` | Low-level utilities | `sha1`, `inflate`, `deflate`, `createDelta` |

**Prohibited:**
- Direct filesystem access (use `FilesApi` from core)
- Direct network calls (use transport abstractions)
- Storage backend implementations (use store interfaces)

### Dependency Direction

```
┌─────────────────────────────────────────────────┐
│                  Applications                    │
└─────────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────┐
│          @statewalker/vcs-commands (porcelain)       │
│  GarbageCollectCommand, CleanCommand, etc.      │
└─────────────────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌─────────────┐ ┌─────────────┐
│ @webrun-vcs/ │ │ @webrun-vcs/│ │ @webrun-vcs/│
│    core      │ │  transport  │ │    utils    │
└──────────────┘ └─────────────┘ └─────────────┘
```

### Implementation Pattern

All porcelain commands follow this pattern:

```typescript
// packages/commands/src/commands/example-command.ts
import {
  type Repository,
  type CommitStore,
  // ... other core types
} from "@statewalker/vcs-core";

export class ExampleCommand {
  constructor(private readonly repository: Repository) {}

  async call(): Promise<Result> {
    // Use ONLY repository methods and core APIs
    // NO direct fs/network calls
    const commits = this.repository.commits;
    const refs = this.repository.refs;
    // ...
  }
}
```

This ensures:
1. **Portability** - Commands work with any storage backend (file, SQL, memory, browser)
2. **Testability** - Easy to mock core interfaces
3. **Consistency** - Single source of truth for VCS operations

---

## Executive Summary

**Existing Infrastructure (Ready to Use):**
- `GCController` with `runGC()`, `repack()`, `quickPack()` - [gc-controller.ts](packages/core/src/delta/gc-controller.ts)
- `PackingOrchestrator` with sliding window deltification - [packing-orchestrator.ts](packages/core/src/delta/packing-orchestrator.ts)
- `packRefs()` function already implemented - [packed-refs-writer.ts](packages/core/src/refs/packed-refs-writer.ts)
- `StatusCalculator` with untracked file detection - [status-calculator.ts](packages/core/src/status/status-calculator.ts)
- `WorkingTreeIterator` for filesystem traversal - [working-tree-iterator.ts](packages/core/src/worktree/working-tree-iterator.ts)

**Core Prerequisites (FIXME in existing code):**

| Location | FIXME | Description |
|----------|-------|-------------|
| [gc-controller.ts:435](packages/core/src/delta/gc-controller.ts) | `collectGarbage()` | Reachability-based pruning not implemented |

**Commands to Implement:**

| Command | Priority | Complexity | Existing Code Reuse | Prerequisite |
|---------|----------|------------|---------------------|--------------|
| `gc` | High | Medium | GCController (90% done) | Complete `collectGarbage()` |
| `pack-refs` | Medium | Low | packRefs() exists | None |
| `reflog` | High | Medium | New (format only) | None |
| `clean` | Medium | Low | StatusCalculator exists | None |
| `blame` | Low | High | New algorithm needed | None |

---

## 0. Core Prerequisites (FIXME Implementation)

Before implementing porcelain commands, the following FIXME-marked code in `@statewalker/vcs-core` must be completed.

### 0.1 Complete `collectGarbage()` in GCController

**File:** `packages/core/src/delta/gc-controller.ts:429-457`

**Current State (FIXME):**
```typescript
// FIXME: Not implemented garbage collection using reachability
// Note: This requires CommitStore and TreeStore access
```

**JGit Reference:**
- [GC.java:547-699](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/GC.java) - `prune()` method

**Problem:** The `collectGarbage()` method currently returns empty results. It needs to:
1. Walk from ref roots to find all reachable objects
2. Identify unreachable objects
3. Delete unreachable objects respecting expiration time

**Implementation:**

```typescript
/**
 * Remove unreachable objects from storage
 *
 * Walks the object graph from all ref roots to determine reachability,
 * then deletes any objects not reachable and older than the expiration time.
 *
 * @param roots Commit IDs to start reachability walk from
 * @param commits CommitStore for reading commit objects
 * @param trees TreeStore for reading tree objects
 * @param expire Optional expiration date - only delete objects older than this
 */
async collectGarbage(
  roots: ObjectId[],
  commits: CommitStore,
  trees: TreeStore,
  expire?: Date
): Promise<GCResult> {
  const startTime = Date.now();
  const expireTime = expire?.getTime() ?? 0;

  // 1. Find all reachable objects by walking from roots
  const reachable = new Set<string>();

  for (const root of roots) {
    await this.walkCommit(root, commits, trees, reachable);
  }

  // 2. Find and delete unreachable objects
  let objectsRemoved = 0;
  let bytesFreed = 0;

  for await (const id of this.storage.keys()) {
    if (reachable.has(id)) {
      continue; // Object is reachable, keep it
    }

    // Check expiration time if set
    if (expireTime > 0) {
      const mtime = await this.storage.getModificationTime?.(id);
      if (mtime && mtime.getTime() >= expireTime) {
        continue; // Object is too new, keep it
      }
    }

    // Delete unreachable object
    const size = await this.storage.size(id);
    await this.storage.delete(id);
    objectsRemoved++;
    bytesFreed += size;
  }

  return {
    objectsRemoved,
    bytesFreed,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Walk a commit and all its ancestors, marking objects as reachable
 */
private async walkCommit(
  commitId: ObjectId,
  commits: CommitStore,
  trees: TreeStore,
  reachable: Set<string>
): Promise<void> {
  if (reachable.has(commitId)) return;
  reachable.add(commitId);

  const commit = await commits.get(commitId);
  if (!commit) return;

  // Mark tree and all children
  await this.walkTree(commit.tree, trees, reachable);

  // Walk parent commits (recursive)
  for (const parent of commit.parents) {
    await this.walkCommit(parent, commits, trees, reachable);
  }
}

/**
 * Walk a tree and all its entries, marking objects as reachable
 */
private async walkTree(
  treeId: ObjectId,
  trees: TreeStore,
  reachable: Set<string>
): Promise<void> {
  if (reachable.has(treeId)) return;
  reachable.add(treeId);

  const tree = await trees.get(treeId);
  if (!tree) return;

  for (const entry of tree.entries) {
    reachable.add(entry.id);
    if (entry.mode === FileMode.TREE) {
      await this.walkTree(entry.id, trees, reachable);
    }
    // Blobs are already marked, no need to recurse
  }
}
```

**Additional Requirements:**

1. **Add `getModificationTime()` to storage interface** (optional, for expiration support):
   ```typescript
   interface RawStoreWithDelta {
     // ... existing methods ...
     getModificationTime?(id: ObjectId): Promise<Date | undefined>;
   }
   ```

2. **Handle tags in reachability walk:**
   ```typescript
   // If a ref points to a tag, walk the tag's target
   if (objectType === 'tag') {
     const tag = await tags.get(id);
     if (tag?.target) {
       await this.walkCommit(tag.target, commits, trees, reachable);
     }
   }
   ```

3. **Consider index objects** (like JGit's `listNonHEADIndexObjects()`):
   Objects referenced by the staging area should also be kept.

**Complexity:** Medium - Requires traversing the entire object graph, but algorithm is straightforward.

---

## 1. GarbageCollectCommand

### JGit Reference
- [GarbageCollectCommand.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/GarbageCollectCommand.java)
- [GC.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/GC.java)

### Existing VCS Code
- [gc-controller.ts](packages/core/src/delta/gc-controller.ts) - Core GC logic
- [packing-orchestrator.ts](packages/core/src/delta/packing-orchestrator.ts) - Deltification
- [pack-consolidator.ts](packages/core/src/pack/pack-consolidator.ts) - Pack merging

### Prerequisites

**Must complete first:**
- Section 0.1: Complete `collectGarbage()` in GCController

### Implementation

The `GCController` already implements most of the GC functionality. After completing the prerequisite above, the porcelain command is a thin wrapper.

#### 1.1 Create GarbageCollectCommand

**File:** `packages/commands/src/commands/gc-command.ts`

```typescript
import type {
  Repository,
  GCController,
  RefStore,
  ProgressMonitor,
  GCOptions,
  GCStatistics,
} from "@statewalker/vcs-core";

/**
 * Garbage collection command
 *
 * JGit ref: org.eclipse.jgit.api.GarbageCollectCommand
 *
 * Uses ONLY:
 * - Repository.gc (GCController interface)
 * - Repository.refs (RefStore interface)
 * - Repository.commits, Repository.trees (for reachability walk)
 */
export class GarbageCollectCommand {
  private progressMonitor?: ProgressMonitor;
  private expire?: Date;
  private aggressive = false;
  private pruneLoose = true;
  private auto = false;

  constructor(private readonly repository: Repository) {}

  setProgressMonitor(monitor: ProgressMonitor): this {
    this.progressMonitor = monitor;
    return this;
  }

  setExpire(expire: Date): this {
    this.expire = expire;
    return this;
  }

  setAggressive(aggressive: boolean): this {
    this.aggressive = aggressive;
    return this;
  }

  setAuto(auto: boolean): this {
    this.auto = auto;
    return this;
  }

  setPruneLoose(prune: boolean): this {
    this.pruneLoose = prune;
    return this;
  }

  async call(): Promise<GCStatistics> {
    // 1. Check if GC needed (auto mode)
    if (this.auto) {
      const shouldRun = await this.repository.gc.shouldRunGC();
      if (!shouldRun) {
        return this.getStatistics();
      }
    }

    // 2. Pack refs via RefStore interface
    await this.repository.refs.packRefs([], { all: true, deleteLoose: true });

    // 3. Repack and prune via GCController interface
    const gcOptions: GCOptions = {
      pruneLoose: this.pruneLoose,
      expire: this.expire,
      aggressive: this.aggressive,
      progressCallback: this.progressMonitor?.update,
    };

    const result = await this.repository.gc.runGC(gcOptions);

    // 4. Collect garbage (prune unreachable objects)
    const roots = await this.getAllRefTargets();
    await this.repository.gc.collectGarbage(
      roots,
      this.repository.commits,
      this.repository.trees
    );

    return this.buildStatistics(result);
  }

  private async getAllRefTargets(): Promise<string[]> {
    const roots: string[] = [];
    for await (const refName of this.repository.refs.list()) {
      const ref = await this.repository.refs.resolve(refName);
      if (ref?.objectId) {
        roots.push(ref.objectId);
      }
    }
    return roots;
  }

  async getStatistics(): Promise<GCStatistics> {
    // Use Repository.objects to gather statistics
    // ...
  }

  private buildStatistics(result: RepackResult): GCStatistics {
    // ...
  }
}
```

#### 1.2 GC Options Interface

**File:** `packages/commands/src/commands/gc-command.ts`

```typescript
export interface GCOptions {
  /** Object expiration time (default: 2 weeks) */
  expire?: Date;
  /** Aggressive mode with deeper deltification */
  aggressive?: boolean;
  /** Prune loose objects after packing */
  pruneLoose?: boolean;
  /** Auto mode - only run if thresholds exceeded */
  auto?: boolean;
  /** Progress callback */
  progressCallback?: (progress: GCProgress) => void;
}

export interface GCStatistics {
  numberOfLooseObjects: number;
  numberOfPackedObjects: number;
  numberOfPackFiles: number;
  sizeOfLooseObjects: number;
  sizeOfPackedObjects: number;
  objectsRemoved: number;
  bytesFreed: number;
  durationMs: number;
}
```

### JGit GC Flow (for reference)

```
gc() → doGc()
  ├── needGc() check (if automatic)
  ├── PID lock acquisition
  ├── PackRefsCommand.call()
  ├── repack()
  │   ├── findObjectsToPack()
  │   ├── writePack()
  │   └── deleteOldPacks()
  ├── prune()
  │   ├── find unreferenced objects
  │   ├── check expiration date
  │   └── delete from objects/ directory
  └── writeCommitGraph() (optional)
```

---

## 2. PackRefsCommand

### JGit Reference
- [PackRefsCommand.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/PackRefsCommand.java)

### Existing VCS Code
- [packed-refs-writer.ts](packages/core/src/refs/packed-refs-writer.ts) - `packRefs()` already implemented!
- [packed-refs-reader.ts](packages/core/src/refs/packed-refs-reader.ts) - Reading packed refs
- [ref-store.files.ts](packages/core/src/refs/ref-store.files.ts) - File-based ref store

### Implementation

The core `packRefs()` function already exists. Just need a command wrapper.

#### 2.1 Create PackRefsCommand

**File:** `packages/commands/src/commands/pack-refs-command.ts`

```typescript
import type { Repository, RefStore, ProgressMonitor } from "@statewalker/vcs-core";

/**
 * Pack loose references into packed-refs
 *
 * JGit ref: org.eclipse.jgit.api.PackRefsCommand
 *
 * Uses ONLY: Repository.refs (RefStore interface)
 */
export class PackRefsCommand {
  private all = false;
  private progressMonitor?: ProgressMonitor;

  constructor(private readonly repository: Repository) {}

  /** Pack all loose refs */
  setAll(all: boolean): this {
    this.all = all;
    return this;
  }

  setProgressMonitor(monitor: ProgressMonitor): this {
    this.progressMonitor = monitor;
    return this;
  }

  async call(): Promise<string> {
    // Get all loose ref names via RefStore interface
    const looseRefs: string[] = [];

    if (this.all) {
      // Use RefStore.list() - part of core API
      for await (const refName of this.repository.refs.list()) {
        const ref = await this.repository.refs.resolve(refName);
        if (ref && !ref.symbolic) {
          looseRefs.push(refName);
        }
      }
    }

    // Use RefStore.packRefs() - must be added to RefStore interface in core
    await this.repository.refs.packRefs(looseRefs, { deleteLoose: true });

    return "pack-refs completed successfully";
  }
}
```

**Note:** Requires adding `packRefs()` method to `RefStore` interface in core package.

**Complexity: Low** - The core logic already exists in `packed-refs-writer.ts:151-177`.

---

## 3. ReflogCommand

### JGit Reference
- [ReflogCommand.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/ReflogCommand.java)
- [ReflogReaderImpl.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ReflogReaderImpl.java)
- [ReflogEntryImpl.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ReflogEntryImpl.java)

### Reflog File Format

Location: `.git/logs/<refname>` (e.g., `.git/logs/HEAD`, `.git/logs/refs/heads/main`)

Each line format:
```
<old-sha> <new-sha> <committer-ident> <timestamp> <timezone>\t<message>
```

Example:
```
0000000000000000000000000000000000000000 abc123... John <john@example.com> 1703936400 +0000	commit (initial): Initial commit
abc123... def456... John <john@example.com> 1703936500 +0000	commit: Add feature
def456... abc123... John <john@example.com> 1703936600 +0000	reset: moving to HEAD~1
```

### Implementation

#### 3.1 Core Reflog Types

**File:** `packages/core/src/refs/reflog-types.ts`

```typescript
import type { ObjectId } from "../id/index.js";
import type { PersonIdent } from "../commits/index.js";

/**
 * Single reflog entry
 *
 * JGit ref: org.eclipse.jgit.lib.ReflogEntry
 */
export interface ReflogEntry {
  /** SHA before the change (0000... for new refs) */
  oldId: ObjectId;
  /** SHA after the change */
  newId: ObjectId;
  /** Who made the change */
  who: PersonIdent;
  /** Reason for the change (e.g., "commit: Add feature") */
  comment: string;
}

/**
 * Checkout-specific info in reflog
 */
export interface CheckoutEntry {
  /** Branch switched from */
  fromBranch: string;
  /** Branch switched to */
  toBranch: string;
}
```

#### 3.2 Reflog Reader

**File:** `packages/core/src/refs/reflog-reader.ts`

```typescript
import type { FilesApi } from "../files/index.js";
import type { ReflogEntry } from "./reflog-types.js";
import { parsePersonIdent } from "../commits/index.js";

const LOGS_DIR = "logs";
const ZERO_ID = "0".repeat(40);

/**
 * Reflog reader interface
 *
 * JGit ref: org.eclipse.jgit.lib.ReflogReader
 */
export interface ReflogReader {
  /** Get the most recent entry */
  getLastEntry(): Promise<ReflogEntry | undefined>;

  /** Get entries in reverse chronological order */
  getReverseEntries(max?: number): Promise<ReflogEntry[]>;

  /** Get specific entry by index (0 = most recent) */
  getReverseEntry(number: number): Promise<ReflogEntry | undefined>;
}

/**
 * Create reflog reader for a ref
 */
export function createReflogReader(
  files: FilesApi,
  gitDir: string,
  refName: string
): ReflogReader {
  const logPath = refName === "HEAD"
    ? joinPath(gitDir, LOGS_DIR, "HEAD")
    : joinPath(gitDir, LOGS_DIR, refName);

  return new ReflogReaderImpl(files, logPath);
}

class ReflogReaderImpl implements ReflogReader {
  constructor(
    private readonly files: FilesApi,
    private readonly logPath: string
  ) {}

  async getLastEntry(): Promise<ReflogEntry | undefined> {
    return this.getReverseEntry(0);
  }

  async getReverseEntries(max = Number.MAX_SAFE_INTEGER): Promise<ReflogEntry[]> {
    const content = await this.readLog();
    if (!content) return [];

    const lines = content.trim().split("\n").reverse();
    const entries: ReflogEntry[] = [];

    for (const line of lines.slice(0, max)) {
      const entry = parseReflogEntry(line);
      if (entry) entries.push(entry);
    }

    return entries;
  }

  async getReverseEntry(number: number): Promise<ReflogEntry | undefined> {
    const entries = await this.getReverseEntries(number + 1);
    return entries[number];
  }

  private async readLog(): Promise<string | undefined> {
    try {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.files.read(this.logPath)) {
        chunks.push(chunk);
      }
      return new TextDecoder().decode(concat(chunks));
    } catch {
      return undefined;
    }
  }
}

/**
 * Parse single reflog line
 */
function parseReflogEntry(line: string): ReflogEntry | undefined {
  // Format: <old> <new> <ident>\t<message>
  const tabIndex = line.indexOf("\t");
  if (tabIndex < 0) return undefined;

  const header = line.slice(0, tabIndex);
  const comment = line.slice(tabIndex + 1);

  const parts = header.split(" ");
  if (parts.length < 3) return undefined;

  const oldId = parts[0];
  const newId = parts[1];
  const identStr = parts.slice(2).join(" ");

  const who = parsePersonIdent(identStr);
  if (!who) return undefined;

  return { oldId, newId, who, comment };
}
```

#### 3.3 Reflog Writer

**File:** `packages/core/src/refs/reflog-writer.ts`

```typescript
import type { FilesApi } from "../files/index.js";
import type { ObjectId } from "../id/index.js";
import type { PersonIdent } from "../commits/index.js";
import { formatPersonIdent } from "../commits/index.js";

const LOGS_DIR = "logs";
const ZERO_ID = "0".repeat(40);

/**
 * Append entry to reflog
 *
 * JGit ref: org.eclipse.jgit.internal.storage.file.RefDirectory.log()
 */
export async function appendReflog(
  files: FilesApi,
  gitDir: string,
  refName: string,
  oldId: ObjectId | undefined,
  newId: ObjectId,
  who: PersonIdent,
  message: string
): Promise<void> {
  const logPath = refName === "HEAD"
    ? joinPath(gitDir, LOGS_DIR, "HEAD")
    : joinPath(gitDir, LOGS_DIR, refName);

  // Ensure parent directory exists
  await files.mkdir(dirname(logPath), { recursive: true });

  // Format entry line
  const old = oldId ?? ZERO_ID;
  const identStr = formatPersonIdent(who);
  const line = `${old} ${newId} ${identStr}\t${message}\n`;

  // Append to log file
  await files.append(logPath, [new TextEncoder().encode(line)]);
}
```

#### 3.4 ReflogCommand

**File:** `packages/commands/src/commands/reflog-command.ts`

```typescript
import type { Repository, ReflogEntry } from "@statewalker/vcs-core";

/**
 * Reflog command
 *
 * JGit ref: org.eclipse.jgit.api.ReflogCommand
 *
 * Uses ONLY: Repository.refs.getReflog() (RefStore interface)
 */
export class ReflogCommand {
  private ref = "HEAD";

  constructor(private readonly repository: Repository) {}

  /** Set ref to show reflog for (default: HEAD) */
  setRef(ref: string): this {
    this.ref = ref;
    return this;
  }

  async call(): Promise<ReflogEntry[]> {
    // Use RefStore.getReflog() - must be added to RefStore interface
    const reader = await this.repository.refs.getReflog(this.ref);
    if (!reader) {
      throw new Error(`reflog not found for ${this.ref}`);
    }

    return reader.getReverseEntries();
  }
}
```

**Note:** Requires adding `getReflog(refName: string)` method to `RefStore` interface in core.

#### 3.5 Integration with Ref Updates

Modify ref update operations to write reflog entries:

**File:** `packages/core/src/refs/ref-writer.ts` (modify existing)

Add reflog writes to `updateRef()`, `createRef()`, `deleteRef()` functions:

```typescript
// After successful ref update:
await appendReflog(
  files, gitDir, refName,
  oldId, newId,
  committer,
  `${operation}: ${message}`  // e.g., "commit: Add feature"
);
```

---

## 4. CleanCommand

### JGit Reference
- [CleanCommand.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/CleanCommand.java)

### Existing VCS Code
- [status-calculator.ts](packages/core/src/status/status-calculator.ts) - Detects untracked files via `FileStatus.UNTRACKED`
- [status-calculator.impl.ts](packages/core/src/status/status-calculator.impl.ts) - Implementation
- [working-tree-iterator.ts](packages/core/src/worktree/working-tree-iterator.ts) - Filesystem traversal
- [ignore/](packages/core/src/ignore/) - .gitignore pattern matching

### Implementation

The status calculator already identifies untracked files. Just need to add deletion logic.

#### 4.1 CleanCommand

**File:** `packages/commands/src/commands/clean-command.ts`

```typescript
import type {
  Repository,
  WorkingCopy,
  StatusCalculator,
  FileStatus,
  WorkingTreeApi,
} from "@statewalker/vcs-core";

/**
 * Remove untracked files from working tree
 *
 * JGit ref: org.eclipse.jgit.api.CleanCommand
 *
 * Uses ONLY:
 * - WorkingCopy.status (StatusCalculator interface)
 * - WorkingCopy.workTree (WorkingTreeApi interface)
 */
export class CleanCommand {
  private paths = new Set<string>();
  private dryRun = false;
  private directories = false;
  private ignore = true;  // Respect .gitignore
  private force = false;  // Required to delete git repos

  constructor(private readonly workingCopy: WorkingCopy) {}

  /** Limit clean to specific paths */
  setPaths(paths: Set<string>): this {
    this.paths = paths;
    return this;
  }

  /** Preview without deleting */
  setDryRun(dryRun: boolean): this {
    this.dryRun = dryRun;
    return this;
  }

  /** Also clean directories */
  setCleanDirectories(dirs: boolean): this {
    this.directories = dirs;
    return this;
  }

  /** Respect .gitignore patterns (default: true) */
  setIgnore(ignore: boolean): this {
    this.ignore = ignore;
    return this;
  }

  /** Force deletion of nested git repos */
  setForce(force: boolean): this {
    this.force = force;
    return this;
  }

  async call(): Promise<Set<string>> {
    const cleaned = new Set<string>();

    // Use StatusCalculator from core API
    const status = await this.workingCopy.status.calculateStatus({
      includeUntracked: true,
      includeIgnored: !this.ignore,
    });

    // Filter to untracked files/directories
    const untracked = status.files.filter(
      f => f.workTreeStatus === FileStatus.UNTRACKED
    );

    // Use WorkingTreeApi from core for file operations
    const workTree = this.workingCopy.workTree;

    for (const file of untracked) {
      // Filter by paths if specified
      if (this.paths.size > 0 && !this.paths.has(file.path)) {
        continue;
      }

      const isDir = await workTree.isDirectory(file.path);

      // Skip directories unless -d flag set
      if (isDir && !this.directories) {
        continue;
      }

      // Check for nested git repos
      if (isDir) {
        const hasGit = await workTree.exists(`${file.path}/.git`);
        if (hasGit && !this.force) {
          continue;  // Skip git repos unless forced
        }
      }

      if (!this.dryRun) {
        await workTree.remove(file.path, { recursive: isDir });
      }

      cleaned.add(isDir ? `${file.path}/` : file.path);
    }

    return cleaned;
  }
}
```

**Note:** Uses `WorkingCopy` (which wraps a `Repository`) to access status and working tree APIs. All file operations go through `WorkingTreeApi` interface from core.

**Complexity: Low** - Uses existing status calculation.

---

## 5. BlameCommand (Lower Priority)

### JGit Reference
- [BlameCommand.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/BlameCommand.java)
- [BlameGenerator.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/blame/BlameGenerator.java)
- [BlameResult.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/blame/BlameResult.java)
- [Candidate.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/blame/Candidate.java)
- [Region.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/blame/Region.java)

### Algorithm Overview

JGit's blame uses a reverse-walking algorithm:
1. Start with the file content at the target commit
2. Walk backwards through history
3. For each parent commit, diff the file versions
4. Assign blame to lines that changed

**Key classes:**
- `BlameGenerator` - Core algorithm using ObjectWalk
- `Candidate` - Represents a potential blame source (commit + file)
- `Region` - Contiguous range of lines from same source

### Implementation Outline

**Files to create:**
- `packages/core/src/blame/blame-generator.ts`
- `packages/core/src/blame/blame-result.ts`
- `packages/core/src/blame/region.ts`
- `packages/commands/src/commands/blame-command.ts`

**Algorithm:**
```typescript
async* blame(path: string, startCommit: ObjectId): AsyncIterable<BlameLine> {
  // 1. Get file content at startCommit
  const content = await getFileContent(startCommit, path);
  const lines = content.split("\n");

  // 2. Initialize all lines as "unblamed" regions
  const regions: Region[] = [{ start: 0, end: lines.length, source: undefined }];

  // 3. Walk commit history
  for await (const commit of walkHistory(startCommit)) {
    // 4. For each parent, diff file versions
    for (const parentId of commit.parents) {
      const parentContent = await getFileContent(parentId, path);
      const diff = computeDiff(parentContent, content);

      // 5. Lines that didn't change came from parent
      // 6. Lines that changed are blamed on this commit
      updateRegions(regions, diff, commit);
    }

    // 7. Stop when all lines are blamed
    if (allLinesBlamed(regions)) break;
  }

  // 8. Return blame for each line
  for (let i = 0; i < lines.length; i++) {
    yield { line: i, content: lines[i], commit: findSource(regions, i) };
  }
}
```

**Complexity: High** - Requires new diff-based algorithm. Consider deferring.

---

## Implementation Order

### Phase 0: Core Prerequisites (Must Complete First)

Complete FIXME-marked code in `@statewalker/vcs-core` before porcelain commands:

1. **GCController.collectGarbage()** - Implement reachability-based object pruning
   - File: `packages/core/src/delta/gc-controller.ts:429-457`
   - Add `walkCommit()` and `walkTree()` helper methods
   - Add optional `getModificationTime()` to storage interface
   - Handle tags in reachability walk

### Phase 1: High Priority

2. **GarbageCollectCommand** - Thin wrapper around completed GCController
3. **ReflogCommand** - New reflog reader/writer, integrate with ref updates

### Phase 2: Medium Priority

4. **PackRefsCommand** - Simple wrapper around existing `packRefs()`
5. **CleanCommand** - Uses existing status calculator

### Phase 3: Lower Priority (Future)

6. **BlameCommand** - New algorithm, can defer

---

## Testing Strategy

### GC Tests

```typescript
describe("GarbageCollectCommand", () => {
  it("should repack loose objects", async () => {
    // Create repo with many loose objects
    // Run gc
    // Verify pack file created, loose objects removed
  });

  it("should prune unreachable objects", async () => {
    // Create objects, then reset to remove refs
    // Run gc with expire=now
    // Verify unreachable objects deleted
  });

  it("should respect expiration time", async () => {
    // Create unreachable objects
    // Run gc with future expire date
    // Verify objects NOT deleted
  });
});
```

### Reflog Tests

```typescript
describe("ReflogCommand", () => {
  it("should record commits", async () => {
    // Make several commits
    // Read reflog
    // Verify entries match commit history
  });

  it("should record resets", async () => {
    // Reset HEAD
    // Verify reflog entry with "reset" message
  });

  it("should support ref@{n} syntax", async () => {
    // Multiple commits
    // Resolve HEAD@{1}, HEAD@{2}
    // Verify correct commits returned
  });
});
```

---

## File Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `packages/commands/src/commands/gc-command.ts` | GC command wrapper |
| `packages/commands/src/commands/pack-refs-command.ts` | Pack refs command |
| `packages/commands/src/commands/reflog-command.ts` | Reflog command |
| `packages/commands/src/commands/clean-command.ts` | Clean command |
| `packages/core/src/refs/reflog-types.ts` | Reflog type definitions |
| `packages/core/src/refs/reflog-reader.ts` | Read reflog files |
| `packages/core/src/refs/reflog-writer.ts` | Write reflog entries |

### Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/delta/gc-controller.ts` | Complete `collectGarbage()` |
| `packages/core/src/refs/ref-writer.ts` | Add reflog writes |
| `packages/core/src/refs/index.ts` | Export reflog modules |
| `packages/commands/src/commands/index.ts` | Export new commands |
| `packages/commands/src/git.ts` | Add `gc()`, `packRefs()`, `reflog()`, `clean()` methods |

---

## Required Core API Additions

To maintain the architectural constraint that porcelain commands use ONLY core/transport/utils APIs, the following additions are needed in `@statewalker/vcs-core`:

### RefStore Interface Additions

**File:** `packages/core/src/refs/ref-store.ts`

```typescript
export interface RefStore {
  // ... existing methods ...

  /**
   * Pack loose refs into packed-refs file
   *
   * @param refNames Specific refs to pack, or empty for all (if options.all)
   * @param options Pack options
   */
  packRefs(refNames: string[], options?: {
    all?: boolean;
    deleteLoose?: boolean;
  }): Promise<void>;

  /**
   * Get reflog reader for a ref
   *
   * @param refName Ref name (e.g., "HEAD", "refs/heads/main")
   * @returns Reflog reader or undefined if no reflog exists
   */
  getReflog(refName: string): Promise<ReflogReader | undefined>;
}
```

### Repository Interface Additions

**File:** `packages/core/src/repository.ts`

```typescript
export interface Repository {
  // ... existing properties ...

  /** Garbage collection controller */
  readonly gc: GCController;
}
```

### WorkingCopy Interface Additions

**File:** `packages/core/src/working-copy.ts`

```typescript
export interface WorkingCopy {
  // ... existing properties ...

  /** Status calculator for working tree */
  readonly status: StatusCalculator;

  /** Working tree file operations */
  readonly workTree: WorkingTreeApi;
}
```

### WorkingTreeApi Interface (New)

**File:** `packages/core/src/worktree/working-tree-api.ts`

```typescript
/**
 * Working tree file operations interface
 *
 * Provides file operations relative to the working tree root.
 * Used by porcelain commands that need to modify the working tree.
 */
export interface WorkingTreeApi {
  /** Check if path exists */
  exists(path: string): Promise<boolean>;

  /** Check if path is a directory */
  isDirectory(path: string): Promise<boolean>;

  /** Remove file or directory */
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;

  /** Read file content */
  read(path: string): AsyncIterable<Uint8Array>;

  /** Write file content */
  write(path: string, content: AsyncIterable<Uint8Array>): Promise<void>;

  /** List directory contents */
  list(path: string): AsyncIterable<string>;
}
```

### Summary of API Changes

| Interface | Method/Property | Purpose |
|-----------|-----------------|---------|
| `RefStore` | `packRefs()` | Pack loose refs (for PackRefsCommand, GC) |
| `RefStore` | `getReflog()` | Read reflog entries (for ReflogCommand) |
| `Repository` | `gc` | Access GCController (for GarbageCollectCommand) |
| `WorkingCopy` | `status` | Access StatusCalculator (for CleanCommand) |
| `WorkingCopy` | `workTree` | Access WorkingTreeApi (for CleanCommand) |
| `WorkingTreeApi` | (new interface) | Working tree file operations |

These additions ensure porcelain commands can be implemented using only core APIs, maintaining clean architecture and storage-backend independence.

---

## References

### JGit Source Files

- GC: `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/GC.java`
- GarbageCollectCommand: `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/GarbageCollectCommand.java`
- PackRefsCommand: `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/PackRefsCommand.java`
- ReflogCommand: `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/ReflogCommand.java`
- ReflogReaderImpl: `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/ReflogReaderImpl.java`
- CleanCommand: `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/api/CleanCommand.java`
- BlameGenerator: `tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/blame/BlameGenerator.java`

### VCS Source Files

- GCController: `packages/core/src/delta/gc-controller.ts`
- PackingOrchestrator: `packages/core/src/delta/packing-orchestrator.ts`
- packRefs: `packages/core/src/refs/packed-refs-writer.ts:151-177`
- StatusCalculator: `packages/core/src/status/status-calculator.ts`
- WorkingTreeIterator: `packages/core/src/worktree/working-tree-iterator.ts`
