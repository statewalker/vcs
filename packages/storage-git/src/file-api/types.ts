/**
 * File system abstraction types for Git storage
 *
 * This interface provides all file operations needed for Git storage:
 * - Reading files (whole file and random access)
 * - Writing files atomically
 * - Directory operations
 * - File metadata
 *
 * Design principles:
 * - Async-first (all operations return Promises)
 * - Binary-first (uses Uint8Array, not strings)
 * - Minimal surface area (only what Git storage needs)
 * - Platform-agnostic (no Node.js-specific types in the interface)
 */

/**
 * File statistics
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
 * Directory entry
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
 * File handle for random access reads
 *
 * Used for pack file reading where we need to seek to specific offsets.
 */
export interface FileHandle {
  /**
   * Read bytes at a specific offset
   *
   * @param buffer Buffer to read into
   * @param offset Offset in buffer to start writing
   * @param length Number of bytes to read
   * @param position Position in file to read from
   * @returns Number of bytes actually read
   */
  read(buffer: Uint8Array, offset: number, length: number, position: number): Promise<number>;

  /**
   * Close the file handle
   */
  close(): Promise<void>;
}

/**
 * Minimal file system API for Git storage
 */
export interface FileApi {
  // === Read Operations ===

  /**
   * Read entire file contents
   *
   * @param path Absolute or relative path to file
   * @returns File contents as Uint8Array
   * @throws Error with code "ENOENT" if file not found
   */
  readFile(path: string): Promise<Uint8Array>;

  /**
   * Check if a path exists (file or directory)
   *
   * @param path Path to check
   * @returns True if path exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Get file/directory statistics
   *
   * @param path Path to stat
   * @returns File statistics
   * @throws Error with code "ENOENT" if path not found
   */
  stat(path: string): Promise<FileStat>;

  /**
   * Read directory contents
   *
   * @param path Path to directory
   * @returns Array of directory entries
   * @throws Error with code "ENOENT" if directory not found
   * @throws Error with code "ENOTDIR" if path is not a directory
   */
  readdir(path: string): Promise<DirEntry[]>;

  // === Write Operations ===

  /**
   * Write file contents (creates or overwrites)
   *
   * @param path Path to file
   * @param data Content to write
   * @throws Error if parent directory doesn't exist
   */
  writeFile(path: string, data: Uint8Array): Promise<void>;

  /**
   * Create directory (including parents if needed)
   *
   * No error if directory already exists.
   *
   * @param path Path to directory
   */
  mkdir(path: string): Promise<void>;

  /**
   * Rename/move file or directory atomically
   *
   * @param oldPath Current path
   * @param newPath New path
   * @throws Error with code "ENOENT" if oldPath not found
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /**
   * Delete file
   *
   * @param path Path to file
   * @returns True if file was deleted, false if it didn't exist
   */
  unlink(path: string): Promise<boolean>;

  /**
   * Delete directory recursively
   *
   * @param path Path to directory
   * @returns True if directory was deleted, false if it didn't exist
   */
  rmdir(path: string): Promise<boolean>;

  // === Random Access ===

  /**
   * Open file for random access reading
   *
   * Used for pack files where we need to read at specific offsets.
   *
   * @param path Path to file
   * @returns File handle for random access
   * @throws Error with code "ENOENT" if file not found
   */
  openFile(path: string): Promise<FileHandle>;

  // === Path Operations ===

  /**
   * Join path segments
   *
   * @param segments Path segments to join
   * @returns Joined path
   */
  join(...segments: string[]): string;

  /**
   * Get parent directory of a path
   *
   * @param path Path to get parent of
   * @returns Parent directory path
   */
  dirname(path: string): string;

  /**
   * Get base name (last segment) of a path
   *
   * @param path Path to get base name of
   * @returns Base name
   */
  basename(path: string): string;
}
