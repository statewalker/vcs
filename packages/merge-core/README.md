# @statewalker/merge-core

Domain-neutral three-way merge and diff over the `@statewalker/webrun-files` `FilesApi`.

## Overview

`merge-core` compares three `FilesApi` trees — base, left, right — and returns a **pure descriptor** of how to reconcile them: a list of reconciliation `operations` plus the unresolved `conflicts`. It performs **no writes** to any input; the caller materializes the result into a target tree itself. Structural detection (add / modify / delete / rename / type-change) is built in; per-file **content** merging is a pluggable `ContentMerger` (a line-based 3-way text merge ships as the default).

It is shared infrastructure for the two-axis VCS architecture: it is the single implementation of "compare three tree states and produce the merged result," so Axis A (`@statewalker/files-sync` bisync) and Axis B (git `merge`) never duplicate it. It depends only on `webrun-files` and an **injected** `hashContent` — it owns no hashing algorithm and knows nothing of git, sync, commits, or chunks.

## Installation

```bash
pnpm add @statewalker/merge-core
```

## Quick Start

```typescript
import { createHash } from "node:crypto";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { merge } from "@statewalker/merge-core";

// Injected content identity — merge-core owns no hash.
async function sha256(input: AsyncIterable<Uint8Array>): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of input) h.update(chunk);
  return `sha256:${h.digest("hex")}`;
}

const base = new MemFilesApi({ initialFiles: { "/a.txt": "a\n", "/c.txt": "c\n" } });
const left = new MemFilesApi({ initialFiles: { "/a.txt": "a2\n" } }); // modified a, deleted c
const right = new MemFilesApi({ initialFiles: { "/a.txt": "a\n", "/e.txt": "e\n" } }); // added e

const { operations, conflicts } = await merge(base, left, right, { hashContent: sha256 });

// operations: [{ op: "modify", path: "/a.txt", source: { side: "left" } },
//              { op: "delete", path: "/c.txt" },
//              { op: "add",    path: "/e.txt", source: { side: "right" } }]
// conflicts:  []
for (const op of operations) applyToTarget(op); // caller materializes; merge-core never writes
```

## API

- **`merge(base, left, right, opts): Promise<MergeResult>`** — the engine. Returns `{ operations, conflicts }`. Never mutates an input.
- **`createTextContentMerger(): ContentMerger`** — the shipped default per-file merger (line-based 3-way text; binary/oversized files fall back to hash-only reconciliation).
- **`threeWayMergeLines(base, left, right)`** — the raw line-level 3-way algorithm the default merger builds on.

`MergeOptions` carries the required `hashContent(stream) => Promise<string>`, plus optional `contentMerger`, `renameStrategy`, `resolve` (conflict resolver), and `textMergeMaxBytes`. Key result types: `MergeOp` (`add` / `modify` / `delete` / `rename`, carrying inline `content` or a `source` reference), `Conflict` (`content` / `modify-delete` / `add-add` / `rename-rename` / `rename-modify` / `type-change`), `MergeResult`, `EntryRef`, `Resolution`, `RenameCandidates`.

## Notes

- **Pure descriptor.** The engine is dry-runnable and trivially testable — it emits operations, it does not apply them.
- **Injected identity.** Equality, exact-rename detection, and same-change collapse all key off the caller's `hashContent`; the package depends on no hashing library. Exact (hash-equal) rename matching is built in; a heuristic `renameStrategy` is pluggable for the leftovers.
- **Injectable content merge.** `merge-core` owns traversal and conflict mechanics; *how* to merge a given file is always replaceable. Files larger than `textMergeMaxBytes` are reconciled by hash only.
- Built red/green TDD.
