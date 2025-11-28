/**
 * Node.js file system implementation
 *
 * Wraps node:fs/promises with the FileApi interface
 * for use in Node.js environments.
 */

import * as fs from "node:fs/promises";
import * as nodePath from "node:path";
import type { DirEntry, FileApi, FileHandle, FileStat } from "./types.js";

/**
 * Node.js file system implementation
 *
 * Wraps node:fs/promises with the FileApi interface.
 */
export class NodeFileApi implements FileApi {
  constructor(private readonly basePath: string = "") {}

  private resolvePath(path: string): string {
    return this.basePath ? nodePath.join(this.basePath, path) : path;
  }

  // === Read Operations ===

  async readFile(path: string): Promise<Uint8Array> {
    const resolved = this.resolvePath(path);
    const buffer = await fs.readFile(resolved);
    return new Uint8Array(buffer);
  }

  async exists(path: string): Promise<boolean> {
    const resolved = this.resolvePath(path);
    try {
      await fs.access(resolved);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string): Promise<FileStat> {
    const resolved = this.resolvePath(path);
    const stats = await fs.stat(resolved);
    return {
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      size: stats.size,
      mtime: stats.mtimeMs,
    };
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const resolved = this.resolvePath(path);
    const entries = await fs.readdir(resolved, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile(),
    }));
  }

  // === Write Operations ===

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const resolved = this.resolvePath(path);
    await fs.writeFile(resolved, data);
  }

  async mkdir(path: string): Promise<void> {
    const resolved = this.resolvePath(path);
    await fs.mkdir(resolved, { recursive: true });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const resolvedOld = this.resolvePath(oldPath);
    const resolvedNew = this.resolvePath(newPath);
    await fs.rename(resolvedOld, resolvedNew);
  }

  async unlink(path: string): Promise<boolean> {
    const resolved = this.resolvePath(path);
    try {
      await fs.unlink(resolved);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  async rmdir(path: string): Promise<boolean> {
    const resolved = this.resolvePath(path);
    try {
      // Check if exists first since fs.rm with force doesn't report if path existed
      await fs.access(resolved);
      await fs.rm(resolved, { recursive: true, force: true });
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return false;
      }
      throw err;
    }
  }

  // === Random Access ===

  async openFile(path: string): Promise<FileHandle> {
    const resolved = this.resolvePath(path);
    const fd = await fs.open(resolved, "r");

    return {
      async read(
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ): Promise<number> {
        const result = await fd.read(buffer, offset, length, position);
        return result.bytesRead;
      },

      async close(): Promise<void> {
        await fd.close();
      },
    };
  }

  // === Path Operations ===

  join(...segments: string[]): string {
    return nodePath.join(...segments);
  }

  dirname(path: string): string {
    return nodePath.dirname(path);
  }

  basename(path: string): string {
    return nodePath.basename(path);
  }
}

/**
 * Create a NodeFileApi instance
 *
 * @param basePath Optional base path (all paths will be relative to this)
 */
export function createNodeFileApi(basePath?: string): FileApi {
  return new NodeFileApi(basePath);
}
