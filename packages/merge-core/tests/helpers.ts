import { createHash } from "node:crypto";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import type { ByteStream, MergeOp } from "../src/index.js";

/** SHA-256 hex over a byte stream — a plausible injected `hashContent`. */
export async function sha256(input: ByteStream): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of input) h.update(chunk);
  return h.digest("hex");
}

/** Build an in-memory tree from a { path: content } record. */
export function tree(files: Record<string, string | Uint8Array>): MemFilesApi {
  return new MemFilesApi({ initialFiles: files });
}

/** Read a whole file as a UTF-8 string. */
export async function readText(files: MemFilesApi, path: string): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const chunk of files.read(path)) parts.push(chunk);
  return new TextDecoder().decode(concat(parts));
}

/** Read a whole file as bytes. */
export async function readBytes(files: MemFilesApi, path: string): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const chunk of files.read(path)) parts.push(chunk);
  return concat(parts);
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

/** Snapshot every file path + bytes in a tree (for purity assertions). */
export async function fingerprint(files: MemFilesApi): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for await (const info of files.list("/", { recursive: true })) {
    if (info.kind === "file") out[info.path] = await sha256(files.read(info.path));
  }
  return out;
}

export function op(operations: MergeOp[], path: string): MergeOp | undefined {
  return operations.find((o) => o.path === path);
}
