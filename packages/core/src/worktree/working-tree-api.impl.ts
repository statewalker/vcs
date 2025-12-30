/**
 * FileTreeApi - Working tree API implementation with write operations.
 *
 * Extends FileTreeIterator with file system write operations for commands
 * that need to modify the working tree (CleanCommand, CheckoutCommand, etc.).
 */

import { dirname, type FilesApi, joinPath } from "../files/index.js";
import type { WorkingTreeApi } from "./working-tree-api.js";
import { FileTreeIterator, type FileTreeIteratorOptions } from "./working-tree-iterator.impl.js";

/**
 * FileTreeApi implementation.
 *
 * Provides working tree read/write functionality using a platform-agnostic
 * FilesApi for filesystem access.
 */
export class FileTreeApi extends FileTreeIterator implements WorkingTreeApi {
  private readonly filesApi: FilesApi;
  private readonly rootPathApi: string;

  constructor(options: FileTreeIteratorOptions) {
    super(options);
    this.filesApi = options.files;
    this.rootPathApi = options.rootPath;
  }

  /**
   * Write content to a file in the working tree.
   *
   * Creates parent directories if needed.
   */
  async writeFile(path: string, content: Uint8Array): Promise<void> {
    const fullPath = joinPath(this.rootPathApi, path);

    // Ensure parent directories exist
    const parentDir = dirname(fullPath);
    if (parentDir && parentDir !== fullPath) {
      await this.filesApi.mkdir(parentDir);
    }

    // Write file content
    await this.filesApi.write(fullPath, [content]);
  }

  /**
   * Remove a file from the working tree.
   */
  async removeFile(path: string): Promise<boolean> {
    const fullPath = joinPath(this.rootPathApi, path);

    try {
      return await this.filesApi.remove(fullPath);
    } catch {
      return false;
    }
  }

  /**
   * Remove a file and clean up empty parent directories.
   */
  async removeFileAndCleanDirs(path: string): Promise<boolean> {
    const removed = await this.removeFile(path);
    if (removed) {
      await this.cleanEmptyParentDirs(path);
    }
    return removed;
  }

  /**
   * Create a directory in the working tree.
   */
  async mkdir(path: string): Promise<void> {
    const fullPath = joinPath(this.rootPathApi, path);
    await this.filesApi.mkdir(fullPath);
  }

  /**
   * Remove an empty directory.
   */
  async rmdir(path: string): Promise<boolean> {
    const fullPath = joinPath(this.rootPathApi, path);

    try {
      // Check if directory is empty
      let hasEntries = false;
      for await (const _ of this.filesApi.list(fullPath)) {
        hasEntries = true;
        break;
      }

      if (hasEntries) {
        return false;
      }

      return await this.filesApi.remove(fullPath);
    } catch {
      return false;
    }
  }

  /**
   * Check if a path exists in the working tree.
   */
  async exists(path: string): Promise<boolean> {
    const fullPath = joinPath(this.rootPathApi, path);
    return await this.filesApi.exists(fullPath);
  }

  /**
   * Clean up empty parent directories after file removal.
   *
   * Walks up the directory tree removing empty directories until
   * encountering a non-empty directory or the root.
   */
  private async cleanEmptyParentDirs(path: string): Promise<void> {
    let parentPath = dirname(path);

    while (parentPath && parentPath !== "." && parentPath !== "") {
      const fullParentPath = joinPath(this.rootPathApi, parentPath);

      try {
        // Check if directory is empty
        let hasEntries = false;
        for await (const _ of this.filesApi.list(fullParentPath)) {
          hasEntries = true;
          break;
        }

        if (hasEntries) {
          // Directory is not empty, stop here
          break;
        }

        // Remove empty directory
        await this.filesApi.remove(fullParentPath);

        // Move up to parent
        parentPath = dirname(parentPath);
      } catch {
        // Can't access directory, stop here
        break;
      }
    }
  }
}

/**
 * Create a FileTreeApi.
 *
 * @param options Iterator options
 * @returns A new FileTreeApi instance
 */
export function createFileTreeApi(options: FileTreeIteratorOptions): WorkingTreeApi {
  return new FileTreeApi(options);
}
