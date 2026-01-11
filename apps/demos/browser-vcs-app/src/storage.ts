/**
 * Storage Backend Manager
 *
 * Provides swappable storage backends for the VCS:
 * - In-memory (webrun-files-mem)
 * - Browser Filesystem (webrun-files-browser)
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { BrowserFilesApi } from "@statewalker/webrun-files-browser";
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
  const rootHandle = await (
    window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker();

  // Create FilesApi from directory handle using the webrun-files-browser package
  const files = new BrowserFilesApi({ rootHandle });

  return {
    type: "browser-fs",
    files,
    label: `Browser FS: ${rootHandle.name}`,
    rootHandle,
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
