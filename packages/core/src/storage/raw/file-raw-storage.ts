import { dirname, type FilesApi, joinPath } from "../../common/files/index.js";
import type { RawStorage } from "./raw-storage.js";

/**
 * File-based RawStorage with Git loose object structure
 *
 * Objects are stored in a two-level directory structure:
 * - First 2 characters of key -> directory name
 * - Remaining characters -> filename
 *
 * Example: key "abc123..." is stored at "basePath/ab/c123..."
 */
export class FileRawStorage implements RawStorage {
  constructor(
    private readonly files: FilesApi,
    private readonly basePath: string,
  ) {}

  private getPath(key: string): string {
    const prefix = key.substring(0, 2);
    const suffix = key.substring(2);
    return joinPath(this.basePath, prefix, suffix);
  }

  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<void> {
    const path = this.getPath(key);
    const dir = dirname(path);
    await this.files.mkdir(dir);
    await this.files.write(path, content);
  }

  async *load(key: string, options?: { start?: number; end?: number }): AsyncIterable<Uint8Array> {
    const path = this.getPath(key);
    const stats = await this.files.stats(path);
    if (!stats) {
      throw new Error(`Key not found: ${key}`);
    }

    // If range options specified, read full content and slice
    // TODO: Implement range reading if FilesApi supports it
    if (options?.start !== undefined || options?.end !== undefined) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of this.files.read(path)) {
        chunks.push(chunk);
      }
      const fullContent = concatChunks(chunks);
      const start = options.start ?? 0;
      const end = options.end ?? fullContent.length;
      yield fullContent.subarray(start, end);
    } else {
      yield* this.files.read(path);
    }
  }

  async has(key: string): Promise<boolean> {
    const path = this.getPath(key);
    const stats = await this.files.stats(path);
    return stats !== undefined && stats !== null;
  }

  async remove(key: string): Promise<boolean> {
    const path = this.getPath(key);
    const stats = await this.files.stats(path);
    if (!stats) return false;

    try {
      await this.files.remove(path);
      return true;
    } catch {
      return false;
    }
  }

  async *keys(): AsyncIterable<string> {
    try {
      const seenPrefixes = new Set<string>();
      for await (const prefixEntry of this.files.list(this.basePath)) {
        if (prefixEntry.kind !== "directory") continue;
        if (prefixEntry.name.length !== 2) continue;
        if (seenPrefixes.has(prefixEntry.name)) continue;
        seenPrefixes.add(prefixEntry.name);

        const prefixPath = joinPath(this.basePath, prefixEntry.name);
        try {
          for await (const suffixEntry of this.files.list(prefixPath)) {
            if (suffixEntry.kind !== "file") continue;
            yield prefixEntry.name + suffixEntry.name;
          }
        } catch {
          // Skip inaccessible directories
        }
      }
    } catch {
      // Base path doesn't exist
    }
  }

  async size(key: string): Promise<number> {
    const path = this.getPath(key);
    const stats = await this.files.stats(path);
    return stats?.size ?? -1;
  }
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
