import type { FileStats, FilesApi } from "../../common/files/index.js";
import type { RawStorage } from "../../storage/raw/raw-storage.js";

/**
 * Create a mock RawStorage that records all operations.
 */
export function createMockRawStorage(): {
  storage: RawStorage;
  operations: Array<{ method: string; args: unknown[] }>;
} {
  const data = new Map<string, Uint8Array>();
  const operations: Array<{ method: string; args: unknown[] }> = [];

  const storage: RawStorage = {
    async store(key, content) {
      operations.push({ method: "store", args: [key] });
      const chunks: Uint8Array[] = [];
      for await (const chunk of content) {
        chunks.push(chunk);
      }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      const result = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      data.set(key, result);
    },

    async *load(key, options) {
      operations.push({ method: "load", args: [key, options] });
      const content = data.get(key);
      if (content) {
        const start = options?.start ?? 0;
        const end = options?.end ?? content.length;
        yield content.slice(start, end);
      }
    },

    async has(key) {
      operations.push({ method: "has", args: [key] });
      return data.has(key);
    },

    async remove(key) {
      operations.push({ method: "remove", args: [key] });
      return data.delete(key);
    },

    async *keys() {
      operations.push({ method: "keys", args: [] });
      for (const key of data.keys()) {
        yield key;
      }
    },

    async size(key) {
      operations.push({ method: "size", args: [key] });
      return data.get(key)?.length ?? 0;
    },
  };

  return { storage, operations };
}

/**
 * Create a mock FilesApi for testing without filesystem.
 */
export function createMockFilesApi(): FilesApi & {
  _files: Map<string, Uint8Array>;
  _dirs: Set<string>;
} {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();

  return {
    _files: files,
    _dirs: dirs,

    async readBinary(path: string): Promise<Uint8Array> {
      const content = files.get(path);
      if (!content) throw new Error(`File not found: ${path}`);
      return content;
    },

    async readText(path: string): Promise<string> {
      const content = await this.readBinary(path);
      return new TextDecoder().decode(content);
    },

    async writeBinary(path: string, content: Uint8Array): Promise<void> {
      files.set(path, content);
    },

    async writeText(path: string, content: string): Promise<void> {
      await this.writeBinary(path, new TextEncoder().encode(content));
    },

    async exists(path: string): Promise<boolean> {
      return files.has(path) || dirs.has(path);
    },

    async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
      dirs.add(path);
    },

    async readdir(path: string): Promise<string[]> {
      const entries: string[] = [];
      const prefix = path.endsWith("/") ? path : `${path}/`;

      for (const file of files.keys()) {
        if (file.startsWith(prefix)) {
          const relative = file.slice(prefix.length);
          const parts = relative.split("/");
          if (parts.length === 1) {
            entries.push(parts[0]);
          }
        }
      }

      for (const dir of dirs) {
        if (dir.startsWith(prefix)) {
          const relative = dir.slice(prefix.length);
          const parts = relative.split("/");
          if (parts.length === 1) {
            entries.push(parts[0]);
          }
        }
      }

      return entries;
    },

    async remove(path: string): Promise<void> {
      files.delete(path);
      dirs.delete(path);
    },

    async rename(oldPath: string, newPath: string): Promise<void> {
      const content = files.get(oldPath);
      if (content) {
        files.set(newPath, content);
        files.delete(oldPath);
      }
    },

    async stat(path: string): Promise<FileStats> {
      if (files.has(path)) {
        return {
          isFile: true,
          isDirectory: false,
          size: files.get(path)?.length ?? 0,
          mtime: Date.now(),
        };
      }
      if (dirs.has(path)) {
        return {
          isFile: false,
          isDirectory: true,
          size: 0,
          mtime: Date.now(),
        };
      }
      throw new Error(`File not found: ${path}`);
    },

    async chmod(_path: string, _mode: number): Promise<void> {
      // No-op for mock
    },

    async copyFile(src: string, dest: string): Promise<void> {
      const content = files.get(src);
      if (!content) throw new Error(`File not found: ${src}`);
      files.set(dest, new Uint8Array(content));
    },
  };
}

/**
 * Create a mock Transport for testing protocol handling.
 */
export function createMockTransport(_options?: {
  refs?: Record<string, string>;
  packResponse?: Uint8Array;
}): {
  requests: Array<{ type: string; data: unknown }>;
} {
  const requests: Array<{ type: string; data: unknown }> = [];

  // Mock transport - implementation depends on transport interface
  // For now, just return the requests array for tracking

  return { requests };
}
