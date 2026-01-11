/**
 * Storage Backend Manager
 *
 * Provides swappable storage backends for the VCS:
 * - In-memory (webrun-files-mem)
 * - Browser Filesystem (File System Access API)
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";

export type StorageType = "memory" | "browser-fs";

export interface StorageBackend {
  type: StorageType;
  files: FilesApi;
  label: string;
}

/**
 * Create in-memory storage backend
 */
export async function createMemoryStorage(): Promise<StorageBackend> {
  const files = new MemFilesApi() as unknown as FilesApi;
  return {
    type: "memory",
    files,
    label: "In-Memory Storage",
  };
}

/**
 * Create browser filesystem storage backend using File System Access API
 */
export async function createBrowserFsStorage(): Promise<StorageBackend> {
  // Check if API is available
  if (!("showDirectoryPicker" in window)) {
    throw new Error("File System Access API is not supported in this browser");
  }

  // Request directory access from user
  const dirHandle = await (
    window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker();

  // Create FilesApi from directory handle
  // Note: This is a simplified implementation. The actual @statewalker/webrun-files-browser
  // package would provide a proper implementation.
  const files = await createBrowserFilesApi(dirHandle);

  return {
    type: "browser-fs",
    files,
    label: `Browser FS: ${dirHandle.name}`,
  };
}

/**
 * Simple browser FilesApi implementation using File System Access API
 * This is a minimal implementation for the demo.
 */
async function createBrowserFilesApi(dirHandle: FileSystemDirectoryHandle): Promise<FilesApi> {
  const encoder = new TextEncoder();
  const _decoder = new TextDecoder();

  async function getHandle(
    path: string,
    create = false,
  ): Promise<FileSystemFileHandle | FileSystemDirectoryHandle | null> {
    const parts = path.split("/").filter(Boolean);
    let current: FileSystemDirectoryHandle = dirHandle;

    for (let i = 0; i < parts.length - 1; i++) {
      try {
        current = await current.getDirectoryHandle(parts[i], { create });
      } catch {
        if (!create) return null;
        throw new Error(`Cannot access directory: ${parts.slice(0, i + 1).join("/")}`);
      }
    }

    if (parts.length === 0) {
      return current;
    }

    const lastPart = parts[parts.length - 1];
    try {
      // Try as file first
      return await current.getFileHandle(lastPart, { create });
    } catch {
      try {
        // Try as directory
        return await current.getDirectoryHandle(lastPart, { create });
      } catch {
        if (create) throw new Error(`Cannot create: ${path}`);
        return null;
      }
    }
  }

  const files: FilesApi = {
    async read(path: string): Promise<Uint8Array | undefined> {
      const handle = await getHandle(path);
      if (!handle || handle.kind !== "file") return undefined;
      const file = await (handle as FileSystemFileHandle).getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    },

    async write(path: string, content: Uint8Array | string): Promise<void> {
      const data = typeof content === "string" ? encoder.encode(content) : content;
      const handle = (await getHandle(path, true)) as FileSystemFileHandle;
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },

    async *list(path: string): AsyncGenerator<string> {
      const handle = await getHandle(path || "/");
      if (!handle || handle.kind !== "directory") return;

      for await (const entry of (handle as FileSystemDirectoryHandle).values()) {
        yield entry.name + (entry.kind === "directory" ? "/" : "");
      }
    },

    async exists(path: string): Promise<boolean> {
      const handle = await getHandle(path);
      return handle !== null;
    },

    async delete(path: string): Promise<void> {
      const parts = path.split("/").filter(Boolean);
      if (parts.length === 0) return;

      let current: FileSystemDirectoryHandle = dirHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        try {
          current = await current.getDirectoryHandle(parts[i]);
        } catch {
          return; // Parent doesn't exist
        }
      }

      try {
        await current.removeEntry(parts[parts.length - 1], { recursive: true });
      } catch {
        // Entry doesn't exist
      }
    },

    async mkdir(path: string): Promise<void> {
      await getHandle(path, true);
    },

    async stat(
      path: string,
    ): Promise<{ size: number; mtime: number; isDirectory: boolean } | undefined> {
      const handle = await getHandle(path);
      if (!handle) return undefined;

      if (handle.kind === "directory") {
        return { size: 0, mtime: Date.now(), isDirectory: true };
      }

      const file = await (handle as FileSystemFileHandle).getFile();
      return {
        size: file.size,
        mtime: file.lastModified,
        isDirectory: false,
      };
    },
  };

  return files;
}
