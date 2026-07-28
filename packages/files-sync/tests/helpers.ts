import { createHash } from "node:crypto";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import type {
  AnchorStore,
  ByteStream,
  CheckpointStore,
  FilesApi,
  SyncAnchor,
  SyncEvent,
  SyncOptions,
} from "../src/index.js";
import { execute } from "../src/index.js";

/** SHA-256 hex over a byte stream — a plausible injected `hashContent`. */
export async function sha256(input: ByteStream): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of input) h.update(chunk);
  return h.digest("hex");
}

/** Build an in-memory tree from a { path: content } record. */
export function tree(files: Record<string, string | Uint8Array> = {}): MemFilesApi {
  return new MemFilesApi({ initialFiles: files });
}

export async function readText(files: FilesApi, path: string): Promise<string | undefined> {
  const stat = await files.stats(path);
  if (!stat || stat.kind !== "file") return undefined;
  const parts: Uint8Array[] = [];
  for await (const chunk of files.read(path)) parts.push(chunk);
  return new TextDecoder().decode(concat(parts));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** Snapshot every file path + content hash (for purity / mutation assertions). */
export async function fingerprint(files: FilesApi): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const info of files.list("/", { recursive: true })) {
    if (info.kind === "file") out[info.path] = await sha256(files.read(info.path));
  }
  return out;
}

/** Drain an execute() run into an array of events. */
export async function run(events: AsyncIterable<SyncEvent>): Promise<SyncEvent[]> {
  const out: SyncEvent[] = [];
  for await (const e of events) out.push(e);
  return out;
}

/** Plan + fully execute; returns the collected events. */
export async function sync(
  plan: import("../src/index.js").SyncPlan,
  a: FilesApi,
  b: FilesApi,
  opts: SyncOptions,
): Promise<SyncEvent[]> {
  return run(execute(plan, a, b, opts));
}

export class MemAnchorStore implements AnchorStore {
  private map = new Map<string, SyncAnchor>();
  async read(pairKey: string): Promise<SyncAnchor | undefined> {
    return this.map.get(pairKey);
  }
  async write(pairKey: string, anchor: SyncAnchor): Promise<void> {
    this.map.set(pairKey, anchor);
  }
}

export class MemCheckpoint implements CheckpointStore {
  completed = new Set<number>();
  async read(): Promise<Set<number>> {
    return new Set(this.completed);
  }
  async add(index: number): Promise<void> {
    this.completed.add(index);
  }
}
