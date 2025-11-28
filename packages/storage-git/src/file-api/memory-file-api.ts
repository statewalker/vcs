/**
 * In-memory file system implementation
 *
 * Provides a fast, in-memory file system for testing Git storage
 * without disk I/O overhead. Also useful for browser environments.
 */

import type { DirEntry, FileApi, FileHandle, FileStat } from "./types.js";

interface MemoryFile {
  type: "file";
  content: Uint8Array;
  mtime: number;
}

interface MemoryDir {
  type: "dir";
  children: Map<string, MemoryFile | MemoryDir>;
  mtime: number;
}

type MemoryNode = MemoryFile | MemoryDir;

/**
 * Create a file system error with code
 */
function createError(code: string, message: string): Error {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

/**
 * In-memory file system implementation
 *
 * Features:
 * - No disk I/O (fast tests)
 * - Deterministic behavior
 * - Easy to inspect state
 * - Supports simulating errors
 */
export class MemoryFileApi implements FileApi {
  private root: MemoryDir = {
    type: "dir",
    children: new Map(),
    mtime: Date.now(),
  };

  // === Read Operations ===

  async readFile(path: string): Promise<Uint8Array> {
    const node = this.getNode(path);
    if (!node) {
      throw createError("ENOENT", `File not found: ${path}`);
    }
    if (node.type !== "file") {
      throw createError("EISDIR", `Is a directory: ${path}`);
    }
    // Return a copy to prevent external mutation
    return new Uint8Array(node.content);
  }

  async exists(path: string): Promise<boolean> {
    return this.getNode(path) !== undefined;
  }

  async stat(path: string): Promise<FileStat> {
    const node = this.getNode(path);
    if (!node) {
      throw createError("ENOENT", `Path not found: ${path}`);
    }
    return {
      isFile: node.type === "file",
      isDirectory: node.type === "dir",
      size: node.type === "file" ? node.content.length : 0,
      mtime: node.mtime,
    };
  }

  async readdir(path: string): Promise<DirEntry[]> {
    const node = this.getNode(path);
    if (!node) {
      throw createError("ENOENT", `Directory not found: ${path}`);
    }
    if (node.type !== "dir") {
      throw createError("ENOTDIR", `Not a directory: ${path}`);
    }
    return Array.from(node.children.entries()).map(([name, child]) => ({
      name,
      isDirectory: child.type === "dir",
      isFile: child.type === "file",
    }));
  }

  // === Write Operations ===

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const segments = this.parsePath(path);
    const fileName = segments.pop();
    if (!fileName) {
      throw createError("EINVAL", `Invalid path: ${path}`);
    }

    const parentDir = this.getOrCreateDir(segments);
    parentDir.children.set(fileName, {
      type: "file",
      content: new Uint8Array(data),
      mtime: Date.now(),
    });
  }

  async mkdir(path: string): Promise<void> {
    const segments = this.parsePath(path);
    this.getOrCreateDir(segments);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    const node = this.getNode(oldPath);
    if (!node) {
      throw createError("ENOENT", `Source not found: ${oldPath}`);
    }

    // Remove from old location
    const oldSegments = this.parsePath(oldPath);
    const oldName = oldSegments.pop()!;
    const oldParent = this.getNode(oldSegments.join("/")) as MemoryDir;
    oldParent.children.delete(oldName);

    // Add to new location
    const newSegments = this.parsePath(newPath);
    const newName = newSegments.pop()!;
    const newParent = this.getOrCreateDir(newSegments);
    newParent.children.set(newName, node);
  }

  async unlink(path: string): Promise<boolean> {
    const segments = this.parsePath(path);
    const name = segments.pop();
    if (!name) return false;

    const parent = this.getNode(segments.join("/"));
    if (!parent || parent.type !== "dir") return false;

    return parent.children.delete(name);
  }

  async rmdir(path: string): Promise<boolean> {
    return this.unlink(path);
  }

  // === Random Access ===

  async openFile(path: string): Promise<FileHandle> {
    const content = await this.readFile(path);

    return {
      async read(
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ): Promise<number> {
        const available = Math.min(length, content.length - position);
        if (available <= 0) return 0;

        buffer.set(content.subarray(position, position + available), offset);
        return available;
      },

      async close(): Promise<void> {
        // Nothing to close for in-memory
      },
    };
  }

  // === Path Operations ===

  join(...segments: string[]): string {
    return segments.join("/").replace(/\/+/g, "/");
  }

  dirname(path: string): string {
    const segments = this.parsePath(path);
    segments.pop();
    return segments.length > 0 ? segments.join("/") : "/";
  }

  basename(path: string): string {
    const segments = this.parsePath(path);
    return segments[segments.length - 1] || "";
  }

  // === Internal Helpers ===

  private parsePath(path: string): string[] {
    return path.split("/").filter((s) => s && s !== ".");
  }

  private getNode(path: string): MemoryNode | undefined {
    if (!path || path === "/" || path === ".") {
      return this.root;
    }

    const segments = this.parsePath(path);
    let current: MemoryNode = this.root;

    for (const segment of segments) {
      if (current.type !== "dir") return undefined;
      const child = current.children.get(segment);
      if (!child) return undefined;
      current = child;
    }

    return current;
  }

  private getOrCreateDir(segments: string[]): MemoryDir {
    let current: MemoryDir = this.root;

    for (const segment of segments) {
      let child = current.children.get(segment);
      if (!child) {
        child = { type: "dir", children: new Map(), mtime: Date.now() };
        current.children.set(segment, child);
      }
      if (child.type !== "dir") {
        throw createError("ENOTDIR", `Not a directory: ${segment}`);
      }
      current = child;
    }

    return current;
  }

  // === Test Helpers ===

  /**
   * Clear all files (for test cleanup)
   */
  clear(): void {
    this.root = { type: "dir", children: new Map(), mtime: Date.now() };
  }

  /**
   * Get a snapshot of all files for debugging
   */
  snapshot(): Map<string, Uint8Array> {
    const result = new Map<string, Uint8Array>();
    this.collectFiles(this.root, "", result);
    return result;
  }

  private collectFiles(
    node: MemoryDir,
    prefix: string,
    result: Map<string, Uint8Array>,
  ): void {
    for (const [name, child] of node.children) {
      const path = prefix ? `${prefix}/${name}` : name;
      if (child.type === "file") {
        result.set(path, child.content);
      } else {
        this.collectFiles(child, path, result);
      }
    }
  }
}

/**
 * Create a MemoryFileApi instance
 */
export function createMemoryFileApi(): FileApi {
  return new MemoryFileApi();
}
