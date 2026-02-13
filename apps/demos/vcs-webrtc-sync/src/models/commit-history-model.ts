import { BaseClass } from "../utils/index.js";

/**
 * Represents a commit in the history.
 */
export interface CommitEntry {
  id: string;
  shortId: string;
  message: string;
  author: string;
  timestamp: number;
}

/**
 * Model representing the commit history.
 * Tracks list of commits and loading state.
 */
export class CommitHistoryModel extends BaseClass {
  #commits: CommitEntry[] = [];
  #loading = false;

  get commits(): readonly CommitEntry[] {
    return this.#commits;
  }

  get loading(): boolean {
    return this.#loading;
  }

  setCommits(commits: CommitEntry[]): void {
    this.#commits = [...commits];
    this.notify();
  }

  setLoading(loading: boolean): void {
    if (this.#loading !== loading) {
      this.#loading = loading;
      this.notify();
    }
  }

  prependCommit(commit: CommitEntry): void {
    this.#commits = [commit, ...this.#commits];
    this.notify();
  }

  clear(): void {
    this.#commits = [];
    this.#loading = false;
    this.notify();
  }
}
