/**
 * {@link plan} — pure planning for all sync operations. It reads both endpoints
 * (listing, and hashing only when the ladder demands it) but MUTATES NEITHER.
 *
 *   copy   — new/changed A files → B; extraneous B files KEPT.
 *   sync   — copy, plus extraneous B files DELETED.
 *   move   — copy each A file, then (at execute, after the destination is
 *            verified) delete the source; source is never lost.
 *   check  — the copy diff, transferring nothing (execute is a no-op).
 *   bisync — three-way merge over the anchor (see bisync.ts).
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { planBisync } from "./bisync.js";
import { isChanged, snapshot } from "./change-detection.js";
import type { SyncAction, SyncOp, SyncOptions, SyncPlan } from "./types.js";

export async function plan(
  a: FilesApi,
  b: FilesApi,
  op: SyncOp,
  opts: SyncOptions,
): Promise<SyncPlan> {
  if (op === "bisync") return planBisync(a, b, opts);

  const [snapA, snapB] = await Promise.all([snapshot(a, opts.filter), snapshot(b, opts.filter)]);
  const actions: SyncAction[] = [];

  // A → B: create missing directories, copy new files, update changed files.
  for (const [path, entry] of snapA) {
    const other = snapB.get(path);
    if (entry.kind === "directory") {
      if (!other) actions.push({ kind: "mkdir", path });
      continue;
    }
    if (!other) {
      actions.push({ kind: "copy", path, from: "a" });
    } else if (await isChanged(a, b, path, entry, other, opts)) {
      actions.push({ kind: "update", path, from: "a" });
    }
  }

  // move: schedule source cleanup after each copy (execute verifies first).
  if (op === "move") {
    for (const [path, entry] of snapA) {
      if (entry.kind === "file") actions.push({ kind: "delete", path, side: "a" });
    }
  }

  // sync: delete files in B that no longer exist in A.
  if (op === "sync") {
    for (const [path, entry] of snapB) {
      if (entry.kind === "file" && !snapA.has(path)) {
        actions.push({ kind: "delete", path, side: "b" });
      }
    }
  }

  return { op, actions, conflicts: [] };
}
