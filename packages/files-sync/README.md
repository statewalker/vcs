# @statewalker/files-sync

rclone-like file-synchronisation engine (copy / sync / bisync / move / check) over two `FilesApi` endpoints.

## Overview

`files-sync` is Axis A of the two-axis VCS architecture — the git-independent "sync" engine. It **plans, then executes**: `plan(a, b, op, opts)` is pure (mutates neither endpoint) and returns a serializable `SyncPlan`; `execute(plan, a, b, opts)` applies it, emitting events and resuming from an optional checkpoint after interruption. Bidirectional `bisync` is a genuine **three-way merge over a sync-owned `SyncAnchor`** (delegated to `@statewalker/merge-core`), never two chained one-way syncs.

It imports **only** `@statewalker/webrun-files` and `@statewalker/merge-core` and knows nothing of git or versioning — that is the hard Axis A ✗↔ Axis B ban. Content identity (`hashContent`), the per-copy `Transfer` strategy, and conflict resolution are all injected.

## Installation

```bash
pnpm add @statewalker/files-sync
```

## Quick Start

```typescript
import { createHash } from "node:crypto";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { execute, plan } from "@statewalker/files-sync";

async function sha256(input: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of input) h.update(chunk);
  return `sha256:${h.digest("hex")}`;
}

const a = new MemFilesApi({ initialFiles: { "/new.txt": "new", "/changed.txt": "v2" } });
const b = new MemFilesApi({ initialFiles: { "/changed.txt": "v1", "/extra.txt": "keep" } });

// Pure plan — dry-runnable, serializable, mutates nothing.
const p = await plan(a, b, "copy", { hashContent: sha256 });

// Execute, streaming per-action events.
for await (const event of execute(p, a, b, { hashContent: sha256 })) {
  if (event.type === "done") console.log("synced", event.action);
}
// b now has new.txt + updated changed.txt; extra.txt is kept (copy never deletes).
```

## API

- **`plan(a, b, op, opts): Promise<SyncPlan>`** — pure planner. `op` is `"copy" | "sync" | "bisync" | "move" | "check"`. `copy` never deletes destination files; `sync` deletes extraneous ones; `move` is copy+verify+delete; `check` compares only; `bisync` runs the 3-way merge.
- **`execute(plan, a, b, opts): AsyncIterable<SyncEvent>`** — applies a plan, verifying each action and skipping already-completed indices from `opts.checkpoint`.
- **`buildAnchor(...)`** — build a `SyncAnchor` (bisync base) from an endpoint.
- **`snapshot(files, filter?)` / `isChanged(...)`** — the change-detection ladder primitives.
- **`createStreamingTransfer(): Transfer`** — the default whole-file streaming copy executor.

`SyncOptions` carries the required `hashContent`, plus optional `filter`, `transfer`, `verify` (`VerificationMode`), `anchorStore` / `pairKey` (bisync), `resolve`, `quickFingerprint`, and `checkpoint`. Types: `SyncPlan`, `SyncAction`, `SyncConflict`, `SyncEvent`, `SyncAnchor`, `AnchorStore`, `CheckpointStore`, `Transfer`.

## Notes

- **Plan-then-execute + resumable.** Plans are serializable and auditable; `execute` records each completed action index, so an interrupted run resumes with no duplicate work.
- **Cheap-first change detection.** A short-circuiting ladder (path/type → size → stable mtime → optional quick fingerprint → full `hashContent`) avoids hashing byte-identical files.
- **Injected `Transfer` seam.** The default streams whole files; a chunk-dedup transfer (from `@statewalker/content-transfer`) plugs into the *same* seam with no rewrite.
- **bisync = 3-way over an anchor** via `@statewalker/merge-core`, using the same injected content id — not two one-way syncs.
- Built red/green TDD.
