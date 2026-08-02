# Porcelain stubs — inventory and repair plan

**Date:** 2026-08-01 · **Branch:** `fix/porcelain-stubs` · **Baseline:** `packages/commands` 1126 green.

## Why this exists

Building a workbench **GitNature** against this stack (shipped 2026-08-01 as
`@statewalker/workspace-vcs.core`) meant bypassing the `Git` porcelain three separate times,
because several commands **report success while doing nothing**. Each bypass was worked around
locally; this document records the underlying defects so they can be repaired at the source.

Every item below was found by **executing** the code, not by reading it.

## The defect class

A command validates its arguments, performs part of its job, and returns a well-formed result —
while the persistent effect it advertises never happens. Nothing throws. `git fsck` does not
complain. The result object often looks correct.

## Inventory

| # | Command | Promise | Reality | Tests pinning it |
|---|---|---|---|---|
| 1 | `RemoteAddCommand` | `git remote add` | `storeRemoteConfig()` is an **empty body**; returns a config it never stores | — |
| 1b | `RemoteListCommand` | `git remote -v` | names scraped from `refs/remotes/*`; **`urls: []` hardcoded** | **5 tests × 2 backends** |
| 1c | `RemoteSetUrlCommand` | `git remote set-url` | writes nothing; echoes the URL back | (same 5) |
| 1d | `RemoteRemoveCommand` | `git remote remove` | deletes tracking refs only ⇒ **a remote added but never fetched cannot be removed** | (same 5) |
| 2 | `FetchCommand.storePack` | — | **empty body.** Tracking refs are written, then **every object they point at is dropped**. Its comment ("stored by the transport layer") is false | none |
| 3 | `CloneCommand.storePack` | — | guards on `workingCopy.packs?.store`; **no `WorkingCopy` in the repo has `packs`** ⇒ always false. `checkoutHead` swallows the miss in a `catch`. Clone yields refs + a HEAD pointing at objects that were never stored | none |
| 4 | `PushCommand` | `RemoteRefUpdate.newObjectId` = "New object ID that was pushed" | **`""` for every update.** `srcRef` / `expectedOldObjectId` never populated; `delete` hardcoded `false` | none |

### Adjacent defects found in the same pass

- **`PushStatus.REJECTED_NONFASTFORWARD` is never produced** (only `OK` / `REJECTED_OTHER`), so the
  `NonFastForwardError` branch of `callOrThrow` is **unreachable dead code**.
- **Delete-push is advertised in the class JSDoc** (`.add(":refs/heads/old-branch")`) **and throws** —
  transport splits the refspec, `source === ""`, `getLocalRef("")` → `undefined` →
  `Error("Local ref not found: ")`. Consistent with `delete: false` being hardcoded.
- **`PushCommand.exportPack` is dead on every backend.** It reads `(history as any).serialization`.
  Not a file-vs-memory issue: `createGitFilesHistory` *does* return a `HistoryWithOperations` with
  `serialization` — but **nothing in the repo ever hands such a history to a `WorkingCopy`**, and
  `SimpleHistory.collectReachableObjects` throws. Always falls through to the hand-rolled walker.
- **Remote *names* are treated as URLs** in `fetch` / `push` / `ls-remote` (`resolveRemoteUrl`
  returns the input unchanged when it has no `://` or `@`) ⇒ `push("origin")` builds
  `new Request("origin/info/refs?…")` and throws `TypeError: Failed to parse URL`.

### Blocked on capability that DOES exist (false premises)

- **`CleanCommand` never deletes.** Returns `dryRun: true` unconditionally — *"Always true until
  WorkingTreeApi supports deletion"*. But `Worktree.remove(path, {recursive})` exists
  (`working-tree/src/worktree/worktree.ts:101`) and the command already holds the worktree. No tests.
- **`ResetCommand --hard` never touches the working tree** — *"Would reset working tree here / For
  now, just reset staging"*. Same false premise; `worktreeAccess` is available. No `HARD` test exists.
- **`RmCommand`** skips working-tree removal for the same reason.

### Lower severity, recorded not scheduled

`stash-apply` and `rebase` both resolve conflicts with *"For now, take theirs"* (**silent data
loss**); `rebase`'s tree merge is *"simple… in a full implementation, a proper three-way merge"*;
`tag` signing unimplemented; `gc` capability probe.

## Prerequisite — `GitWorkingCopyConfig` does not round-trip

`serializeGitConfig` writes `[remote "origin"]`; `parseGitConfig` reads that section back as
`remote."origin"` — **quotes retained** — so `set(k,v) → save() → load() → get(k)` yields
`undefined`. **The file has zero tests.** Three further limits, each verified: comments are
destroyed on save; repeated keys collapse (and the *load-bearing*
`+refs/heads/*:refs/remotes/origin/*` is the one dropped); numeric-looking values are coerced
(`007` → `7`); whitespace in a section header collapses to a dot.

Any "write to git config" repair fails silently on disk until this is fixed.

## Repair order

1. **`GitWorkingCopyConfig` round-trip** — prerequisite; verify both directions against real `git`.
2. **`FetchCommand.storePack` + `CloneCommand.storePack`** — identical fix
   (`new DefaultSerializationApi({history}).importPack(...)` over the transport's `packData`),
   empirically proven, no test breakage. `PullCommand` is a free beneficiary: it currently merges a
   commit that does not exist locally.
3. **`PushCommand.newObjectId`** — the command already resolves the OID in its own `getLocalRef`
   callback; memoise `dest → newOid`. **Scope `expectedOldObjectId` out** — the remote's pre-push
   value is read by transport but not returned, so it needs a transport change.
4. **Remote config persistence** — last, the only one with real breakage risk.
   **Hard constraint: discovery must become a UNION of config sections ∪ names derived from
   `refs/remotes/*` — never a replacement.** Five tests set tracking refs directly and expect the
   remote to be discoverable; one even comments *"Create a tracking ref to simulate the remote
   exists"*, an explicit acknowledgement that `remoteAdd` persists nothing.

## Known unknowns

- `importPack` idempotency on the **SQL** backend under a repeat fetch is inferred, not spiked;
  `fetch-command.test.ts:441` ("NO_CHANGE") is the test that exercises it.
- The `native-git` integration suites are largely skipped, their header citing *"known pack
  import/export bugs in core/serialization"*. Whether those overlap the `importPack` path being
  newly exercised here is undetermined — the mock server's packs are produced by our own
  `DefaultSerializationApi`, so they round-trip through our own encoder/decoder.

---

# OUTCOME — all four repaired, 2026-08-01

Branch `fix/porcelain-stubs`. Full gate green:
`commands` **1126 → 1199** · `store-files` **502 → 559** · `core` 838 · `utils` 1164 ·
`working-tree` 300 · `transport` 683 · `workspace` 19 · `integration-tests` 262 (incl. the
real-git interop suites). **~5,000 tests.**

| # | Repair | Commit |
|---|---|---|
| 0 | `GitWorkingCopyConfig` — lossless git-config reader/writer (prerequisite) | `43955b32`, `3c07c051` |
| 2,3 | `Fetch`/`Clone` `storePack` — import the pack instead of dropping it | `aa1238a8` |
| 4 | `PushCommand` — report the real pushed OID; **delete-push now works** | `2b678d19` |
| 1 | Remote configuration actually persists | `753d9232` |

## What the prerequisite turned out to be

Larger than "make it round-trip". A **fifth** bug surfaced only because the new tests ran real
`git` against the output: `serializeValue` never escaped backslashes, so a value like `C:\path\to`
produced a file git **refuses to parse at all** (`fatal: bad config line 13`) — poisoning every key,
not just that one. All four previously-known limits were **fixed** rather than documented away
(comments survive a save; repeated keys preserved, so the load-bearing
`+refs/heads/*:refs/remotes/origin/*` is no longer dropped; `007` stays `007`; a real header parser
replaced the regex). `save()` on a never-loaded instance also used to **truncate the file**.

## The constraint that governed the last repair

Discovery is a **UNION** — config sections ∪ names under `refs/remotes/*` — never a replacement.
Five pre-existing tests set tracking refs directly and expect the remote to be discoverable.
Verified by mutation from **both** directions: dropping the config half kills the persistence and
union tests; dropping the refs half kills the original `should list remotes` /
`should include default fetch refspec`. No pre-existing assertion was weakened — the only edit to
`remote-command.test.ts` was replacing the stale comment *"simulate the remote exists"*.

Test backends now accept an optional `config`, defaulting to the previous bare `{}`, so a real
`GitWorkingCopyConfig` can be exercised without changing existing behaviour. `packages/working-tree`
was **not** modified.

## Still open — recorded, not silently dropped

- ~~`CloneCommand` never sets HEAD on a non-bare clone.~~ **FIXED** (`653adbe0`). `defaultBranch`
  arrives as the full symref target `refs/heads/main` and every use site re-prefixed it, so
  `refs/remotes/origin/refs/heads/main` never resolved, `checkoutHead()` never ran and staging
  stayed empty. Now normalised to a bare branch name, and the tip is looked up under either the
  remote-tracking or the local ref name — whichever the advertisement wrote. **Which refs are
  written is unchanged**, so the ref-layout question below is still open and untouched.
- **OPEN — ref layout:** should a non-bare clone create `refs/remotes/<remote>/*` tracking refs at
  all? Today it writes the advertised refs verbatim (`refs/heads/main`) and creates none. A design
  decision, not a bug.
- **`REJECTED_NONFASTFORWARD` is still unreachable.** The server produces it, but it returns as
  `ng <ref> <msg>` → `{ok:false}` → mapped to `REJECTED_OTHER`. Reaching it means parsing the
  message text.
- **`expectedOldObjectId`** stays unset: the remote's pre-push value is read by transport and never
  returned. Needs a transport change.
- **Delete-push is unproven against real `git`** — only against the in-repo server, whose
  `refStore.update(name, ZERO_OID)` *zeroes* a ref rather than removing it.
- **`importPackIntoHistory` is duplicated verbatim** in `fetch-command.ts` and `clone-command.ts`;
  a shared module would have widened the package's public API. Worth extracting.
- **Thin/delta packs** are untested on re-import; the constructed `DefaultSerializationApi` has no
  delta APIs, so deltas fall back to full objects.
- ~~The blocked-on-a-false-premise pair~~ **FIXED** (`cdfde4e8`). The premise really was false —
  `Worktree` declares `writeContent`/`remove`/`mkdir`/`rename` and both commands already held it.
  `clean` now deletes, and its returned `dryRun` reflects the caller instead of a hardcoded `true`
  (dry-run stays the default; a mutation making deletion unconditional is killed by 5 tests).
  `reset --hard` now restores modified files, deletes files absent from the target, and recreates
  files the user deleted.
  **Deliberately NOT delegated to `Worktree.checkoutTree()`** — it only *writes* entries present in
  the tree and never removes ones absent from it (`result.removed` is hardcoded empty), so
  delegating would have produced a silent half-restore.
  **Residual limits, all tested:** symlinks *raise* rather than being written as regular files (the
  base `Worktree` has no primitive to create one — the same limitation GitNature hit); gitlink
  contents skipped, matching real git; directories left empty are not pruned; and the operation is
  **not atomic across HEAD/staging/worktree** — an up-front plan-and-validate pass means an
  unrestorable tree fails with the worktree completely untouched, but a failure during the write
  phase still leaves HEAD and staging already moved. Full rollback is a larger design change.
- **CORRECTION (2026-08-01): the *"take theirs"* conflict handling is NOT data loss.** This entry
  previously called it "the last data-loss item"; that was wrong, and was repeated from the initial
  inventory without tracing the call path.
  Both commands **stop on conflict and report it**: `rebase-command.ts:483` returns
  `{status: STOPPED, currentCommit, conflicts}` and `stash-apply-command.ts:196` returns
  `{status: CONFLICTS, stashCommit, conflicts}`. The `mergedEntries.set(path, theirsEntry)` under the
  `// For now, take theirs` comment populates a map that is then **discarded** — the helper returns
  `{tree: theirs, conflicts}`, not a tree built from those entries, and the caller checks `conflicts`
  first. It is misleading dead code, not a silent overwrite. Both behave like git: halt and hand back
  the conflicting paths.
- ~~`rebase`'s tree merge is a two-way path comparison~~ **THAT WAS WRONG** (`4c6dbe41`).
  `mergeTreesThreeWay` already took a `base` and compared each side against it per path; the
  identical-change case was always handled and green. The claim came from reading a stale
  `// Simple tree merge` comment and a differently-named helper without tracing which function the
  caller uses — the same mistake as the "take theirs" entry above, in the same file. **Comments in
  this file have now been wrong three times; trace the call path.**
- **FIXED instead — two real defects the investigation surfaced** (`4c6dbe41`):
  1. **A one-sided MODE change was silently discarded — actual data loss.** Entries were compared by
     blob id alone, so setting the executable bit on otherwise-unchanged content read as "this side
     changed nothing", and the other side's entry (carrying the old mode) was taken. Rebasing dropped
     the exec bit. Entries are now equal only when **id AND mode** match. Same class as the
     GitNature exec-bit finding, but here it destroys the change rather than refusing it.
  2. **`delete/delete` reported a CONFLICT** — `if (oursId === theirsId && oursEntry)` is guarded out
     when both sides deleted (both ids `undefined`), so it fell through to `conflicts`. Both sides
     removing the same file now merges cleanly.
  Applied to `stash-apply` too, whose base is well defined (the tree of the commit the stash was
  taken from). Scope stays **path-level**: a file both sides edited is still a conflict even when the
  edits do not overlap — no hunk merging, no conflict markers — and the callers still halt.

- **NEW — a directory/file collision silently DROPS the file.** If base has no `a`, one side adds a
  file `a` and the other adds `a/b`, both take the "only one side changed" path and land in
  `mergedEntries` together; `buildTreeFromPaths` sets `a` as a file (`rebase-command.ts:539`) and then
  overwrites it with the subtree (`:555`). Git calls this a conflict. **This loses a file**, and it is
  untested. Not fixed — it is a new conflict-semantics decision, not a repair.
- **Merge limits now written into the doc comments** so they are not rediscovered: no content-level
  (hunk) merging — two sides editing non-overlapping regions of one file is still a conflict where git
  resolves it — and no rename detection, so a rename is a delete plus an add and conflicts against a
  modified counterpart.
- Note for anyone tempted by `commits.findMergeBase`: it is the **wrong** tool for rebase. Replaying a
  single commit takes that commit's own parent as base (`rebase-command.ts:469` already loads it), not
  the merge-base of two heads.

- **NEW, and the same class as the original four: `StashApplyCommand` restores nothing.**
  It computes `mergeResult.tree` and **throws it away** — only `.conflicts` is ever read — then
  returns `{status: OK, stashCommit}` having written nothing to the index or working tree. The
  untracked branch is another empty body: *"The untracked tree would need to be extracted to the
  working directory / This requires working tree access"* — **the same false premise as `clean` and
  `reset --hard`**, both of which turned out to have the capability all along
  (`Worktree.writeContent`/`remove`/`checkoutTree`). Today `stash apply` is a conflict detector
  wearing an apply's name. Surfaced by two mutations that survived on the stash side while being
  killed on the rebase side — they perturb a tree stash-apply never reads.

## Correction — the transport-side push items (my earlier note was wrong on paths)

I had recorded "transport reads `expectedOldObjectId` at `push.ts:183`". **There is no
`packages/transport/src/push.ts`**, and `expectedOldObjectId` does not appear anywhere in transport.
The real shape, verified:

- `expectedOldObjectId` is declared in **commands** (`src/results/push-result.ts:36`) and left unset.
- Transport **does** compute the remote's pre-push value — `src/operations/push.ts:187`,
  `oldOid: remoteOid`, read from the receive-pack advertisement, ZERO_OID for a new ref — but the
  returned `updates` map carries only `{ok, message}`, so it is computed and dropped. The comment at
  `push-command.ts:374` saying this "needs a transport change" is **accurate**, not a false stub.
- `REJECTED_NONFASTFORWARD` is unreachable because `push-command.ts:387` flattens every failure to
  `REJECTED_OTHER`. The reason string survives in `message`. Transport already has the classifier —
  `mapRejectReason` (`src/fsm/push/types.ts:52`, already unit-tested) — but it is wired only into the
  FSM path (`client-push-fsm.ts:360`), never the HTTP operations path.
- `RefPushStatus` (`src/api/push-result.ts`) already declares `oldOid?`/`newOid?` and never sets them
  (`http-client.ts:526/530/538` set only `success`/`error`).

## Tooling note — `npx biome` in this repo runs the WRONG binary

`npx biome --version` reports **0.3.3**, an unrelated registry package; Biome is 2.x. The vcs
submodule root has no `node_modules/.bin`. A real Biome 2.5.6 lives at
`workspaces/statewalker-fsm/node_modules/.bin/biome`; run it from the vcs repo root so it picks up
`workspaces/vcs/biome.json`. A lint step invoked as `npx biome check` silently does nothing.

## Verified — stash apply now restores (task #18, commit 011cddeb)

Independently re-checked, not taken on report:

- The two mutations that **survived** the previous round — M5 (ours-unchanged stops carrying theirs)
  and M6 (theirs-unchanged stops carrying ours) — now **both die** (2 tests each). Their surviving
  before was the evidence that stash computed a merged tree and discarded it; their dying now is the
  evidence it writes.
- Deleting the `worktree.remove(path)` call kills 3 tests, so the delete half of an apply is really
  covered, not just the write half.
- It did **not** delegate to `Worktree.checkoutTree()` — the trap that only writes present entries
  and never removes absent ones, producing a silent half-restore. It has its own removal-aware
  `src/commands/tree-restore.ts`.
- That module plans first and writes second: every blob is checked to exist before anything is
  written, so a missing object aborts instead of half-restoring. It skips submodule contents and
  **refuses symlinks loudly** rather than writing the target path as a regular file, which would
  silently produce a worktree not matching the tree.

**"Requires working tree access" was false for the fifth time.** The command reaches `Worktree`
through the same `GitCommand.worktreeAccess` getter (`git-command.ts:236`) that `clean` and
`reset --hard` use. Treat every such comment in this codebase as unverified until traced.

### Method note — an unapplied mutation reads as a survivor

Re-running M6 with a naive anchor hit **2 occurrences** and the assertion refused to apply it; the
test run then reported all-green, which is exactly what a surviving mutation looks like. Without the
single-occurrence assertion the conclusion would have been "M6 still survives" — false. Always assert
the count before replacing.
