/**
 * {@link execute} — applies a {@link SyncPlan}, emitting {@link SyncEvent}s.
 *
 * - Every copy/update is verified at the destination per {@link VerificationMode}.
 * - `move` never deletes a source until its destination is verified (the delete
 *   action re-verifies before removing).
 * - Interruptible + resumable: completed action indices are recorded in the
 *   injected {@link CheckpointStore} before each `done` event, so a second call
 *   with the same store completes the remainder with no duplicate work.
 * - `check` mutates nothing.
 * - After a fully-clean `bisync`, a fresh anchor is written from the merged state.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { buildAnchor } from "./anchor.js";
import { createStreamingTransfer } from "./transfer.js";
import type {
  ByteStream,
  SyncAction,
  SyncEvent,
  SyncOp,
  SyncOptions,
  SyncPlan,
  Transfer,
  VerificationMode,
} from "./types.js";

async function verifyCopy(
  mode: VerificationMode,
  source: FilesApi,
  dest: FilesApi,
  path: string,
  hashContent: (b: ByteStream) => Promise<string>,
): Promise<boolean> {
  if (mode === "content-hash" || mode === "backend-hash" || mode === "read-after-write") {
    const dstat = await dest.stats(path);
    if (!dstat) return false;
    const [hs, hd] = await Promise.all([
      hashContent(source.read(path)),
      hashContent(dest.read(path)),
    ]);
    return hs === hd;
  }
  // "size" (default) and "mtime" — cross-endpoint mtime is not comparable, so
  // both settle on the byte-count check.
  const [s, d] = await Promise.all([source.stats(path), dest.stats(path)]);
  return !!s && !!d && s.size === d.size;
}

interface Outcome {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
}

async function applyAction(
  action: SyncAction,
  a: FilesApi,
  b: FilesApi,
  op: SyncOp,
  transfer: Transfer,
  verify: VerificationMode,
  opts: SyncOptions,
): Promise<Outcome> {
  const pick = (s: "a" | "b") => (s === "a" ? a : b);
  switch (action.kind) {
    case "mkdir": {
      // One-way ops create missing directories on the destination (B).
      await b.mkdir(action.path);
      return { ok: true };
    }
    case "copy":
    case "update": {
      const from = pick(action.from);
      const to = action.from === "a" ? b : a;
      await transfer.run(action, from, to);
      const ok = await verifyCopy(verify, from, to, action.path, opts.hashContent);
      return ok ? { ok: true } : { ok: false, reason: "destination verification failed" };
    }
    case "move": {
      await pick(action.side).move(action.from, action.to);
      return { ok: true };
    }
    case "delete": {
      // A `move` source cleanup: never delete until the destination verifies.
      if (op === "move" && action.side === "a") {
        const verified = await verifyCopy(verify, a, b, action.path, opts.hashContent);
        if (!verified) {
          return { ok: false, skipped: true, reason: "destination not verified; source retained" };
        }
        await a.remove(action.path);
        return { ok: true };
      }
      await pick(action.side).remove(action.path);
      return { ok: true };
    }
  }
}

export async function* execute(
  plan: SyncPlan,
  a: FilesApi,
  b: FilesApi,
  opts: SyncOptions,
): AsyncIterable<SyncEvent> {
  const transfer = opts.transfer ?? createStreamingTransfer();
  const verify = opts.verify ?? "size";

  for (const message of plan.warnings ?? []) yield { type: "warning", message };
  for (const conflict of plan.conflicts) yield { type: "conflict", conflict };

  if (plan.op === "check") return; // compare-only: transfers nothing, mutates nothing.

  const done = (await opts.checkpoint?.read()) ?? new Set<number>();
  let anyFailure = false;

  for (let i = 0; i < plan.actions.length; i++) {
    if (done.has(i)) continue;
    const action = plan.actions[i];
    yield { type: "start", index: i, action };
    try {
      const outcome = await applyAction(action, a, b, plan.op, transfer, verify, opts);
      if (!outcome.ok) {
        anyFailure = true;
        const reason = outcome.reason ?? "failed";
        yield outcome.skipped
          ? { type: "skipped", index: i, action, reason }
          : { type: "failed", index: i, action, reason };
        continue;
      }
      await opts.checkpoint?.add(i);
      yield { type: "done", index: i, action };
    } catch (error) {
      anyFailure = true;
      yield {
        type: "failed",
        index: i,
        action,
        reason: String((error as Error)?.message ?? error),
      };
    }
  }

  // A clean bisync converges both endpoints; record the merged state as the
  // next base. Skipped if anything failed or any conflict was left unresolved.
  if (plan.op === "bisync" && !anyFailure && plan.conflicts.length === 0 && opts.anchorStore) {
    await opts.anchorStore.write(opts.pairKey ?? "default", await buildAnchor(a, opts.hashContent));
  }
}
