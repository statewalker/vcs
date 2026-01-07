/**
 * In-memory FilesApi implementation
 *
 * Provides an in-memory filesystem for tests and temporary storage.
 * Uses a factory function to hide implementation details and provide
 * a clean API.
 */

import { MemFilesApi, FilesApi as WebrunFilesApi } from "@statewalker/webrun-files";
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
 * Create an in-memory FilesApi instance.
 * Useful for tests and temporary storage.
 *
 * @param initialFiles - Optional initial file contents
 * @returns FilesApi instance
 *
 * @example
 * ```typescript
 * // Empty filesystem
 * const files = createInMemoryFilesApi();
 *
 * // With initial files
 * const files = createInMemoryFilesApi({
 *   "/test/file.txt": "content",
 *   "/test/binary.bin": new Uint8Array([1, 2, 3]),
 * });
 * ```
 */
export function createInMemoryFilesApi(
  initialFiles?: Record<string, string | Uint8Array>,
): FilesApi {
  const memApi = new MemFilesApi();
  const wrapped = new WebrunFilesApi(memApi);
  const files = new FilesApiAdapter(wrapped);

  // Populate initial files if provided
  if (initialFiles) {
    // Use an IIFE to handle async initialization
    const initPromise = (async () => {
      for (const [path, content] of Object.entries(initialFiles)) {
        const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
        await files.write(
          path,
          (async function* () {
            yield data;
          })(),
        );
      }
    })();

    // Return a proxy that waits for initialization on first operation
    // This is a pragmatic solution - in practice, tests set up files before use
    let initialized = false;
    const ensureInit = async () => {
      if (!initialized) {
        await initPromise;
        initialized = true;
      }
    };

    return {
      async *read(path: string, options?: ReadOptions) {
        await ensureInit();
        yield* files.read(path, options);
      },
      async write(path: string, content: AsyncIterable<Uint8Array>) {
        await ensureInit();
        return files.write(path, content);
      },
      async mkdir(path: string) {
        await ensureInit();
        return files.mkdir(path);
      },
      async remove(path: string) {
        await ensureInit();
        return files.remove(path);
      },
      async stats(path: string) {
        await ensureInit();
        return files.stats(path);
      },
      async *list(path: string) {
        await ensureInit();
        yield* files.list(path);
      },
      async exists(path: string) {
        await ensureInit();
        return files.exists(path);
      },
      async move(source: string, target: string) {
        await ensureInit();
        return files.move(source, target);
      },
      async copy(source: string, target: string) {
        await ensureInit();
        return files.copy(source, target);
      },
    };
  }

  return files;
}
