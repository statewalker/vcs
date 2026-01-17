/**
 * Repository controller - manages Git repository operations.
 *
 * Handles:
 * - Initializing a new repository
 * - Adding files
 * - Creating commits
 * - Staging operations
 * - Refreshing repository state
 *
 * Uses the porcelain Git API from @statewalker/vcs-commands.
 */

import type { Git } from "@statewalker/vcs-commands";
import {
  type CommitEntry,
  type FileEntry,
  getActivityLogModel,
  getRepositoryModel,
  getUserActionsModel,
} from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import type { AppContext } from "./index.js";
import { getFilesApi, getGit, getRepository } from "./index.js";

/**
 * Create the repository controller.
 *
 * @param ctx The application context
 * @returns Cleanup function
 */
export function createRepositoryController(ctx: AppContext): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const repoModel = getRepositoryModel(ctx);
  const logModel = getActivityLogModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Listen to user actions
  register(
    actionsModel.onUpdate(() => {
      // Handle init request
      for (const _action of actionsModel.consume("repo:init")) {
        handleInit();
      }

      // Handle refresh request
      for (const _action of actionsModel.consume("repo:refresh")) {
        handleRefresh();
      }

      // Handle file add
      for (const action of actionsModel.consume("file:add")) {
        const { name, content } = action.payload as { name: string; content: string };
        handleAddFile(name, content);
      }

      // Handle commit
      for (const action of actionsModel.consume("commit:create")) {
        const { message } = action.payload as { message: string };
        handleCommit(message);
      }

      // Handle staging actions
      for (const action of actionsModel.consume("file:stage")) {
        const { path } = action.payload as { path: string };
        handleStageFile(path);
      }

      for (const action of actionsModel.consume("file:unstage")) {
        const { path } = action.payload as { path: string };
        handleUnstageFile(path);
      }

      for (const _action of actionsModel.consume("stage:all")) {
        handleStageAll();
      }
    }),
  );

  // ============ File Helper Methods ============

  /**
   * Write a file to the working directory.
   */
  async function writeFile(path: string, content: string): Promise<void> {
    const files = getFilesApi(ctx);
    if (!files) throw new Error("FilesApi not initialized");
    const encoder = new TextEncoder();
    await files.write(path, [encoder.encode(content)]);
  }

  // ============ Action Handlers ============

  /**
   * Initialize the repository with an initial commit.
   */
  async function handleInit(): Promise<void> {
    const git = getGit(ctx);
    if (!git) {
      logModel.error("Git not initialized");
      return;
    }

    try {
      logModel.info("Initializing repository...");

      // Write initial README to working directory
      await writeFile("README.md", "# My Repository\n\nInitialized via WebRTC P2P sync demo.\n");

      // Stage the file
      await git.add().addFilepattern("README.md").call();

      // Create initial commit
      const result = await git
        .commit()
        .setMessage("Initial commit")
        .setAuthor("Demo User", "demo@example.com")
        .call();

      logModel.info(`Repository initialized with commit ${result.id.slice(0, 8)}`);

      // Refresh state
      await refreshRepositoryState(git);
    } catch (error) {
      logModel.error(`Failed to initialize repository: ${(error as Error).message}`);
    }
  }

  /**
   * Refresh repository state from storage.
   */
  async function handleRefresh(): Promise<void> {
    const git = getGit(ctx);
    if (!git) {
      logModel.warn("No repository to refresh");
      return;
    }

    await refreshRepositoryState(git);
  }

  /**
   * Add a file to the repository (write, stage, and commit).
   */
  async function handleAddFile(name: string, content: string): Promise<void> {
    const git = getGit(ctx);
    if (!git) {
      logModel.error("No repository initialized");
      return;
    }

    try {
      // Write file to working directory
      await writeFile(name, content);

      // Stage the file
      await git.add().addFilepattern(name).call();

      // Commit
      const result = await git
        .commit()
        .setMessage(`Add ${name}`)
        .setAuthor("Demo User", "demo@example.com")
        .call();

      logModel.info(`Added ${name} in commit ${result.id.slice(0, 8)}`);

      // Refresh state
      await refreshRepositoryState(git);
    } catch (error) {
      logModel.error(`Failed to add file: ${(error as Error).message}`);
    }
  }

  /**
   * Create a commit with staged changes.
   */
  async function handleCommit(message: string): Promise<void> {
    const git = getGit(ctx);
    if (!git) {
      logModel.error("No repository initialized");
      return;
    }

    try {
      // Check if there are staged changes
      const status = await git.status().call();
      if (!status.hasUncommittedChanges()) {
        logModel.warn("Nothing staged to commit");
        return;
      }

      // Create commit
      const result = await git
        .commit()
        .setMessage(message)
        .setAuthor("Demo User", "demo@example.com")
        .call();

      logModel.info(`Created commit ${result.id.slice(0, 8)}: ${message}`);

      // Refresh state
      await refreshRepositoryState(git);
    } catch (error) {
      logModel.error(`Failed to commit: ${(error as Error).message}`);
    }
  }

  // ============ Staging Operations ============

  /**
   * Stage a file.
   */
  async function handleStageFile(path: string): Promise<void> {
    const git = getGit(ctx);
    if (!git) return;

    try {
      await git.add().addFilepattern(path).call();
      logModel.info(`Staged ${path}`);
      await refreshRepositoryState(git);
    } catch (error) {
      logModel.error(`Failed to stage ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Unstage a file.
   */
  async function handleUnstageFile(path: string): Promise<void> {
    const git = getGit(ctx);
    if (!git) return;

    try {
      await git.reset().addPath(path).call();
      logModel.info(`Unstaged ${path}`);
      await refreshRepositoryState(git);
    } catch (error) {
      logModel.error(`Failed to unstage ${path}: ${(error as Error).message}`);
    }
  }

  /**
   * Stage all files.
   */
  async function handleStageAll(): Promise<void> {
    const git = getGit(ctx);
    if (!git) return;

    try {
      await git.add().addFilepattern(".").call();
      logModel.info("Staged all changes");
      await refreshRepositoryState(git);
    } catch (error) {
      logModel.error(`Failed to stage all: ${(error as Error).message}`);
    }
  }

  // ============ State Refresh ============

  /**
   * Update repository model from current state.
   */
  async function refreshRepositoryState(git: Git): Promise<void> {
    const files = getFilesApi(ctx);
    const repository = getRepository(ctx);

    if (!files || !repository) {
      logModel.error("Repository infrastructure not initialized");
      return;
    }

    try {
      // Get commit log
      const commits: CommitEntry[] = [];
      try {
        for await (const commit of await git.log().setMaxCount(20).call()) {
          commits.push({
            id: commit.id,
            message: commit.message,
            author: commit.author.name,
            timestamp: new Date(commit.author.timestamp * 1000),
          });
        }
      } catch {
        // No commits yet - that's okay
      }

      // Get current branch from HEAD
      let currentBranch = "main";
      try {
        const headRef = await repository.refs.get("HEAD");
        if (headRef && "target" in headRef && headRef.target) {
          // HEAD is symbolic ref pointing to a branch
          const branchName = headRef.target.replace("refs/heads/", "");
          currentBranch = branchName;
        }
      } catch {
        // No branches yet
      }

      // Get files from HEAD tree
      const fileList: FileEntry[] = [];
      if (commits.length > 0) {
        const headCommit = await repository.commits.loadCommit(commits[0].id);
        if (headCommit.tree) {
          for await (const entry of repository.trees.loadTree(headCommit.tree)) {
            fileList.push({
              name: entry.name,
              path: entry.name,
              type: entry.mode === 0o040000 ? "directory" : "file",
              mode: entry.mode,
              id: entry.id,
            });
          }
        }
      }

      // Get staging status
      // Note: Status shows staged changes vs HEAD (added, changed, removed)
      // We don't have working tree tracking in this demo, so unstaged/untracked are empty
      let staged: string[] = [];
      const unstaged: string[] = [];
      const untracked: string[] = [];
      try {
        const status = await git.status().call();
        // Combine added and changed as "staged"
        staged = [...Array.from(status.added), ...Array.from(status.changed)];
      } catch {
        // Status might fail if no commits
      }

      // Update model
      repoModel.update({
        initialized: commits.length > 0,
        branch: currentBranch,
        commitCount: commits.length,
        files: fileList,
        headCommitId: commits[0]?.id ?? null,
        commits,
        staged,
        unstaged,
        untracked,
      });
    } catch (error) {
      logModel.error(`Failed to refresh repository: ${(error as Error).message}`);
    }
  }

  return cleanup;
}
