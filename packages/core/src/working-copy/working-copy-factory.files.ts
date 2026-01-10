/**
 * Factory for creating file-based working copies.
 *
 * Provides methods to open existing or create new working copies,
 * and to add additional worktrees to an existing repository.
 */

import type { HistoryStore } from "../history-store.js";
import type {
  AddWorktreeOptions,
  WorkingCopy,
  WorkingCopyFactory,
  WorkingCopyOptions,
} from "../working-copy.js";

import { createGitStashStore, type StashFilesApi } from "./stash-store.files.js";
import { GitWorkingCopy, type WorkingCopyFilesApi } from "./working-copy.files.js";
import { type ConfigFilesApi, createWorkingCopyConfig } from "./working-copy-config.files.js";

/**
 * Combined files API for all working copy operations
 */
export interface WorkingCopyFactoryFilesApi
  extends WorkingCopyFilesApi,
    StashFilesApi,
    ConfigFilesApi {
  /** Create a directory (and parents if needed) */
  mkdir(path: string): Promise<void>;
  /** Write content to a file */
  writeFile(path: string, content: string): Promise<void>;
}

/**
 * Context required to create a GitWorkingCopy.
 *
 * This allows the factory to be used with different storage backends
 * for the repository, staging, and worktree components.
 */
export interface GitWorkingCopyContext {
  /** The history store to link to */
  repository: HistoryStore;
  /** Factory function to create the staging store */
  createStagingStore: (gitDir: string) => Promise<import("../staging/index.js").StagingStore>;
  /** Factory function to create the worktree store */
  createWorktreeIterator: (worktreePath: string) => import("../worktree/index.js").WorktreeStore;
}

/**
 * Git-compatible WorkingCopyFactory implementation.
 */
export class GitWorkingCopyFactory implements WorkingCopyFactory {
  constructor(
    private readonly files: WorkingCopyFactoryFilesApi,
    private readonly createContext: (
      repositoryPath: string,
      options: WorkingCopyOptions,
    ) => Promise<GitWorkingCopyContext>,
  ) {}

  /**
   * Open or create a working copy at the given path.
   */
  async openWorkingCopy(
    worktreePath: string,
    repositoryPath: string,
    options: WorkingCopyOptions = {},
  ): Promise<WorkingCopy> {
    // 1. Get context (repository, staging, worktree factories)
    const context = await this.createContext(repositoryPath, options);

    // 2. Create staging store
    const staging = await context.createStagingStore(repositoryPath);

    // 3. Create working tree iterator
    const worktree = context.createWorktreeIterator(worktreePath);

    // 4. Create stash store
    const stash = createGitStashStore({
      repository: context.repository,
      staging,
      worktree,
      files: this.files,
      gitDir: repositoryPath,
      getHead: async () => {
        const ref = await context.repository.refs.resolve("HEAD");
        return ref?.objectId;
      },
      getBranch: async () => {
        const headRef = await context.repository.refs.get("HEAD");
        if (headRef && "target" in headRef) {
          const target = headRef.target;
          if (target.startsWith("refs/heads/")) {
            return target.substring("refs/heads/".length);
          }
        }
        return undefined;
      },
    });

    // 5. Create config
    const config = await createWorkingCopyConfig(this.files, repositoryPath);

    return new GitWorkingCopy(
      context.repository,
      worktree,
      staging,
      stash,
      config,
      this.files,
      repositoryPath,
    );
  }

  /**
   * Create additional worktree for existing repository.
   *
   * Similar to `git worktree add`.
   *
   * Git Worktree Structure:
   * - Main repo .git/worktrees/NAME/ contains:
   *   - HEAD: Current branch/commit for this worktree
   *   - index: Staging area
   *   - gitdir: Path back to worktree's .git file
   *   - config: Per-worktree config (optional)
   * - Worktree .git is a file containing:
   *   gitdir: /path/to/main/.git/worktrees/NAME
   *
   * @param repository Repository with config.path set to git directory
   * @param worktreePath Path for new working directory
   * @param options Worktree options
   */
  async addWorktree(
    repository: HistoryStore,
    worktreePath: string,
    options: AddWorktreeOptions = {},
  ): Promise<WorkingCopy> {
    const { branch, commit, force = false } = options;

    // Get git directory from repository config
    const gitDir = repository.config.path as string | undefined;
    if (!gitDir) {
      throw new Error(
        "Cannot add worktree: repository.config.path is not set. " +
          "The repository must be created with a path in its config to support worktrees.",
      );
    }

    // Extract worktree name from path
    const worktreeName = worktreePath.split("/").pop() || "worktree";
    const worktreeGitDir = `${gitDir}/worktrees/${worktreeName}`;

    // Create worktree directory
    await this.files.mkdir(worktreePath);

    // Create worktrees directory in main repo
    await this.files.mkdir(`${gitDir}/worktrees`);
    await this.files.mkdir(worktreeGitDir);

    // Create .git file in worktree pointing to main repo's worktrees/NAME
    const gitFile = `gitdir: ${worktreeGitDir}\n`;
    await this.files.writeFile(`${worktreePath}/.git`, gitFile);

    // Create gitdir file in worktrees/NAME pointing back to worktree
    await this.files.writeFile(`${worktreeGitDir}/gitdir`, `${worktreePath}/.git\n`);

    // Set up HEAD in worktrees/NAME
    if (commit) {
      // Detached HEAD
      await this.files.writeFile(`${worktreeGitDir}/HEAD`, `${commit}\n`);
    } else if (branch) {
      // Create branch if it doesn't exist (when force is true) or use existing
      const branchRef = branch.startsWith("refs/") ? branch : `refs/heads/${branch}`;
      await this.files.writeFile(`${worktreeGitDir}/HEAD`, `ref: ${branchRef}\n`);

      // If branch doesn't exist, create it pointing to current HEAD
      const existingRef = await repository.refs.get(branchRef);
      if (!existingRef && force) {
        const headRef = await repository.refs.resolve("HEAD");
        if (headRef?.objectId) {
          await repository.refs.set(branchRef, headRef.objectId);
        }
      } else if (!existingRef && !force) {
        throw new Error(`Branch '${branch}' does not exist. Use force: true to create it.`);
      }
    } else {
      // Default: detached HEAD at current commit
      const headRef = await repository.refs.resolve("HEAD");
      if (headRef?.objectId) {
        await this.files.writeFile(`${worktreeGitDir}/HEAD`, `${headRef.objectId}\n`);
      } else {
        throw new Error("Cannot add worktree: repository has no commits.");
      }
    }

    // Create the working copy using the worktree-specific git directory
    const context = await this.createContext(gitDir, {});

    // Create staging store for the new worktree
    const staging = await context.createStagingStore(worktreeGitDir);

    // Create working tree iterator
    const worktree = context.createWorktreeIterator(worktreePath);

    // Create stash store (uses main repo's stash)
    const stash = createGitStashStore({
      repository: context.repository,
      staging,
      worktree,
      files: this.files,
      gitDir: worktreeGitDir,
      getHead: async () => {
        const ref = await context.repository.refs.resolve("HEAD");
        return ref?.objectId;
      },
      getBranch: async () => {
        const headRef = await context.repository.refs.get("HEAD");
        if (headRef && "target" in headRef) {
          const target = headRef.target;
          if (target.startsWith("refs/heads/")) {
            return target.substring("refs/heads/".length);
          }
        }
        return undefined;
      },
    });

    // Create config
    const config = await createWorkingCopyConfig(this.files, worktreeGitDir);

    return new GitWorkingCopy(
      context.repository,
      worktree,
      staging,
      stash,
      config,
      this.files,
      worktreeGitDir,
    );
  }
}

/**
 * Create a GitWorkingCopyFactory instance.
 *
 * @param files File system API
 * @param createContext Function to create repository context
 */
export function createGitWorkingCopyFactory(
  files: WorkingCopyFactoryFilesApi,
  createContext: (
    repositoryPath: string,
    options: WorkingCopyOptions,
  ) => Promise<GitWorkingCopyContext>,
): WorkingCopyFactory {
  return new GitWorkingCopyFactory(files, createContext);
}
