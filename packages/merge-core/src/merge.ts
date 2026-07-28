import { createTextContentMerger } from "./content-merger.js";
import type {
  Conflict,
  ConflictKind,
  EntryRef,
  FileKind,
  FilesApi,
  MergeOp,
  MergeOptions,
  MergeResult,
  Side,
} from "./types.js";

/** Internal snapshot node — an {@link EntryRef} plus the file size. */
interface Node extends EntryRef {
  size?: number;
}

type Snapshot = Map<string, Node>;

const DEFAULT_TEXT_MERGE_MAX_BYTES = 1 << 20; // 1 MiB

/** Read a whole file into memory (bounded: only used below the text threshold). */
async function readAll(files: FilesApi, path: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of files.read(path)) {
    parts.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function isBinary(bytes: Uint8Array): boolean {
  return bytes.includes(0);
}

/** Build a hashed snapshot of every file (and directory) in a tree. */
async function snapshot(
  files: FilesApi,
  hashContent: MergeOptions["hashContent"],
): Promise<Snapshot> {
  const map: Snapshot = new Map();
  for await (const info of files.list("/", { recursive: true })) {
    if (info.kind === "file") {
      const hash = await hashContent(files.read(info.path));
      map.set(info.path, { path: info.path, kind: "file", hash, size: info.size });
    } else {
      map.set(info.path, { path: info.path, kind: "directory" });
    }
  }
  return map;
}

function toRef(node: Node | undefined): EntryRef | undefined {
  if (!node) return undefined;
  return { path: node.path, kind: node.kind, hash: node.hash };
}

/** Per-side fate of a single base file, relative to base. */
type Fate =
  | { t: "unchanged" }
  | { t: "modified"; hash: string }
  | { t: "deleted" }
  | { t: "renamed"; to: string; hash?: string }
  | { t: "typechange"; kind: FileKind };

/**
 * Detect renames on one side: base files that vanished re-appearing as added
 * files. Exact (hash-equal) matching is built in; leftovers optionally go to a
 * caller-supplied heuristic. Returns `basePath -> targetPath` and the set of
 * target paths consumed (so they are not also counted as standalone adds).
 */
function detectRenames(
  base: Snapshot,
  side: Snapshot,
  strategy: MergeOptions["renameStrategy"],
): { renames: Map<string, string>; consumed: Set<string> } {
  const deleted: Node[] = [];
  const added: Node[] = [];
  for (const node of base.values()) {
    if (node.kind === "file" && !side.has(node.path)) deleted.push(node);
  }
  for (const node of side.values()) {
    if (node.kind === "file" && !base.has(node.path)) added.push(node);
  }
  deleted.sort((a, b) => (a.path < b.path ? -1 : 1));
  added.sort((a, b) => (a.path < b.path ? -1 : 1));

  const renames = new Map<string, string>();
  const consumed = new Set<string>();

  // Built-in exact rename: greedy hash-equal pairing, deterministic by path.
  for (const d of deleted) {
    const match = added.find((a) => !consumed.has(a.path) && a.hash === d.hash);
    if (match) {
      renames.set(d.path, match.path);
      consumed.add(match.path);
    }
  }

  // Optional heuristic over what exact matching left behind.
  if (strategy) {
    const leftoverDeleted = deleted.filter((d) => !renames.has(d.path)).map(toRef) as EntryRef[];
    const leftoverAdded = added.filter((a) => !consumed.has(a.path)).map(toRef) as EntryRef[];
    if (leftoverDeleted.length && leftoverAdded.length) {
      for (const { from, to } of strategy({ deleted: leftoverDeleted, added: leftoverAdded })) {
        if (renames.has(from) || consumed.has(to)) continue;
        if (!base.has(from) || !side.has(to)) continue;
        renames.set(from, to);
        consumed.add(to);
      }
    }
  }

  return { renames, consumed };
}

function fateOf(baseNode: Node, side: Snapshot, renames: Map<string, string>): Fate {
  const target = renames.get(baseNode.path);
  if (target) return { t: "renamed", to: target, hash: side.get(target)?.hash };
  const sideNode = side.get(baseNode.path);
  if (!sideNode) return { t: "deleted" };
  if (sideNode.kind !== baseNode.kind) return { t: "typechange", kind: sideNode.kind };
  if (baseNode.kind === "directory") return { t: "unchanged" };
  return sideNode.hash === baseNode.hash ? { t: "unchanged" } : { t: "modified", hash: sideNode.hash as string };
}

export async function merge(
  base: FilesApi,
  left: FilesApi,
  right: FilesApi,
  opts: MergeOptions,
): Promise<MergeResult> {
  const { hashContent } = opts;
  const contentMerger = opts.contentMerger ?? createTextContentMerger();
  const threshold = opts.textMergeMaxBytes ?? DEFAULT_TEXT_MERGE_MAX_BYTES;

  const [baseSnap, leftSnap, rightSnap] = await Promise.all([
    snapshot(base, hashContent),
    snapshot(left, hashContent),
    snapshot(right, hashContent),
  ]);

  const leftRen = detectRenames(baseSnap, leftSnap, opts.renameStrategy);
  const rightRen = detectRenames(baseSnap, rightSnap, opts.renameStrategy);

  const operations: MergeOp[] = [];
  const conflicts: Conflict[] = [];

  const pushConflict = (kind: ConflictKind, path: string, extra?: Partial<Conflict>) => {
    conflicts.push({
      kind,
      path,
      base: toRef(baseSnap.get(path)),
      left: toRef(leftSnap.get(path)),
      right: toRef(rightSnap.get(path)),
      ...extra,
    });
  };

  // Reconcile a base file both sides modified: hash first, then line merge.
  const reconcileModify = async (path: string) => {
    const l = leftSnap.get(path) as Node;
    const r = rightSnap.get(path) as Node;
    const overThreshold = (l.size ?? 0) > threshold || (r.size ?? 0) > threshold;
    if (overThreshold) {
      pushConflict("content", path);
      return;
    }
    const [lb, rb, bb] = await Promise.all([
      readAll(left, path),
      readAll(right, path),
      readAll(base, path),
    ]);
    if (isBinary(lb) || isBinary(rb) || isBinary(bb)) {
      pushConflict("content", path);
      return;
    }
    const res = contentMerger.merge({ base: bb, left: lb, right: rb, path });
    if (res.conflict || !res.merged) {
      pushConflict("content", path);
      return;
    }
    operations.push({ op: "modify", path, kind: "file", content: res.merged });
  };

  // --- Base entities (files + directories present in base) ---
  for (const baseNode of baseSnap.values()) {
    const p = baseNode.path;
    const fl = fateOf(baseNode, leftSnap, leftRen.renames);
    const fr = fateOf(baseNode, rightSnap, rightRen.renames);

    if (fl.t === "unchanged" && fr.t === "unchanged") continue;

    // Any type change is out of auto-merge scope.
    if (fl.t === "typechange" || fr.t === "typechange") {
      pushConflict("type-change", p);
      continue;
    }

    // Deletes.
    if (fl.t === "deleted" || fr.t === "deleted") {
      if (fl.t === "deleted" && fr.t === "deleted") {
        operations.push({ op: "delete", path: p });
      } else {
        const other = fl.t === "deleted" ? fr : fl;
        if (other.t === "unchanged") {
          operations.push({ op: "delete", path: p });
        } else if (other.t === "modified") {
          pushConflict("modify-delete", p);
        } else if (other.t === "renamed") {
          // Both remove the old path; the rename re-adds content elsewhere.
          operations.push({ op: "rename", from: p, path: other.to, kind: "file" });
        }
      }
      continue;
    }

    // Renames.
    if (fl.t === "renamed" || fr.t === "renamed") {
      if (fl.t === "renamed" && fr.t === "renamed") {
        if (fl.to === fr.to && fl.hash === fr.hash) {
          operations.push({ op: "rename", from: p, path: fl.to, kind: "file" });
        } else {
          pushConflict("rename-rename", p, { paths: [fl.to, fr.to] });
        }
      } else {
        const ren = fl.t === "renamed" ? fl : (fr as Extract<Fate, { t: "renamed" }>);
        const other = fl.t === "renamed" ? fr : fl;
        if (other.t === "unchanged") {
          operations.push({ op: "rename", from: p, path: ren.to, kind: "file" });
        } else {
          // other is "modified": move vs edit-in-place.
          pushConflict("rename-modify", p, { paths: [ren.to] });
        }
      }
      continue;
    }

    // Remaining: each side is unchanged or modified (at least one modified).
    if (fl.t === "modified" && fr.t === "modified") {
      if (fl.hash === fr.hash) {
        operations.push({ op: "modify", path: p, kind: "file", source: { side: "left", path: p } });
      } else {
        await reconcileModify(p);
      }
    } else {
      const side: Side = fl.t === "modified" ? "left" : "right";
      operations.push({ op: "modify", path: p, kind: "file", source: { side, path: p } });
    }
  }

  // --- Standalone adds (file paths absent from base, not rename targets) ---
  const addPaths = new Set<string>();
  const collectAdds = (snap: Snapshot, consumed: Set<string>) => {
    for (const node of snap.values()) {
      if (node.kind === "file" && !baseSnap.has(node.path) && !consumed.has(node.path)) {
        addPaths.add(node.path);
      }
    }
  };
  collectAdds(leftSnap, leftRen.consumed);
  collectAdds(rightSnap, rightRen.consumed);

  for (const p of addPaths) {
    const l = leftRen.consumed.has(p) ? undefined : leftSnap.get(p);
    const r = rightRen.consumed.has(p) ? undefined : rightSnap.get(p);
    const lAdd = l?.kind === "file" && !baseSnap.has(p) ? l : undefined;
    const rAdd = r?.kind === "file" && !baseSnap.has(p) ? r : undefined;
    if (lAdd && rAdd) {
      if (lAdd.hash === rAdd.hash) {
        operations.push({ op: "add", path: p, kind: "file", source: { side: "left", path: p } });
      } else {
        pushConflict("add-add", p);
      }
    } else if (lAdd) {
      operations.push({ op: "add", path: p, kind: "file", source: { side: "left", path: p } });
    } else if (rAdd) {
      operations.push({ op: "add", path: p, kind: "file", source: { side: "right", path: p } });
    }
  }

  // --- Fold injected resolutions into operations; keep the rest. ---
  const remaining: Conflict[] = [];
  for (const c of conflicts) {
    const resolution = opts.resolve?.(c);
    if (resolution) operations.push(...resolution.operations);
    else remaining.push(c);
  }

  // Deterministic ordering.
  operations.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.op !== b.op) return a.op < b.op ? -1 : 1;
    const af = a.from ?? "";
    const bf = b.from ?? "";
    return af < bf ? -1 : af > bf ? 1 : 0;
  });
  remaining.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });

  return { operations, conflicts: remaining };
}
