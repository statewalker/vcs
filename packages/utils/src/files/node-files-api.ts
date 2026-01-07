/**
 * Node.js filesystem-backed FilesApi implementation
 *
 * Provides a FilesApi backed by the Node.js filesystem.
 * Uses a factory function to hide implementation details and provide
 * a clean API.
 */

import { NodeFilesApi, FilesApi as WebrunFilesApi } from "@statewalker/webrun-files";
import type { FileInfo, FileStats, FilesApi, ReadOptions } from "./files-api.js";

/**
 * Adapts webrun-files FilesApi to our FilesApi interface.
 *
 * The webrun-files FilesApi has a slightly different interface (e.g., FileInfo
 * includes path property, ReadStreamOptions uses start/end instead of start/len).
 * This adapter bridges the gap.
 */
class FilesApiAdapter implements FilesApi {
  constructor(private readonly wrapped: WebrunFilesApi) {}

  async *read(path: string, options?: ReadOptions): AsyncIterable<Uint8Array> {
    const readOptions = options
      ? {
          start: options.start,
          end:
            options.start !== undefined && options.len !== undefined
              ? options.start + options.len
              : undefined,
          signal: options.signal,
        }
      : undefined;
    yield* this.wrapped.read(path, readOptions);
  }

  write(path: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    return this.wrapped.write(path, content);
  }

  mkdir(path: string): Promise<void> {
    return this.wrapped.mkdir(path);
  }

  remove(path: string): Promise<boolean> {
    return this.wrapped.remove(path);
  }

  async stats(path: string): Promise<FileStats | undefined> {
    const info = await this.wrapped.stats(path);
    if (!info) return undefined;
    return {
      kind: info.kind,
      size: info.size,
      lastModified: info.lastModified,
    };
  }

  async *list(path: string): AsyncIterable<FileInfo> {
    for await (const entry of this.wrapped.list(path)) {
      yield {
        name: entry.name,
        path: entry.path,
        kind: entry.kind,
        size: entry.size,
        lastModified: entry.lastModified,
      };
    }
  }

  exists(path: string): Promise<boolean> {
    return this.wrapped.exists(path);
  }

  move(source: string, target: string): Promise<boolean> {
    return this.wrapped.move(source, target);
  }

  copy(source: string, target: string): Promise<boolean> {
    return this.wrapped.copy(source, target);
  }
}

/**
 * Create a Node.js filesystem-backed FilesApi instance.
 *
 * @param options.fs - Node.js fs/promises module
 * @param options.rootDir - Root directory for all operations
 * @returns FilesApi instance
 *
 * @example
 * ```typescript
 * import * as fs from "node:fs/promises";
 *
 * const files = createNodeFilesApi({
 *   fs,
 *   rootDir: "/path/to/repo",
 * });
 * ```
 */
export function createNodeFilesApi(options: {
  fs: typeof import("node:fs/promises");
  rootDir: string;
}): FilesApi {
  const nodeApi = new NodeFilesApi(options);
  const wrapped = new WebrunFilesApi(nodeApi);
  return new FilesApiAdapter(wrapped);
}
