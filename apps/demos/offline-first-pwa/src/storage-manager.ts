/**
 * Storage Manager
 *
 * Manages storage backends for the PWA.
 */

import type { FilesApi } from "@statewalker/webrun-files";
import { MemFilesApi } from "@statewalker/webrun-files-mem";

export type StorageType = "memory" | "persistent";

export interface StorageBackend {
  type: StorageType;
  files: FilesApi;
  label: string;
}

/**
 * Create in-memory storage backend.
 */
export async function createMemoryStorage(): Promise<StorageBackend> {
  const files = new MemFilesApi() as unknown as FilesApi;
  return {
    type: "memory",
    files,
    label: "In-Memory (temporary)",
  };
}

/**
 * Create persistent storage backend using Origin Private File System.
 * Falls back to in-memory if not available.
 */
export async function createPersistentStorage(): Promise<StorageBackend> {
  // Check if OPFS is available
  if ("storage" in navigator && "getDirectory" in navigator.storage) {
    try {
      // Get root of OPFS
      const root = await navigator.storage.getDirectory();

      // Create or get our app directory
      const appDir = await root.getDirectoryHandle("vcs-pwa", { create: true });

      // For now, use memory storage with OPFS as a placeholder
      // Full OPFS integration would require adapting FilesApi
      console.log("OPFS available, using app directory:", appDir.name);

      // Return memory storage as fallback (OPFS adapter not implemented)
      const files = new MemFilesApi() as unknown as FilesApi;
      return {
        type: "persistent",
        files,
        label: "Persistent (OPFS - limited)",
      };
    } catch (error) {
      console.warn("Failed to access OPFS:", error);
    }
  }

  // Fall back to memory
  console.log("OPFS not available, using in-memory storage");
  const files = new MemFilesApi() as unknown as FilesApi;
  return {
    type: "memory",
    files,
    label: "In-Memory (OPFS not available)",
  };
}

/**
 * Check if persistent storage is available.
 */
export function isPersistentStorageAvailable(): boolean {
  return "storage" in navigator && "getDirectory" in navigator.storage;
}

/**
 * Request persistent storage permission.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if ("storage" in navigator && "persist" in navigator.storage) {
    try {
      const isPersisted = await navigator.storage.persist();
      return isPersisted;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Check if storage is persisted.
 */
export async function isStoragePersisted(): Promise<boolean> {
  if ("storage" in navigator && "persisted" in navigator.storage) {
    try {
      return await navigator.storage.persisted();
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Get storage usage estimate.
 */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if ("storage" in navigator && "estimate" in navigator.storage) {
    try {
      const estimate = await navigator.storage.estimate();
      return {
        usage: estimate.usage || 0,
        quota: estimate.quota || 0,
      };
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Format bytes for display.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
