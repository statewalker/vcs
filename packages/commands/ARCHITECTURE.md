# @statewalker/vcs-commands Architecture

This document explains the internal architecture of the commands package, covering the command pattern implementation, class hierarchy, and integration with core stores and transport.

## Design Philosophy

### JGit-Inspired Command Pattern

The package mirrors Eclipse JGit's approach to Git operations. Each operation becomes a command object that you configure before execution. This pattern provides:

- **Discoverability**: IDE autocomplete reveals available options
- **Type safety**: Invalid configurations fail at compile time
- **Single-use semantics**: Commands can't be accidentally reused
- **Testability**: Commands can be inspected before execution

### Fluent Builder API

Commands use method chaining for configuration:

```typescript
await git.commit()
  .setMessage("feat: add login")
  .setAuthor({ name: "Dev", email: "dev@example.com" })
  .setAmend(true)
  .call();
```

Each setter returns `this`, enabling fluent chains. The final `call()` executes the operation and returns the result.

### Store Abstraction

Commands work with abstract store interfaces, not concrete implementations. The `GitStore` interface defines the minimum requirements:

```typescript
interface GitStore {
  blobs: BlobStore;
  trees: TreeStore;
  commits: CommitStore;
  refs: RefStore;
  staging: StagingStore;
  tags?: TagStore;
}
```

This abstraction enables commands to work identically across filesystem, SQL, memory, or cloud storage backends.

## Class Hierarchy

```
GitCommand<T> (abstract base)
├── Local Commands
│   ├── AddCommand
│   ├── CommitCommand
│   ├── StatusCommand
│   ├── CheckoutCommand
│   ├── CreateBranchCommand
│   ├── DeleteBranchCommand
│   ├── ListBranchCommand
│   ├── MergeCommand
│   ├── RebaseCommand
│   ├── ResetCommand
│   ├── CherryPickCommand
│   ├── RevertCommand
│   ├── LogCommand
│   ├── DiffCommand
│   ├── TagCommand
│   ├── DeleteTagCommand
│   ├── ListTagCommand
│   ├── StashCreateCommand
│   ├── StashApplyCommand
│   ├── StashDropCommand
│   ├── StashListCommand
│   └── ...
└── TransportCommand<T> (extends GitCommand)
    ├── FetchCommand
    ├── PushCommand
    ├── PullCommand
    ├── CloneCommand
    ├── LsRemoteCommand
    └── ...
```

### GitCommand Base Class

All commands extend `GitCommand<T>` where `T` is the return type:

```typescript
abstract class GitCommand<T> {
  protected store: GitStore;
  private called: boolean = false;

  constructor(store: GitStore) {
    this.store = store;
  }

  async call(): Promise<T> {
    this.checkCallable();
    this.called = true;
    return this.execute();
  }

  protected abstract execute(): Promise<T>;

  protected checkCallable(): void {
    if (this.called) {
      throw new Error("Command already called");
    }
  }
}
```

The base class provides common utilities:

| Method | Purpose |
|--------|---------|
| `resolveHead()` | Get commit ID that HEAD points to |
| `resolveRef(name)` | Resolve any ref to ObjectId |
| `getCurrentBranch()` | Get current branch name |
| `getRef(name)` | Get raw Ref object |

### Ref Resolution

The base class handles Git's flexible ref syntax:

```typescript
// Direct refs
"refs/heads/main" → refs.get("refs/heads/main")

// Short names
"main" → refs.get("refs/heads/main")
"v1.0.0" → refs.get("refs/tags/v1.0.0")

// Relative refs
"HEAD~1" → parent of HEAD
"HEAD~3" → 3rd ancestor of HEAD
"HEAD^2" → second parent (for merge commits)

// Abbreviated commits
"abc1234" → full commit ID lookup
```

### TransportCommand Extension

Remote operations extend `TransportCommand<T>` which adds:

```typescript
abstract class TransportCommand<T> extends GitCommand<T> {
  protected credentials?: Credentials;
  protected headers?: Record<string, string>;
  protected timeout?: number;
  protected progressCallback?: ProgressCallback;
  protected messageCallback?: MessageCallback;

  setCredentials(creds: Credentials): this { ... }
  setHeaders(headers: Record<string, string>): this { ... }
  setTimeout(ms: number): this { ... }
  setProgressCallback(cb: ProgressCallback): this { ... }
  setMessageCallback(cb: MessageCallback): this { ... }
}
```

## Directory Structure

```
packages/commands/src/
├── index.ts              # Main exports
├── git.ts                # Git facade class
├── git-command.ts        # Base command class
├── transport-command.ts  # Transport command base
├── types.ts              # Core interfaces
├── commands/             # Command implementations
│   ├── index.ts          # Re-exports all commands
│   ├── add.command.ts
│   ├── commit.command.ts
│   ├── checkout.command.ts
│   ├── merge.command.ts
│   ├── fetch.command.ts
│   ├── push.command.ts
│   └── ... (26 total)
├── errors/               # Error types
│   ├── index.ts
│   ├── base-error.ts
│   ├── command-errors.ts
│   ├── ref-errors.ts
│   ├── merge-errors.ts
│   └── ... (13 modules)
└── results/              # Result types
    ├── index.ts
    ├── merge-result.ts
    ├── fetch-result.ts
    ├── push-result.ts
    └── ... (13 modules)
```

### commands/

Each command lives in its own file following the pattern `<name>.command.ts`:

| File | Command | Purpose |
|------|---------|---------|
| `add.command.ts` | AddCommand | Stage files for commit |
| `commit.command.ts` | CommitCommand | Create commits |
| `checkout.command.ts` | CheckoutCommand | Switch branches/restore files |
| `merge.command.ts` | MergeCommand | Merge branches |
| `rebase.command.ts` | RebaseCommand | Rebase commits |
| `reset.command.ts` | ResetCommand | Reset HEAD position |
| `fetch.command.ts` | FetchCommand | Fetch from remote |
| `push.command.ts` | PushCommand | Push to remote |
| `pull.command.ts` | PullCommand | Fetch and merge/rebase |
| `clone.command.ts` | CloneCommand | Clone repository |

### errors/

Error types organized by domain:

| Module | Errors |
|--------|--------|
| `base-error.ts` | `GitApiError` base class |
| `command-errors.ts` | `MissingArgumentError`, `InvalidArgumentError` |
| `ref-errors.ts` | `RefNotFoundError`, `RefAlreadyExistsError` |
| `commit-errors.ts` | `NoMessageError`, `EmptyCommitError` |
| `merge-errors.ts` | `MergeConflictError`, `NotFastForwardError` |
| `checkout-errors.ts` | `CheckoutConflictError` |
| `rebase-errors.ts` | `NoRebaseInProgressError` |
| `stash-errors.ts` | `NoStashError`, `StashDropError` |
| `transport-errors.ts` | `AuthenticationError`, `PushRejectedException` |

### results/

Result types with status enums:

| Module | Types |
|--------|-------|
| `merge-result.ts` | `MergeResult`, `MergeStatus`, `FastForwardMode` |
| `fetch-result.ts` | `FetchResult`, tracking ref updates |
| `push-result.ts` | `PushResult`, `PushStatus`, remote updates |
| `rebase-result.ts` | `RebaseResult`, `RebaseStatus` |
| `cherry-pick-result.ts` | `CherryPickResult` |
| `clone-result.ts` | `CloneResult` |
| `stash-result.ts` | `StashResult` |
| `diff-entry.ts` | `DiffEntry`, file change info |

## Git Facade Class

The `Git` class acts as the entry point and command factory:

```typescript
class Git implements Disposable {
  private store: GitStore;

  // Factory methods
  static wrap(store: GitStore): Git { ... }
  static open(store: GitStore): Git { ... }
  static fromRepository(options: { repository, staging }): Git { ... }

  // Command factories (40+)
  add(): AddCommand { return new AddCommand(this.store); }
  commit(): CommitCommand { return new CommitCommand(this.store); }
  checkout(): CheckoutCommand { return new CheckoutCommand(this.store); }
  // ...

  // Lifecycle
  dispose(): void { ... }
}
```

### Factory Pattern Benefits

Creating commands through the facade:

1. **Consistent initialization**: Commands always get the right store
2. **Discoverable API**: Autocomplete shows all available operations
3. **Future flexibility**: Can add command caching, logging, or interception
4. **Type safety**: Factory methods have correct return types

## Command Implementation Patterns

### Configuration Validation

Commands validate configuration in `call()` before execution:

```typescript
class CommitCommand extends GitCommand<ObjectId> {
  private message?: string;
  private amend: boolean = false;

  async execute(): Promise<ObjectId> {
    if (!this.message && !this.amend) {
      throw new NoMessageError();
    }
    // ... rest of implementation
  }
}
```

### Multi-Step Workflows

Complex operations compose multiple store operations:

```typescript
class CommitCommand extends GitCommand<ObjectId> {
  async execute(): Promise<ObjectId> {
    // 1. Resolve current HEAD
    const headRef = await this.store.refs.resolve("HEAD");
    const parentId = headRef?.objectId;

    // 2. Build tree from staging
    const treeId = await this.store.staging.writeTree(this.store.trees);

    // 3. Create commit object
    const commit: Commit = {
      tree: treeId,
      parents: parentId ? [parentId] : [],
      author: this.author,
      committer: this.committer,
      message: this.message,
    };
    const commitId = await this.store.commits.storeCommit(commit);

    // 4. Update refs
    await this.store.refs.set("refs/heads/main", commitId);

    return commitId;
  }
}
```

### Progress Reporting

Transport commands report progress through callbacks:

```typescript
class FetchCommand extends TransportCommand<FetchResult> {
  async execute(): Promise<FetchResult> {
    return await fetch({
      connection: this.getConnection(),
      storage: this.store,
      wants: this.refSpecs,
      haves: await this.getLocalRefs(),
      onProgress: (phase, completed, total) => {
        this.progressCallback?.({
          phase,
          completed,
          total,
          percent: total > 0 ? (completed / total) * 100 : 0,
        });
      },
    });
  }
}
```

### Result Objects

Commands return structured results, not just success/failure:

```typescript
interface MergeResult {
  status: MergeStatus;
  mergeBase?: ObjectId;
  newHead?: ObjectId;
  conflicts?: string[];
  failedReason?: MergeFailureReason;
}

// Usage
const result = await git.merge().include("feature").call();
if (result.status === MergeStatus.CONFLICTING) {
  for (const path of result.conflicts!) {
    console.log(`Conflict: ${path}`);
  }
}
```

## Integration Points

### Core Store Integration

Commands depend on store interfaces from `@statewalker/vcs-core`:

```
AddCommand
    ↓ uses
StagingStore.editor()     → Stage file changes
BlobStore.store()         → Store file contents
WorktreeStore.walk()      → Read filesystem
IgnoreManager.isIgnored() → Check ignore patterns
```

```
CommitCommand
    ↓ uses
StagingStore.writeTree()  → Build tree from index
CommitStore.storeCommit() → Store commit object
RefStore.set()            → Update branch ref
```

```
MergeCommand
    ↓ uses
CommitStore.findMergeBase() → Find common ancestor
TreeStore.loadTree()        → Load trees to merge
CommitStore.storeCommit()   → Create merge commit
StagingStore.builder()      → Build merged index
```

### Transport Integration

Remote commands delegate to `@statewalker/vcs-transport`:

```
FetchCommand
    ↓ calls
transport.fetch({
  connection,    → HTTPConnection to remote
  storage,       → Local object storage
  wants,         → Refs to fetch
  haves,         → Local refs (for negotiation)
  onProgress,    → Progress callback
})
```

```
PushCommand
    ↓ calls
transport.push({
  connection,    → HTTPConnection to remote
  storage,       → Local object storage
  refs,          → Refs to push
  force,         → Force push flag
  onProgress,    → Progress callback
})
```

### Storage Backend Integration

Use `createGitStore` to bridge between repositories and the commands package:

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

// Create repository from @statewalker/vcs-core
const repository = await createGitRepository();

// Create staging store from any backend
const staging = new MemoryStagingStore();

// Bridge to commands package
const store = createGitStore({ repository, staging });
const git = Git.wrap(store);
```

## Error Handling Strategy

### Exception Hierarchy

All errors extend `GitApiError`:

```typescript
class GitApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

class RefNotFoundError extends GitApiError {
  constructor(public readonly refName: string) {
    super(`Ref not found: ${refName}`);
  }
}
```

### Rich Error Context

Errors carry context for debugging:

```typescript
class MergeConflictError extends GitApiError {
  constructor(
    public readonly conflicts: string[],
    public readonly mergeBase?: ObjectId
  ) {
    super(`Merge conflict in: ${conflicts.join(", ")}`);
  }
}

// Usage
try {
  await git.merge().include("feature").call();
} catch (e) {
  if (e instanceof MergeConflictError) {
    console.log("Conflicts:", e.conflicts);
    console.log("Merge base:", e.mergeBase);
  }
}
```

### Error Categories

| Category | When Thrown |
|----------|-------------|
| **Argument errors** | Missing or invalid command configuration |
| **Ref errors** | Branch/tag doesn't exist or already exists |
| **State errors** | Repository in unexpected state (conflicts, rebase in progress) |
| **Transport errors** | Network failures, auth issues, push rejection |

## Extension Points

### Adding New Commands

Create a new command by extending `GitCommand`:

```typescript
// commands/blame.command.ts
export class BlameCommand extends GitCommand<BlameResult> {
  private path?: string;
  private rev?: string;

  setPath(path: string): this {
    this.path = path;
    return this;
  }

  setRev(rev: string): this {
    this.rev = rev;
    return this;
  }

  protected async execute(): Promise<BlameResult> {
    if (!this.path) {
      throw new MissingArgumentError("path");
    }

    const commitId = await this.resolveRef(this.rev ?? "HEAD");
    // ... implementation
  }
}
```

Add to Git facade:

```typescript
class Git {
  blame(): BlameCommand {
    return new BlameCommand(this.store);
  }
}
```

### Custom Result Types

Define structured results for new commands:

```typescript
// results/blame-result.ts
export interface BlameLine {
  lineNumber: number;
  commitId: ObjectId;
  author: PersonIdent;
  content: string;
}

export interface BlameResult {
  path: string;
  lines: BlameLine[];
}
```

### Custom Error Types

Add domain-specific errors:

```typescript
// errors/blame-errors.ts
export class FileNotInCommitError extends GitApiError {
  constructor(
    public readonly path: string,
    public readonly commitId: ObjectId
  ) {
    super(`File '${path}' not found in commit ${commitId}`);
  }
}
```

## Testing Patterns

### In-Memory Testing

Use memory storage for fast tests:

```typescript
import { Git, createGitStore } from "@statewalker/vcs-commands";
import { createGitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";

describe("CommitCommand", () => {
  let git: Git;

  beforeEach(async () => {
    const repo = await createGitRepository(); // In-memory by default
    const staging = new MemoryStagingStore();
    const store = createGitStore({ repository: repo, staging });
    git = Git.wrap(store);
  });

  it("creates commit with message", async () => {
    await git.add().addFilepattern(".").call();
    const id = await git.commit().setMessage("test").call();
    expect(id).toBeDefined();
  });
});
```

### Mocking Transport

Test transport commands without network:

```typescript
vi.mock("@statewalker/vcs-transport", () => ({
  fetch: vi.fn().mockResolvedValue({
    objectCount: 10,
    bytesReceived: 1024,
    trackingRefUpdates: [],
  }),
}));

it("fetches from remote", async () => {
  await git.fetch().setRemote("origin").call();
  expect(transport.fetch).toHaveBeenCalledWith(
    expect.objectContaining({ wants: ["refs/heads/main"] })
  );
});
```

### Error Testing

Verify commands throw appropriate errors:

```typescript
it("throws NoMessageError without message", async () => {
  await expect(git.commit().call()).rejects.toThrow(NoMessageError);
});

it("throws RefNotFoundError for missing branch", async () => {
  await expect(
    git.checkout().setName("nonexistent").call()
  ).rejects.toThrow(RefNotFoundError);
});
```

## Performance Considerations

### Command Reuse Prevention

Commands are single-use to prevent state leakage:

```typescript
const commit = git.commit().setMessage("test");
await commit.call();
await commit.call(); // Throws: Command already called
```

Create new instances for repeated operations.

### Streaming Results

Some commands return async iterables for large results:

```typescript
// LogCommand returns AsyncIterable<Commit>
for await (const commit of git.log().setMaxCount(100).call()) {
  // Process one at a time, not all in memory
}
```

### Lazy Store Access

Commands access stores lazily during execution, not construction. This allows pre-configuring commands before the repository is fully ready.
