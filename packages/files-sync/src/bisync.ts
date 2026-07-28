/**
 * Bidirectional sync — a THREE-WAY merge over a sync-owned {@link SyncAnchor},
 * delegated to `@statewalker/merge-core`. This is NEVER two chained one-way syncs.
 *
 * base  = the anchor manifest (with base bytes resolved on demand, see anchor.ts)
 * left  = endpoint `a`   right = endpoint `b`
 *
 * merge-core returns operations relative to the merged tree; each is translated
 * into {@link SyncAction}s applied to BOTH endpoints, and its conflicts are
 * surfaced (or folded away by an injected `resolve`, inside merge-core).
 *
 * both-modified policy: files-sync installs a content merger that ALWAYS
 * conflicts, so a file changed on both sides is a conflict (optionally resolved
 * by the injected policy) — it is never silently line-merged.
 *
 * No-anchor first bisync: with no anchor there is no base, so a true 3-way merge
 * is impossible. We fall back to a CONSERVATIVE UNION — propagate additions both
 * ways, delete nothing — and emit a warning. Files present on both sides with
 * differing content are surfaced as conflicts, never overwritten.
 */

import { merge } from "@statewalker/merge-core";
import type { FilesApi } from "@statewalker/webrun-files";
import { anchorBaseView } from "./anchor.js";
import { isChanged, snapshot } from "./change-detection.js";
import type { SyncAction, SyncConflict, SyncOptions, SyncPlan } from "./types.js";

const alwaysConflictMerger = { merge: () => ({ conflict: true as const }) };

export async function planBisync(a: FilesApi, b: FilesApi, opts: SyncOptions): Promise<SyncPlan> {
  const pairKey = opts.pairKey ?? "default";
  const anchor = await opts.anchorStore?.read(pairKey);

  if (!anchor) return planUnion(a, b, opts);

  const base = anchorBaseView(anchor, a, b, opts.hashContent);
  const result = await merge(base, a, b, {
    hashContent: opts.hashContent,
    contentMerger: alwaysConflictMerger,
    resolve: opts.resolve,
  });

  const [snapA, snapB] = await Promise.all([snapshot(a, opts.filter), snapshot(b, opts.filter)]);
  const actions: SyncAction[] = [];

  for (const op of result.operations) {
    switch (op.op) {
      case "add":
      case "modify": {
        if (!op.source) {
          throw new Error(`bisync cannot apply an inline-content ${op.op} for ${op.path}`);
        }
        const from = op.source.side === "left" ? "a" : "b";
        actions.push({ kind: op.op === "add" ? "copy" : "update", path: op.path, from });
        break;
      }
      case "delete": {
        // Propagate the deletion to whichever side still holds the file.
        if (snapA.has(op.path)) actions.push({ kind: "delete", path: op.path, side: "a" });
        if (snapB.has(op.path)) actions.push({ kind: "delete", path: op.path, side: "b" });
        break;
      }
      case "rename": {
        const from = op.from as string;
        if (snapA.has(from)) actions.push({ kind: "move", from, to: op.path, side: "a" });
        if (snapB.has(from)) actions.push({ kind: "move", from, to: op.path, side: "b" });
        break;
      }
    }
  }

  return { op: "bisync", actions, conflicts: result.conflicts };
}

/** Conservative union used for the first bisync (no anchor yet). */
async function planUnion(a: FilesApi, b: FilesApi, opts: SyncOptions): Promise<SyncPlan> {
  const [snapA, snapB] = await Promise.all([snapshot(a, opts.filter), snapshot(b, opts.filter)]);
  const actions: SyncAction[] = [];
  const conflicts: SyncConflict[] = [];

  for (const [path, entry] of snapA) {
    if (entry.kind !== "file") continue;
    const other = snapB.get(path);
    if (!other) {
      actions.push({ kind: "copy", path, from: "a" });
    } else if (await isChanged(a, b, path, entry, other, opts)) {
      // Both sides hold divergent content and there is no base to arbitrate.
      conflicts.push({
        kind: "content",
        path,
        left: { path, kind: "file" },
        right: { path, kind: "file" },
      });
    }
  }
  for (const [path, entry] of snapB) {
    if (entry.kind !== "file") continue;
    if (!snapA.has(path)) actions.push({ kind: "copy", path, from: "b" });
  }

  return {
    op: "bisync",
    actions,
    conflicts,
    warnings: ["no sync anchor; performing conservative union (additions only, no deletions)"],
  };
}
