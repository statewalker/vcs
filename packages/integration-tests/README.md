# @statewalker/vcs-integration-tests

Cross-package integration tests for StateWalker VCS — the example apps' scenarios encoded as automated, use-case-level tests.

## Overview

This is a **test-only** package (private, not published). It exercises the VCS packages end-to-end through realistic scenarios that mirror the [`apps/examples/`](../../apps/examples) tutorials — quick-start, object model, branching/merging, history operations, staging/checkout, internal storage, and porcelain commands — across multiple storage backends, verifying the packages compose correctly (and that repositories stay native-git-compatible).

## Running

```bash
pnpm --filter @statewalker/vcs-integration-tests test
```

## Layout

- `tests/*.test.ts` — one suite per scenario (`quick-start`, `object-model`, `branching-merging`, `history-operations`, `staging-checkout`, `internal-storage`, `porcelain-commands`).
- `tests/backend-factories.ts` + `tests/helpers/` — shared fixtures and the storage-backend matrix the scenarios run against.
