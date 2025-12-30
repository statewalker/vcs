import type { WorkingTreeIterator } from "./working-tree-iterator.js";

/**
 * Write API for the working tree.
 *
 * Extends the read-only WorkingTreeIterator with file system write operations.
 * Provides controlled access to modify working tree files and directories.
 *
 * This interface enables commands like CleanCommand to perform actual file
 * deletion rather than just dry-run mode.
 */
export interface WorkingTreeApi extends WorkingTreeIterator {
  /**
   * Write content to a file in the working tree.
   *
   * Creates parent directories if needed.
   * Overwrites existing files.
   *
   * @param path Relative path from repository root
   * @param content File content
   */
  writeFile(path: string, content: Uint8Array): Promise<void>;

  /**
   * Remove a file from the working tree.
   *
   * @param path Relative path from repository root
   * @returns true if file was removed, false if it didn't exist
   */
  removeFile(path: string): Promise<boolean>;

  /**
   * Remove a file and clean up empty parent directories.
   *
   * After removing the file, walks up the directory tree and removes
   * any empty directories until reaching a non-empty directory or the root.
   *
   * @param path Relative path from repository root
   * @returns true if file was removed, false if it didn't exist
   */
  removeFileAndCleanDirs(path: string): Promise<boolean>;

  /**
   * Create a directory in the working tree.
   *
   * Creates parent directories if needed.
   *
   * @param path Relative path from repository root
   */
  mkdir(path: string): Promise<void>;

  /**
   * Remove a directory (must be empty).
   *
   * @param path Relative path from repository root
   * @returns true if removed, false if not found or not empty
   */
  rmdir(path: string): Promise<boolean>;

  /**
   * Check if a path exists in the working tree.
   *
   * @param path Relative path from repository root
   * @returns true if the path exists
   */
  exists(path: string): Promise<boolean>;
}
