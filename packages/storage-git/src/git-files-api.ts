/**
 * Git Files API - Adapter for webrun-files IFilesApi
 *
 * This module provides a Git-specific file API that wraps webrun-files IFilesApi,
 * adding features needed by Git storage:
 * - Random-access file handles for pack file reading
 * - Path utilities (join, dirname, basename)
 * - Convenience methods (readFile, writeFile, readdir, stat, etc.)
 *
 * @module git-files-api
 */

import {
  FilesApi,
  type FileHandle as WebrunFileHandle,
  type FileInfo,
  type IFilesApi,
  basename,
  dirname,
  joinPath,
} from "@statewalker/webrun-files";

/**
 * File statistics for Git storage
 */
export interface FileStat {
  /** True if this is a regular file */
  isFile: boolean;
  /** True if this is a directory */
  isDirectory: boolean;
  /** File size in bytes (0 for directories) */
  size: number;
  /** Last modification time (Unix timestamp in ms) */
  mtime: number;
}

/**
 * Directory entry for Git storage
 */
export interface DirEntry {
  /** Entry name (not full path) */
  name: string;
  /** True if this is a directory */
  isDirectory: boolean;
  /** True if this is a regular file */
  isFile: boolean;
}

/**
 * File handle for random-access reads
 *
 * Used for pack file reading where we need to seek to specific offsets.
 */
export interface GitFileHandle {
  /**
   * Read bytes at a specific offset
   *
   * @param buffer Buffer to read into
   * @param offset Offset in buffer to start writing
   * @param length Number of bytes to read
   * @param position Position in file to read from
   * @returns Number of bytes actually read
   */
  read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<number>;

  /**
   * Close the file handle
   */
  close(): Promise<void>;
}

/**
 * Internal wrapper that provides random-access reads using webrun-files streaming API.
 */
class RandomAccessFileHandle implements GitFileHandle {
  constructor(
    private handle: WebrunFileHandle,
    private _size: number,
  ) {}

  async read(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<number> {
    if (position >= this._size) return 0;

    const end = Math.min(position + length, this._size);
    let bytesRead = 0;

    // Use streaming with start/end for random access
    for await (const chunk of this.handle.createReadStream({
      start: position,
      end,
    })) {
      const copyLen = Math.min(chunk.length, length - bytesRead);
      buffer.set(chunk.subarray(0, copyLen), offset + bytesRead);
      bytesRead += copyLen;
      if (bytesRead >= length) break;
    }

    return bytesRead;
  }

  async close(): Promise<void> {
    await this.handle.close();
  }
}

/**
 * Git Files API - File system abstraction for Git storage
 *
 * Wraps webrun-files IFilesApi and provides Git-specific operations:
 * - Random-access file handles for pack files
 * - Path utilities (join, dirname, basename)
 * - Convenience methods matching Git storage needs
 *
 * @example
 * ```typescript
 * import { NodeFilesApi } from "@statewalker/webrun-files";
 * import { GitFilesApi, GitStorage } from "@webrun-vcs/storage-git";
 *
 * const fs = new NodeFilesApi({ fs: await import("fs/promises"), rootDir: "/repo" });
 * const files = new GitFilesApi(fs);
 * const storage = await GitStorage.open(files, ".git");
 * ```
 */
export class GitFilesApi {
  private readonly files: FilesApi;

  constructor(fs: IFilesApi) {
    this.files = fs instanceof FilesApi ? fs : new FilesApi(fs);
  }

  // === Read Operations ===

  /**
   * Read entire file contents
   *
   * @param path Path to file
   * @returns File contents as Uint8Array
   * @throws Error with code "ENOENT" if file not found
   */
  async readFile(path: string): Promise<Uint8Array> {
    const info = await this.files.stats(path);
    if (!info || info.kind !== "file") {
      const error = new Error(`ENOENT: no such file or directory: ${path}`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    return this.files.readFile(path);
  }

  /**
   * Check if a path exists (file or directory)
   *
   * @param path Path to check
   * @returns True if path exists
   */
  async exists(path: string): Promise<boolean> {
    return this.files.exists(path);
  }

  /**
   * Get file/directory statistics
   *
   * @param path Path to stat
   * @returns File statistics
   * @throws Error with code "ENOENT" if path not found
   */
  async stat(path: string): Promise<FileStat> {
    const info = await this.files.stats(path);
    if (!info) {
      const error = new Error(`ENOENT: no such file or directory: ${path}`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    return this.toFileStat(info);
  }

  /**
   * Read directory contents
   *
   * @param path Path to directory
   * @returns Array of directory entries
   * @throws Error with code "ENOENT" if directory not found
   * @throws Error with code "ENOTDIR" if path is not a directory
   */
  async readdir(path: string): Promise<DirEntry[]> {
    const info = await this.files.stats(path);
    if (!info) {
      const error = new Error(`ENOENT: no such file or directory: ${path}`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
    if (info.kind !== "directory") {
      const error = new Error(`ENOTDIR: not a directory: ${path}`);
      (error as NodeJS.ErrnoException).code = "ENOTDIR";
      throw error;
    }

    const entries: DirEntry[] = [];
    for await (const entry of this.files.list(path)) {
      entries.push({
        name: entry.name,
        isDirectory: entry.kind === "directory",
        isFile: entry.kind === "file",
      });
    }
    return entries;
  }

  // === Write Operations ===

  /**
   * Write file contents (creates or overwrites)
   *
   * @param path Path to file
   * @param data Content to write
   */
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.files.write(path, [data]);
  }

  /**
   * Create directory (including parents if needed)
   *
   * No error if directory already exists.
   *
   * @param path Path to directory
   */
  async mkdir(path: string): Promise<void> {
    await this.files.mkdir(path);
  }

  /**
   * Rename/move file or directory atomically
   *
   * @param oldPath Current path
   * @param newPath New path
   * @throws Error with code "ENOENT" if oldPath not found
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const moved = await this.files.move(oldPath, newPath);
    if (!moved) {
      const error = new Error(`ENOENT: no such file or directory: ${oldPath}`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }
  }

  /**
   * Delete file
   *
   * @param path Path to file
   * @returns True if file was deleted, false if it didn't exist
   */
  async unlink(path: string): Promise<boolean> {
    return this.files.remove(path);
  }

  /**
   * Delete directory recursively
   *
   * @param path Path to directory
   * @returns True if directory was deleted, false if it didn't exist
   */
  async rmdir(path: string): Promise<boolean> {
    return this.files.remove(path);
  }

  // === Random Access ===

  /**
   * Open file for random-access reading
   *
   * Used for pack files where we need to read at specific offsets.
   *
   * @param path Path to file
   * @returns File handle for random access
   * @throws Error with code "ENOENT" if file not found
   */
  async openFile(path: string): Promise<GitFileHandle> {
    const info = await this.files.stats(path);
    if (!info || info.kind !== "file") {
      const error = new Error(`ENOENT: no such file or directory: ${path}`);
      (error as NodeJS.ErrnoException).code = "ENOENT";
      throw error;
    }

    const handle = await this.files.open(path);
    return new RandomAccessFileHandle(handle, info.size ?? 0);
  }

  // === Path Operations ===

  /**
   * Join path segments
   *
   * Preserves the relative/absolute nature of the first segment:
   * - If first segment starts with `/`, returns absolute path
   * - If first segment is relative, returns relative path
   *
   * @param segments Path segments to join
   * @returns Joined path
   */
  join(...segments: string[]): string {
    if (segments.length === 0) return "";
    const first = segments[0];
    const isAbsolute = first.startsWith("/");
    const result = joinPath(...segments);
    // webrun-files joinPath always adds leading /, remove it for relative paths
    if (!isAbsolute && result.startsWith("/")) {
      return result.substring(1);
    }
    return result;
  }

  /**
   * Get parent directory of a path
   *
   * @param path Path to get parent of
   * @returns Parent directory path
   */
  dirname(path: string): string {
    const isAbsolute = path.startsWith("/");
    const result = dirname(path);
    // webrun-files dirname returns "/" for root, preserve relative paths
    if (!isAbsolute && result === "/") {
      return ".";
    }
    if (!isAbsolute && result.startsWith("/")) {
      return result.substring(1);
    }
    return result;
  }

  /**
   * Get base name (last segment) of a path
   *
   * @param path Path to get base name of
   * @returns Base name
   */
  basename(path: string): string {
    return basename(path);
  }

  // === Private Helpers ===

  private toFileStat(info: FileInfo): FileStat {
    return {
      isFile: info.kind === "file",
      isDirectory: info.kind === "directory",
      size: info.size ?? 0,
      mtime: info.lastModified,
    };
  }
}

/**
 * Create a GitFilesApi instance
 *
 * @param fs IFilesApi implementation from webrun-files
 */
export function createGitFilesApi(fs: IFilesApi): GitFilesApi {
  return new GitFilesApi(fs);
}
