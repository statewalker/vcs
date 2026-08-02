# Root tooling repair — why `npx biome` lied and `tsc` proved nothing

Both caveats recorded earlier were **my own invocation errors surfacing two real, pre-existing
misconfigurations**. Neither was caused by the porcelain or collision work.

## Root cause

The **umbrella** (`umbrella-workbench`) is the pnpm workspace root. Its `pnpm-workspace.yaml` is
**generated** from `umbrella.json` by `scripts/preinstall.mjs` — editing the generated file is
pointless, it is overwritten on the next install.

Its globs were `workspaces/*/packages/*` and `workspaces/*/apps/*`. The vcs **packages** matched, so
they got `node_modules`. The vcs **repo root did not match any glob**, so it was never installed —
no `node_modules`, therefore no `biome`, no `turbo`, no `tsc` on `PATH` at that level.

Consequences, both of which bit:

1. `npx biome` found nothing locally and fetched an **unrelated registry package named `biome`,
   version 0.3.3**, which exits 0 without checking anything. A lint step invoked that way silently
   passes while doing nothing.
2. `pnpm typecheck` (which runs `turbo run typecheck`) could not run at all, so I fell back to
   `npx tsc --noEmit` inside a package. That bypasses turbo's `dependsOn: ["^build"]`, so
   cross-package types resolve through each dependency's **stale `dist/*.d.ts`**. A src-only change
   in `transport` was invisible to `commands`.

## Fixes

- `umbrella.json` → `packageGlobs` now includes `workspaces/vcs`, so the repo root is a workspace
  member and gets its tooling. Verified durable: re-running `pnpm install` regenerates
  `pnpm-workspace.yaml` with the entry rather than dropping it.
- `workspaces/vcs/package.json`: restored `turbo` to devDependencies. It was dropped by
  `4725f858 chore(deps): move deps to catalog`, along with `rolldown` and `pnpm`. Dropping those two
  was correct — 20 of 21 packages declare `rolldown` themselves and `pnpm` comes from
  `packageManager` — but **four root scripts invoke `turbo`** and nothing declared it.
- `workspaces/vcs/turbo.json`: removed `"extends": ["//"]`, added by
  `6fff58c3 chore(turbo): add extends:["//"] for umbrella workspace-member role`. `extends` is only
  valid in a *package-level* config; this is the root config and carries the full task definitions.
  The umbrella never became a turbo root (it has no `turbo.json` and uses its own CLI), so the key
  made `turbo` refuse to parse — root `build`/`test`/`typecheck` never worked. vcs also ships as a
  standalone repo, where there is no parent to extend by definition.

## Verified

- `npx biome --version` → **2.5.6** (was 0.3.3).
- `turbo run typecheck` builds dependencies first. Proof: re-running the earlier experiment — adding
  a fake reason to `PushCommandResult` in transport's **src only** — now fails
  `@statewalker/vcs-commands#typecheck` with `TS2741`, where previously it passed silently against
  stale declarations. **No manual rebuild needed.**

## What the working tools then revealed (all pre-existing, none fixed here)

- **42 type errors** in `packages/integration-tests/tests/` — mostly `TS18048` strict-null, plus
  `MergeStatus.CONFLICTED` which does not exist on the enum. These pass at runtime because vitest
  does not typecheck. Last touched 2026-02-13, untouched by any of this work.
- **14 files with lint findings**, all under `apps/demos`, `apps/benchmarks`, plus `biome.json` and
  `turbo.json` themselves. No findings in any source touched by this work.
- **`apps/*/*` are not installed** under the umbrella: its glob is `workspaces/*/apps/*`, which
  matches `apps/demos` (the container) rather than `apps/demos/<app>`. vcs's own workspace file lists
  `apps/demos/*` etc. So benchmark/demo apps have no `node_modules` and fail typecheck with
  "Cannot find module". Fixing this means adding `workspaces/*/apps/*/*` to `umbrella.json`, which
  would pull several demos with unresolvable `workspace:*` deps into the install — deliberately left
  alone rather than widened into here.
