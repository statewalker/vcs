import { Base } from "../utils/index.js";

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
export class CommitHistoryModel extends Base {
  #commits: CommitEntry[] = [];
  #loading = false;

  get commits(): readonly CommitEntry[] {
    return this.#commits;
  }

  get loading(): boolean {
    return this.#loading;
  }

  setCommits(commits: CommitEntry[]): void {
    return this.update(() => {
      this.#commits = [...commits];
    
    });
  }

  setLoading(loading: boolean): void {
    if (this.#loading !== loading) {
      return this.update(() => {
        this.#loading = loading;
      
      });
    }
  }

  prependCommit(commit: CommitEntry): void {
    return this.update(() => {
      this.#commits = [commit, ...this.#commits];
    
    });
  }

  clear(): void {
    return this.update(() => {
      this.#commits = [];
      this.#loading = false;
    
    });
  }
}
