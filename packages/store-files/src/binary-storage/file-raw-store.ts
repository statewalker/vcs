/**
 * File-based RawStore implementation
 *
 * Stores content as files using Git's loose object directory structure.
 * Each key (object ID) is stored as a file with path: prefix/suffix
 * where prefix = first 2 chars, suffix = remaining chars.
 *
 * Implements the new RawStore interface from binary-storage.
 */

import { dirname, type FilesApi, joinPath } from "@statewalker/webrun-files";
import type { RawStore } from "@webrun-vcs/vcs/binary-storage";

/**
 * Collect async iterable to Uint8Array
 */
async function collect(input: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for await (const chunk of input) {
    chunks.push(chunk);
    totalLength += chunk.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

/**
 * File-based storage with Git loose object structure
 *
 * Objects are stored in a two-level directory structure:
 * - First 2 characters of key -> directory name
 * - Remaining characters -> filename
 *
 * Example: key "abc123..." is stored at "basePath/ab/c123..."
 */
export class FileRawStore implements RawStore {
  /**
   * Create file-based storage
   *
   * @param files FilesApi for file operations
   * @param basePath Base directory for storing objects
   */
  constructor(
    private readonly files: FilesApi,
    private readonly basePath: string,
  ) {}

  /**
   * Get the file path for a key
   */
  private getPath(key: string): string {
    const prefix = key.substring(0, 2);
    const suffix = key.substring(2);
    return joinPath(this.basePath, prefix, suffix);
  }

  /**
   * Store byte stream under key
   *
   * @returns Number of bytes stored
   */
  async store(key: string, content: AsyncIterable<Uint8Array>): Promise<number> {
    const path = this.getPath(key);
    const dir = dirname(path);

    // Ensure directory exists
    await this.files.mkdir(dir);

    // Collect content and write
    const bytes = await collect(content);
    await this.files.write(path, [bytes]);

    return bytes.length;
  }

  /**
   * Load byte stream by key
   */
  async *load(key: string): AsyncIterable<Uint8Array> {
    const path = this.getPath(key);

    try {
      const bytes = await this.files.readFile(path);
      yield bytes;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        throw new Error(`Key not found: ${key}`);
      }
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  async has(key: string): Promise<boolean> {
    const path = this.getPath(key);

    try {
      await this.files.stats(path);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Delete content by key
   */
  async delete(key: string): Promise<boolean> {
    const path = this.getPath(key);

    try {
      await this.files.remove(path);
      return true;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * List all keys
   *
   * Scans the two-level directory structure and yields all object keys.
   */
  async *keys(): AsyncIterable<string> {
    try {
      for await (const prefixEntry of this.files.list(this.basePath)) {
        if (prefixEntry.kind !== "directory") continue;
        if (prefixEntry.name.length !== 2) continue;

        const prefixPath = joinPath(this.basePath, prefixEntry.name);
        try {
          for await (const suffixEntry of this.files.list(prefixPath)) {
            if (suffixEntry.kind !== "file") continue;

            const key = prefixEntry.name + suffixEntry.name;
            yield key;
          }
        } catch {
          // Skip inaccessible directories
        }
      }
    } catch {
      // Base path doesn't exist or is inaccessible
    }
  }

  /**
   * Get content size for a key
   */
  async size(key: string): Promise<number | undefined> {
    const path = this.getPath(key);

    try {
      const stats = await this.files.stats(path);
      return stats?.size;
    } catch (error) {
      if (this.isNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Check if error is a "not found" error
   */
  private isNotFoundError(error: unknown): boolean {
    if (error && typeof error === "object" && "code" in error) {
      return (error as { code: string }).code === "ENOENT";
    }
    return false;
  }
}

/**
 * Create a new file-based raw store
 */
export function createFileRawStore(files: FilesApi, basePath: string): FileRawStore {
  return new FileRawStore(files, basePath);
}
