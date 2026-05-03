import { Base } from "../utils/index.js";

/**
 * File status in the working directory.
 */
export type FileStatus = "untracked" | "modified" | "staged" | "unchanged" | "deleted";

/**
 * Represents a file in the working directory with its status.
 */
export interface FileEntry {
  path: string;
  status: FileStatus;
}

/**
 * Model representing files in the working directory.
 * Tracks file list and loading state.
 */
export class FileListModel extends Base {
  #files: FileEntry[] = [];
  #loading = false;

  get files(): readonly FileEntry[] {
    return this.#files;
  }

  get loading(): boolean {
    return this.#loading;
  }

  setFiles(files: FileEntry[]): void {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    if (!this.#filesEqual(sorted)) {
      return this.update(() => {
        this.#files = sorted;
      
      });
    }
  }

  #filesEqual(newFiles: FileEntry[]): boolean {
    if (this.#files.length !== newFiles.length) return false;
    for (let i = 0; i < this.#files.length; i++) {
      if (
        this.#files[i].path !== newFiles[i].path ||
        this.#files[i].status !== newFiles[i].status
      ) {
        return false;
      }
    }
    return true;
  }

  setLoading(loading: boolean): void {
    if (this.#loading !== loading) {
      return this.update(() => {
        this.#loading = loading;
      
      });
    }
  }

  updateFileStatus(path: string, status: FileStatus): void {
    const index = this.#files.findIndex((f) => f.path === path);
    if (index >= 0) {
      return this.update(() => {
        this.#files[index] = { ...this.#files[index], status };
      
      });
    }
  }

  clear(): void {
    return this.update(() => {
      this.#files = [];
      this.#loading = false;
    
    });
  }
}
