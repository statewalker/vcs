# Branching and Merging Example

Deep dive into Git branch operations and merge strategies using the statewalker-vcs Commands API.

## Quick Start

```bash
# Run all steps
pnpm start

# Run individual steps
pnpm step:01  # Branch creation
pnpm step:02  # HEAD management
pnpm step:03  # Fast-forward merge
pnpm step:04  # Three-way merge
pnpm step:05  # Merge strategies
pnpm step:06  # Conflict handling
pnpm step:07  # Rebase concepts
```

## What You'll Learn

### Step 1: Branch Creation

Creating and listing branches with the porcelain API.

```typescript
// Create a branch
const branch = await git.branchCreate().setName("feature").call();

// Create from specific commit
await git.branchCreate()
  .setName("release")
  .setStartPoint(commitId)
  .call();

// List all branches
const branches = await git.branchList().call();
```

### Step 2: HEAD Management

Understanding symbolic refs and HEAD.

```typescript
// HEAD is typically a symbolic ref
const head = await store.refs.get("HEAD");
// { symbolicRef: "refs/heads/main", objectId: undefined }

// Resolve to get the actual commit
const resolved = await store.refs.resolve("HEAD");
// { symbolicRef: "refs/heads/main", objectId: "abc123..." }

// Switch branches (low-level)
await store.refs.setSymbolic("HEAD", "refs/heads/feature");

// Create detached HEAD
await store.refs.set("HEAD", commitId);
```

### Step 3: Fast-Forward Merge

When one branch is directly ahead of another.

```typescript
// Fast-forward is automatic when possible
const result = await git.merge().include("feature").call();
// result.status === MergeStatus.FAST_FORWARD

// Force merge commit (no fast-forward)
await git.merge()
  .include("feature")
  .setFastForwardMode(FastForwardMode.NO_FF)
  .call();

// Fail if fast-forward not possible
await git.merge()
  .include("feature")
  .setFastForwardMode(FastForwardMode.FF_ONLY)
  .call();
```

### Step 4: Three-Way Merge

When branches have diverged from a common ancestor.

```typescript
const result = await git.merge().include("feature").call();

if (result.status === MergeStatus.MERGED) {
  // Merge commit created with two parents
  const commit = await store.commits.loadCommit(result.newHead);
  console.log(commit.parents); // [mainCommitId, featureCommitId]
}
```

### Step 5: Merge Strategies

Different strategies for different situations.

```typescript
// OURS: Keep our tree, record merge
await git.merge()
  .include("feature")
  .setStrategy(MergeStrategy.OURS)
  .call();

// THEIRS: Replace with their tree
await git.merge()
  .include("feature")
  .setStrategy(MergeStrategy.THEIRS)
  .call();

// Content strategies for file-level conflicts
await git.merge()
  .include("feature")
  .setContentMergeStrategy(ContentMergeStrategy.UNION)
  .call();
```

### Step 6: Conflict Handling

Understanding and resolving merge conflicts.

```typescript
const result = await git.merge().include("feature").call();

if (result.status === MergeStatus.CONFLICTING) {
  console.log("Conflicts in:", result.conflicts);

  // Staging area contains conflict stages:
  // Stage 0: Merged (clean)
  // Stage 1: BASE (common ancestor)
  // Stage 2: OURS (current branch)
  // Stage 3: THEIRS (incoming branch)
}
```

### Step 7: Rebase Concepts

Understanding rebase vs merge.

| Aspect | Merge | Rebase |
|--------|-------|--------|
| History | Preserves branches | Linear history |
| Commit IDs | Unchanged | Rewritten |
| Safety | Safe for shared | Local branches only |
| Use case | Feature completion | Keeping up with main |

## Merge Strategy Reference

| Scenario | Strategy |
|----------|----------|
| Normal merge | `RECURSIVE` (default) |
| Ignore their changes | `OURS` |
| Accept their version | `THEIRS` |
| Additive files | `ContentMergeStrategy.UNION` |

## Branch Diagrams

### Fast-Forward
```
Before:  main ---o
                  \
         feature   o---o

After:   main --------o---o (fast-forward)
```

### Three-Way Merge
```
Before:  main ---o---o
                  \
         feature   o---o

After:   main ---o---o---M (merge commit)
                  \     /
         feature   o---o
```

## Related Examples

- [01-quick-start](../01-quick-start/) - Basic VCS operations
- [02-porcelain-commands](../02-porcelain-commands/) - Full Commands API
- [05-history-operations](../05-history-operations/) - Log, diff, blame
