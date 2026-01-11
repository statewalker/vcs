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
  rootHandle?: FileSystemDirectoryHandle;
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
  const files = createBrowserFilesApi(dirHandle);

  return {
    type: "browser-fs",
    files,
    label: `Browser FS: ${dirHandle.name}`,
    rootHandle: dirHandle,
  };
}

/**
 * List all files in a directory recursively (for browser FS)
 */
export async function listAllFiles(
  rootHandle: FileSystemDirectoryHandle,
  prefix = "",
): Promise<string[]> {
  const files: string[] = [];

  for await (const entry of rootHandle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.kind === "file") {
      files.push(path);
    } else if (entry.kind === "directory" && entry.name !== ".git") {
      // Recursively list subdirectories (skip .git)
      const subHandle = await rootHandle.getDirectoryHandle(entry.name);
      const subFiles = await listAllFiles(subHandle, path);
      files.push(...subFiles);
    }
  }

  return files.sort();
}

/**
 * Check if .git directory exists
 */
export async function hasGitDirectory(rootHandle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    const handle = await rootHandle.getDirectoryHandle(".git");
    return handle.kind === "directory";
  } catch {
    return false;
  }
}

/**
 * Browser FilesApi implementation using File System Access API
 */
function createBrowserFilesApi(dirHandle: FileSystemDirectoryHandle): FilesApi {
  const encoder = new TextEncoder();

  /**
   * Navigate to a directory, optionally creating intermediate directories
   */
  async function getParentDir(
    path: string,
    create = false,
  ): Promise<{ parent: FileSystemDirectoryHandle; name: string } | null> {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      return null;
    }

    let current: FileSystemDirectoryHandle = dirHandle;

    // Navigate to parent directory
    for (let i = 0; i < parts.length - 1; i++) {
      try {
        current = await current.getDirectoryHandle(parts[i], { create });
      } catch {
        if (!create) return null;
        throw new Error(`Cannot access directory: ${parts.slice(0, i + 1).join("/")}`);
      }
    }

    return { parent: current, name: parts[parts.length - 1] };
  }

  /**
   * Get a file handle at the given path
   */
  async function getFileHandle(
    path: string,
    create = false,
  ): Promise<FileSystemFileHandle | null> {
    const result = await getParentDir(path, create);
    if (!result) return null;

    try {
      return await result.parent.getFileHandle(result.name, { create });
    } catch {
      return null;
    }
  }

  /**
   * Get a directory handle at the given path
   */
  async function getDirHandle(
    path: string,
    create = false,
  ): Promise<FileSystemDirectoryHandle | null> {
    const parts = path.split("/").filter(Boolean);
    if (parts.length === 0) {
      return dirHandle;
    }

    let current: FileSystemDirectoryHandle = dirHandle;

    for (const part of parts) {
      try {
        current = await current.getDirectoryHandle(part, { create });
      } catch {
        return null;
      }
    }

    return current;
  }

  /**
   * Check if path exists and return its type
   */
  async function getEntryType(path: string): Promise<"file" | "directory" | null> {
    const result = await getParentDir(path, false);
    if (!result) {
      // Check if it's the root
      if (path === "/" || path === "") return "directory";
      return null;
    }

    try {
      await result.parent.getFileHandle(result.name);
      return "file";
    } catch {
      try {
        await result.parent.getDirectoryHandle(result.name);
        return "directory";
      } catch {
        return null;
      }
    }
  }

  const files: FilesApi = {
    async read(path: string): Promise<Uint8Array | undefined> {
      const handle = await getFileHandle(path);
      if (!handle) return undefined;
      const file = await handle.getFile();
      const buffer = await file.arrayBuffer();
      return new Uint8Array(buffer);
    },

    async write(path: string, content: Uint8Array | string): Promise<void> {
      const data = typeof content === "string" ? encoder.encode(content) : content;
      const handle = await getFileHandle(path, true);
      if (!handle) {
        throw new Error(`Cannot create file: ${path}`);
      }
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },

    async *list(path: string): AsyncGenerator<string> {
      const handle = await getDirHandle(path || "/");
      if (!handle) return;

      for await (const entry of handle.values()) {
        yield entry.name + (entry.kind === "directory" ? "/" : "");
      }
    },

    async exists(path: string): Promise<boolean> {
      const type = await getEntryType(path);
      return type !== null;
    },

    async delete(path: string): Promise<void> {
      const result = await getParentDir(path, false);
      if (!result) return;

      try {
        await result.parent.removeEntry(result.name, { recursive: true });
      } catch {
        // Entry doesn't exist
      }
    },

    async mkdir(path: string): Promise<void> {
      // Create directory (and intermediate directories)
      await getDirHandle(path, true);
    },

    async stat(
      path: string,
    ): Promise<{ size: number; mtime: number; isDirectory: boolean } | undefined> {
      const type = await getEntryType(path);
      if (type === null) return undefined;

      if (type === "directory") {
        return { size: 0, mtime: Date.now(), isDirectory: true };
      }

      const handle = await getFileHandle(path);
      if (!handle) return undefined;

      const file = await handle.getFile();
      return {
        size: file.size,
        mtime: file.lastModified,
        isDirectory: false,
      };
    },
  };

  return files;
}
