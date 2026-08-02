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

## Verified (independently, not taken on report)

Commits: `5df4b4f4` (red) → `d93f641f` (green) → `98dfb638` (refactor, separate).

### Mutation table

| # | Mutation | Result |
|---|---|---|
| C1 | collision detection removed entirely | killed (20 tests, both commands) |
| C2 | prefix boundary replaced by bare `startsWith` | killed (4 tests — the false-positive guards) |

C2 matters: it is the mutation that makes `ab` collide with `a`. Its dying proves the guard is real
rather than incidental.

### Coverage

Both commands have symmetric cases: collision contributed by either side, nested several levels
deep, multiple collisions in a stable order, and two negative cases (a file sharing a name prefix
with a directory, and with another file).

### The duplication is gone, and it had already diverged

`rebase-command.ts` and `stash-apply-command.ts` now both call one `mergeTreesThreeWay` in
`src/tree-merge/`. This is not only tidiness: the two copies **had already diverged** — the M5/M6
mutations died on the rebase copy and survived on the stash copy, because only one of them wrote its
merged tree. A single implementation removes that whole class of drift. The refactor commit touches
source only, no tests (435 deletions, 268 insertions).

### Reasoning confirmed: only one-sided carries can collide

A path both sides changed cannot collide, because carrying it requires the two sides to agree, and
no single tree holds `a` as a file and `a/b` at once. So the collision is only detectable once the
whole merged set is known — not inside the per-path loop. Verified by reading, and consistent with
the tests.

### Known fidelity gap — the reported path differs from git's

Git reports the unmerged entry under the **moved-aside name** (`a~Stashed changes`); we report the
conflict under the **original path** (`a`). Consequence of not implementing the rename, recorded so
nobody later reads the difference as a bug. The data-loss defect is fixed either way: nothing is
dropped, the caller halts, and the content survives in the stash or the commit being replayed.

Suite: 1361 passed (was 1333; 28 new), `tsc --noEmit` clean.
