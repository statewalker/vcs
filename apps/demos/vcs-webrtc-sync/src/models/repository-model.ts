import { BaseClass } from "../utils/index.js";

/**
 * Repository status states.
 */
export type RepositoryStatus = "no-storage" | "no-repository" | "ready" | "error";

/**
 * Model representing the Git repository state.
 * Tracks repository status, current branch, HEAD commit, and change state.
 */
export class RepositoryModel extends BaseClass {
  #status: RepositoryStatus = "no-storage";
  #folderName: string | null = null;
  #branchName: string | null = null;
  #headCommit: string | null = null;
  #hasUncommittedChanges = false;
  #errorMessage: string | null = null;

  get status(): RepositoryStatus {
    return this.#status;
  }

  get folderName(): string | null {
    return this.#folderName;
  }

  get branchName(): string | null {
    return this.#branchName;
  }

  get headCommit(): string | null {
    return this.#headCommit;
  }

  get hasUncommittedChanges(): boolean {
    return this.#hasUncommittedChanges;
  }

  get errorMessage(): string | null {
    return this.#errorMessage;
  }

  setNoStorage(): void {
    this.#status = "no-storage";
    this.#folderName = null;
    this.#branchName = null;
    this.#headCommit = null;
    this.#hasUncommittedChanges = false;
    this.#errorMessage = null;
    this.notify();
  }

  setNoRepository(folderName: string): void {
    this.#status = "no-repository";
    this.#folderName = folderName;
    this.#branchName = null;
    this.#headCommit = null;
    this.#hasUncommittedChanges = false;
    this.#errorMessage = null;
    this.notify();
  }

  setReady(folderName: string, branchName: string, headCommit: string): void {
    this.#status = "ready";
    this.#folderName = folderName;
    this.#branchName = branchName;
    this.#headCommit = headCommit;
    this.#errorMessage = null;
    this.notify();
  }

  setError(message: string): void {
    this.#status = "error";
    this.#errorMessage = message;
    this.notify();
  }

  updateHead(headCommit: string): void {
    this.#headCommit = headCommit;
    this.notify();
  }

  updateBranch(branchName: string): void {
    this.#branchName = branchName;
    this.notify();
  }

  setUncommittedChanges(hasChanges: boolean): void {
    if (this.#hasUncommittedChanges !== hasChanges) {
      this.#hasUncommittedChanges = hasChanges;
      this.notify();
    }
  }
}
