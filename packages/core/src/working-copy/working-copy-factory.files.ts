/**
 * Factory for creating file-based working copies.
 *
 * Provides methods to open existing or create new working copies,
 * and to add additional worktrees to an existing repository.
 */

import type { Repository } from "../repository.js";
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
  mkdir(path: string): Promise<void>;
}

/**
 * Context required to create a GitWorkingCopy.
 *
 * This allows the factory to be used with different storage backends
 * for the repository, staging, and worktree components.
 */
export interface GitWorkingCopyContext {
  /** The repository to link to */
  repository: Repository;
  /** Factory function to create the staging store */
  createStagingStore: (gitDir: string) => Promise<import("../staging/index.js").StagingStore>;
  /** Factory function to create the working tree iterator */
  createWorktreeIterator: (
    worktreePath: string,
  ) => import("../worktree/index.js").WorkingTreeIterator;
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
   */
  async addWorktree(
    _repository: Repository,
    worktreePath: string,
    options: AddWorktreeOptions = {},
  ): Promise<WorkingCopy> {
    const { branch, commit, force: _force = false } = options;

    // Extract worktree name from path
    const worktreeName = worktreePath.split("/").pop() || "worktree";

    // TODO: Determine main git directory from repository
    // For now, assume it's passed somehow or throw
    throw new Error(
      `Not implemented: addWorktree requires git directory access. ` +
        `Worktree: ${worktreeName}, branch: ${branch}, commit: ${commit}`,
    );

    // Full implementation would:
    // 1. Create worktree directory
    // 2. Find main .git directory
    // 3. Create .git file in worktree pointing to main repo
    // 4. Create worktrees/NAME directory in main repo
    // 5. Set up HEAD in worktrees/NAME
    // 6. Create staging store for new worktree
    // 7. Return new GitWorkingCopy
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
