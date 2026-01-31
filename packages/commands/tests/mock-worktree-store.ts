/**
 * Mock WorktreeStore for testing
 *
 * Provides a simple in-memory implementation of WorktreeStore
 * for creating WorkingCopy instances in tests.
 */

import type { ObjectId, WorktreeEntry, WorktreeStore } from "@statewalker/vcs-core";

/**
 * Simple mock WorktreeStore for testing.
 *
 * Provides basic implementation that stores files in memory.
 * Use this when you need a WorktreeStore for MemoryWorkingCopy.
 */
export class MockWorktreeStore implements WorktreeStore {
  private files = new Map<string, { content: Uint8Array; mode: number; mtime: number }>();

  async *walk(): AsyncIterable<WorktreeEntry> {
    const paths = Array.from(this.files.keys()).sort();
    for (const path of paths) {
      const file = this.files.get(path);
      if (file) {
        yield {
          path,
          name: path.split("/").pop() ?? path,
          isDirectory: false,
          isSymbolicLink: false,
          isIgnored: false,
          size: file.content.length,
          mtime: file.mtime,
          mode: file.mode,
        };
      }
    }
  }

  async getEntry(path: string): Promise<WorktreeEntry | undefined> {
    const file = this.files.get(path);
    if (!file) return undefined;
    return {
      path,
      name: path.split("/").pop() ?? path,
      isDirectory: false,
      isSymbolicLink: false,
      isIgnored: false,
      size: file.content.length,
      mtime: file.mtime,
      mode: file.mode,
    };
  }

  async computeHash(path: string): Promise<ObjectId> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    // Return a placeholder hash - for full implementation, compute SHA-1
    const size = file.content.length;
    return `placeholder-${size}-${path.replace(/[^a-z0-9]/gi, "")}`
      .substring(0, 40)
      .padEnd(40, "0");
  }

  async *readContent(path: string): AsyncIterable<Uint8Array> {
    const file = this.files.get(path);
    if (!file) throw new Error(`File not found: ${path}`);
    yield file.content;
  }

  // Test helpers for setting up files
  setFile(path: string, content: Uint8Array | string, mode = 0o100644): void {
    const data = typeof content === "string" ? new TextEncoder().encode(content) : content;
    this.files.set(path, { content: data, mode, mtime: Date.now() });
  }

  deleteFile(path: string): boolean {
    return this.files.delete(path);
  }

  clear(): void {
    this.files.clear();
  }
}

/**
 * Create a mock WorktreeStore for testing
 */
export function createMockWorktreeStore(): MockWorktreeStore {
  return new MockWorktreeStore();
}
