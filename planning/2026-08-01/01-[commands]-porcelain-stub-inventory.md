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

- **`CloneCommand` never sets HEAD on a non-bare clone.** `defaultBranch` arrives as the full symref
  target `refs/heads/main`, but every use site re-prefixes it →
  `refs/remotes/origin/refs/heads/main`, which never resolves; `checkoutHead()` never runs and
  staging stays empty. A narrow normalisation bug, distinct from the separate ref-layout question
  (should a non-bare clone create `refs/remotes/origin/*` at all?).
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
- The blocked-on-a-false-premise pair (**`clean` never deletes**, **`reset --hard` never touches the
  worktree**) and the silent *"take theirs"* conflict resolution in `rebase`/`stash-apply` are
  untouched — see the inventory above.
