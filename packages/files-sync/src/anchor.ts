/**
 * {@link SyncAnchor} helpers — building a manifest from an endpoint and
 * reconstructing a read-only "base" {@link FilesApi} view from a manifest.
 */

import type {
  FileInfo,
  FileStats,
  FilesApi,
  ListOptions,
  ReadOptions,
} from "@statewalker/webrun-files";
import type { ByteStream, SyncAnchor } from "./types.js";

/** Build a fresh anchor manifest by hashing every file in an endpoint. */
export async function buildAnchor(
  files: FilesApi,
  hashContent: (b: ByteStream) => Promise<string>,
): Promise<SyncAnchor> {
  const entries: SyncAnchor["entries"] = {};
  for await (const info of files.list("/", { recursive: true })) {
    if (info.kind !== "file") continue;
    entries[info.path] = {
      contentId: await hashContent(files.read(info.path)),
      size: info.size ?? 0,
      mtime: info.lastModified ?? 0,
    };
  }
  return { entries };
}

/**
 * A read-only base tree reconstructed from a {@link SyncAnchor}.
 *
 * Contract decision 1: the anchor stores NO base bytes. Base content is resolved
 * ON DEMAND by content-id from whichever live endpoint still holds it (both `a`
 * and `b` are searched, hashing lazily). When no endpoint holds the id — i.e.
 * both sides changed the file — `read` yields nothing, and the both-modified
 * path resolves to a conflict in merge-core rather than a bogus merge.
 */
export function anchorBaseView(
  anchor: SyncAnchor,
  a: FilesApi,
  b: FilesApi,
  hashContent: (input: ByteStream) => Promise<string>,
): FilesApi {
  // contentId -> {api, path}, built lazily across a then b on first miss.
  let index: Map<string, { api: FilesApi; path: string }> | undefined;
  const wanted = new Set(Object.values(anchor.entries).map((e) => e.contentId));

  async function buildIndex(): Promise<Map<string, { api: FilesApi; path: string }>> {
    const map = new Map<string, { api: FilesApi; path: string }>();
    for (const api of [a, b]) {
      for await (const info of api.list("/", { recursive: true })) {
        if (info.kind !== "file") continue;
        const id = await hashContent(api.read(info.path));
        if (wanted.has(id) && !map.has(id)) map.set(id, { api, path: info.path });
      }
    }
    return map;
  }

  async function locate(path: string): Promise<{ api: FilesApi; path: string } | undefined> {
    const entry = anchor.entries[path];
    if (!entry) return undefined;
    if (!index) index = await buildIndex();
    return index.get(entry.contentId);
  }

  const readOnly = (op: string) => async (): Promise<never> => {
    throw new Error(`anchor base view is read-only (${op})`);
  };

  return {
    async *read(path: string, _options?: ReadOptions): AsyncIterable<Uint8Array> {
      const loc = await locate(path);
      if (!loc) return; // unresolved base content ⇒ empty (both sides changed it)
      yield* loc.api.read(loc.path);
    },
    async *list(path: string, options?: ListOptions): AsyncIterable<FileInfo> {
      const prefix = path === "/" ? "/" : `${path}/`;
      for (const [p, e] of Object.entries(anchor.entries)) {
        if (p !== path && !p.startsWith(prefix)) continue;
        if (!options?.recursive && p.slice(prefix.length).includes("/")) continue;
        yield {
          name: p.slice(p.lastIndexOf("/") + 1),
          path: p,
          kind: "file",
          size: e.size,
          lastModified: e.mtime,
        };
      }
    },
    async stats(path: string): Promise<FileStats | undefined> {
      const e = anchor.entries[path];
      return e ? { kind: "file", size: e.size, lastModified: e.mtime } : undefined;
    },
    async exists(path: string): Promise<boolean> {
      return path in anchor.entries;
    },
    write: readOnly("write"),
    mkdir: readOnly("mkdir"),
    remove: readOnly("remove"),
    move: readOnly("move"),
    copy: readOnly("copy"),
  } as FilesApi;
}
