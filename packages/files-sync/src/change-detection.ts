/**
 * The cheap-first change-detection ladder.
 *
 * Short-circuits from the cheapest signal to the most expensive:
 *   path/type  →  size  →  stable mtime  →  optional quick fingerprint  →
 *   full content hash (injected `hashContent`).
 *
 * Each rung that can decide "same" or "changed" returns without paying for the
 * next one — in particular a size difference marks a file changed WITHOUT ever
 * hashing, and an equal size+mtime pair is treated as unchanged (rclone's
 * default heuristic) without hashing either.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import type { ByteStream, PathFilter } from "./types.js";

export interface Entry {
  path: string;
  kind: "file" | "directory";
  size?: number;
  mtime?: number;
}

export type Snapshot = Map<string, Entry>;

/** List a whole tree into a path-keyed snapshot, applying an optional filter. */
export async function snapshot(files: FilesApi, filter?: PathFilter): Promise<Snapshot> {
  const map: Snapshot = new Map();
  for await (const info of files.list("/", { recursive: true })) {
    if (filter && info.kind === "file" && !filter(info.path)) continue;
    map.set(info.path, {
      path: info.path,
      kind: info.kind,
      size: info.size,
      mtime: info.lastModified,
    });
  }
  return map;
}

const HEAD_TAIL = 64;

/** Read a bounded byte range as a single buffer (for fingerprint sampling). */
async function readRange(
  files: FilesApi,
  path: string,
  start: number,
  length: number,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of files.read(path, { start, length })) parts.push(chunk);
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** head+tail sample of a file, used by the optional quick-fingerprint rung. */
async function fingerprint(files: FilesApi, path: string, size: number): Promise<Uint8Array> {
  if (size <= HEAD_TAIL * 2) return readRange(files, path, 0, size);
  const head = await readRange(files, path, 0, HEAD_TAIL);
  const tail = await readRange(files, path, size - HEAD_TAIL, HEAD_TAIL);
  const out = new Uint8Array(head.length + tail.length);
  out.set(head, 0);
  out.set(tail, head.length);
  return out;
}

export interface LadderOptions {
  hashContent: (input: ByteStream) => Promise<string>;
  quickFingerprint?: boolean;
}

/**
 * Decide whether `from`'s file at `path` differs from `to`'s file, climbing the
 * ladder only as far as needed. `fromEntry` must exist; `toEntry` may be absent.
 */
export async function isChanged(
  from: FilesApi,
  to: FilesApi,
  path: string,
  fromEntry: Entry,
  toEntry: Entry | undefined,
  opts: LadderOptions,
): Promise<boolean> {
  // path/type rung
  if (!toEntry) return true;
  if (fromEntry.kind !== toEntry.kind) return true;
  if (fromEntry.kind === "directory") return false;

  // size rung — a difference is decisive; never hashes.
  if (fromEntry.size !== toEntry.size) return true;

  // stable-mtime rung — equal size + equal mtime ⇒ unchanged, no hashing.
  if (
    fromEntry.mtime !== undefined &&
    toEntry.mtime !== undefined &&
    fromEntry.mtime === toEntry.mtime
  ) {
    return false;
  }

  const size = fromEntry.size ?? 0;

  // optional quick-fingerprint rung — a sample mismatch decides "changed"
  // without a full hash; a match is inconclusive and falls through.
  if (opts.quickFingerprint) {
    const [fa, fb] = await Promise.all([
      fingerprint(from, path, size),
      fingerprint(to, path, size),
    ]);
    if (!bytesEqual(fa, fb)) return true;
  }

  // full content-hash rung — the ambiguous case.
  const [ha, hb] = await Promise.all([
    opts.hashContent(from.read(path)),
    opts.hashContent(to.read(path)),
  ]);
  return ha !== hb;
}
