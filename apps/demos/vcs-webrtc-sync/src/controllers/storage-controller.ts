/**
 * Storage Controller
 *
 * Manages storage backend selection (memory or browser filesystem).
 * Updates RepositoryModel based on storage state.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { BrowserFilesApi } from "@statewalker/webrun-files-browser";
import { MemFilesApi } from "@statewalker/webrun-files-mem";
import { getActivityLogModel, getRepositoryModel } from "../models/index.js";
import { newAdapter, newRegistry } from "../utils/index.js";

/**
 * Storage type options.
 */
export type StorageType = "memory" | "browser-fs";

/**
 * Storage backend information.
 */
export interface StorageBackend {
  type: StorageType;
  files: FilesApi;
  folderName: string;
}

// Adapter for storing current storage backend
export const [getStorageBackend, setStorageBackend] = newAdapter<StorageBackend | null>(
  "storage-backend",
  () => null,
);

/**
 * Check if .git directory exists using FilesApi.
 */
async function hasGitDirectory(files: FilesApi): Promise<boolean> {
  return files.exists(".git");
}

/**
 * Check if File System Access API is supported.
 */
export function isFileSystemAccessSupported(): boolean {
  return "showDirectoryPicker" in window;
}

/**
 * Create the storage controller.
 * Returns cleanup function.
 */
export function createStorageController(ctx: Map<string, unknown>): () => void {
  const [_register, cleanup] = newRegistry();
  const repoModel = getRepositoryModel(ctx);
  const _logModel = getActivityLogModel(ctx);

  // Initialize with no storage
  repoModel.setNoStorage();

  return cleanup;
}

/**
 * Open a folder using File System Access API.
 * Returns the storage backend or null if cancelled.
 */
export async function openFolder(ctx: Map<string, unknown>): Promise<StorageBackend | null> {
  const repoModel = getRepositoryModel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!isFileSystemAccessSupported()) {
    logModel.error("File System Access API is not supported in this browser");
    repoModel.setError("File System Access API not supported");
    return null;
  }

  try {
    const rootHandle = await (
      window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
    ).showDirectoryPicker();

    const files = new BrowserFilesApi({ rootHandle });
    const backend: StorageBackend = {
      type: "browser-fs",
      files,
      folderName: rootHandle.name,
    };

    setStorageBackend(ctx, backend);

    // Check if repository exists using FilesApi
    const hasRepo = await hasGitDirectory(files);
    if (hasRepo) {
      logModel.info(`Opened folder: ${rootHandle.name} (repository found)`);
      // Don't set ready yet - RepositoryController will do that after opening
      repoModel.setNoRepository(rootHandle.name);
    } else {
      logModel.info(`Opened folder: ${rootHandle.name} (no repository)`);
      repoModel.setNoRepository(rootHandle.name);
    }

    return backend;
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      // User cancelled
      return null;
    }
    logModel.error(`Failed to open folder: ${(error as Error).message}`);
    repoModel.setError((error as Error).message);
    return null;
  }
}

/**
 * Use in-memory storage.
 */
export async function useMemoryStorage(ctx: Map<string, unknown>): Promise<StorageBackend> {
  const repoModel = getRepositoryModel(ctx);
  const logModel = getActivityLogModel(ctx);

  const files = new MemFilesApi() as unknown as FilesApi;
  const backend: StorageBackend = {
    type: "memory",
    files,
    folderName: "Memory",
  };

  setStorageBackend(ctx, backend);
  repoModel.setNoRepository("Memory");
  logModel.info("Using in-memory storage");

  return backend;
}

/**
 * Close current storage and reset state.
 */
export function closeStorage(ctx: Map<string, unknown>): void {
  const repoModel = getRepositoryModel(ctx);
  const logModel = getActivityLogModel(ctx);

  setStorageBackend(ctx, null);
  repoModel.setNoStorage();
  logModel.info("Storage closed");
}

/**
 * Check if the current storage has a Git repository.
 */
export async function hasRepository(ctx: Map<string, unknown>): Promise<boolean> {
  const backend = getStorageBackend(ctx);
  if (!backend) return false;

  // Use FilesApi to check for .git directory (works for both browser-fs and memory)
  return hasGitDirectory(backend.files);
}
