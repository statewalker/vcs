# Directory/file collision — native git ground truth, and what we will match

## The defect

Base has no `a`. One side adds a **file** `a`, the other adds `a/b` (making `a` a **directory**).
Both paths take the "only one side changed relative to base" branch of the three-way merge, so both
land in `mergedEntries` together. `buildTreeFromPaths` then sets `a` as a file and later overwrites
it with the subtree — **the file is silently dropped**. No conflict is reported; the merge reports
success.

Present in both `rebase-command.ts` and `stash-apply-command.ts` (the merge logic is duplicated).

## Native git ground truth (measured, not assumed)

Reproduced with real `git` 2.x on three operations. All three behave identically:

| operation | result |
|---|---|
| `git merge` | `CONFLICT (file/directory)`, exit 1 |
| `git rebase` | `CONFLICT (file/directory)`, exit 1, rebase stops |
| `git stash apply` | `CONFLICT (file/directory)`, exit 1, **stash preserved** |

The resolution git picks:

- The **directory wins the real path**. `a/b` is written at **stage 0** — resolved, not conflicted.
- The **file is moved aside** to `a~<label>` and left **unmerged** — stage 2 when it came from ours,
  stage 3 when it came from theirs.
- The `<label>` names the side the file came from, and differs per operation: `HEAD`, the branch
  name (`a~side-file`), `<sha> (subject)` on rebase, `Stashed changes` on stash apply.

Index after `git stash apply` in the collision case:

```
100644 <oid> 0  a/b
100644 <oid> 3  a~Stashed changes
100644 <oid> 0  seed.txt
```

The essential point: **git never loses the file.** It reports a conflict and keeps both sides.

## What we will implement, and what we will not

**Will:** detect the collision and report the path as a **conflict**. That alone removes the data
loss — a conflicting merge in our code returns `{ tree: theirs, conflicts }` and never builds a tree
from `mergedEntries`, and both callers halt (`RebaseStatus.STOPPED`, `StashApplyStatus.CONFLICTS`),
so the stashed/replayed content is preserved rather than dropped.

**Will not (decision, reversible):** the `a~<label>` rename. That is git's *working-tree
presentation* of the conflict, and our commands do not adopt git's presentation for **any** conflict
type — they halt without writing conflict markers or renamed files. Implementing `a~<label>` alone
would require writing the worktree on a conflicting merge, which is a behavioural change well beyond
this repair, and would be inconsistent with how we surface content conflicts.

*To revert this decision:* implement the rename in the conflict path of the shared merge, deriving
`<label>` per caller, and change the callers to write the worktree on conflict instead of halting.
