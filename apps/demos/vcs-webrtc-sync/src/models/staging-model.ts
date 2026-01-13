import { BaseClass } from "../utils/index.js";

/**
 * Represents a staged file with its object ID.
 */
export interface StagedFile {
  path: string;
  objectId: string;
}

/**
 * Model representing the Git staging area.
 * Tracks files that have been staged for the next commit.
 */
export class StagingModel extends BaseClass {
  #stagedFiles: StagedFile[] = [];

  get stagedFiles(): readonly StagedFile[] {
    return this.#stagedFiles;
  }

  get isEmpty(): boolean {
    return this.#stagedFiles.length === 0;
  }

  addFile(path: string, objectId: string): void {
    const existing = this.#stagedFiles.findIndex((f) => f.path === path);
    if (existing >= 0) {
      this.#stagedFiles[existing] = { path, objectId };
    } else {
      this.#stagedFiles.push({ path, objectId });
      this.#stagedFiles.sort((a, b) => a.path.localeCompare(b.path));
    }
    this.notify();
  }

  removeFile(path: string): void {
    const index = this.#stagedFiles.findIndex((f) => f.path === path);
    if (index >= 0) {
      this.#stagedFiles.splice(index, 1);
      this.notify();
    }
  }

  hasFile(path: string): boolean {
    return this.#stagedFiles.some((f) => f.path === path);
  }

  setStagedFiles(files: StagedFile[]): void {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
    if (!this.#filesEqual(sorted)) {
      this.#stagedFiles = sorted;
      this.notify();
    }
  }

  #filesEqual(newFiles: StagedFile[]): boolean {
    if (this.#stagedFiles.length !== newFiles.length) return false;
    for (let i = 0; i < this.#stagedFiles.length; i++) {
      if (
        this.#stagedFiles[i].path !== newFiles[i].path ||
        this.#stagedFiles[i].objectId !== newFiles[i].objectId
      ) {
        return false;
      }
    }
    return true;
  }

  clear(): void {
    if (this.#stagedFiles.length > 0) {
      this.#stagedFiles = [];
      this.notify();
    }
  }
}
