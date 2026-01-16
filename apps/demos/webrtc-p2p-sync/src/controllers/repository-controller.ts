/**
 * Repository controller - manages Git repository operations.
 *
 * Handles:
 * - Initializing a new repository
 * - Adding files
 * - Creating commits
 * - Refreshing repository state
 */

import { MemoryRefStore } from "@statewalker/vcs-core";
import { createMemoryObjectStores, type MemoryObjectStores } from "@statewalker/vcs-store-mem";
import {
  type CommitEntry,
  type FileEntry,
  getActivityLogModel,
  getRepositoryModel,
  getUserActionsModel,
} from "../models/index.js";
import { newRegistry } from "../utils/index.js";
import type { AppContext } from "./index.js";
import { getGitStore, setGitStore } from "./index.js";

/**
 * Git store combining object stores and refs.
 */
export interface GitStore extends MemoryObjectStores {
  refs: MemoryRefStore;
}

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
    }),
  );

  /**
   * Initialize a new repository.
   */
  async function handleInit(): Promise<void> {
    try {
      logModel.info("Initializing repository...");

      // Create storage
      const stores = createMemoryObjectStores();
      const store: GitStore = {
        ...stores,
        refs: new MemoryRefStore(),
      };

      setGitStore(ctx, store);

      // Create initial commit
      const encoder = new TextEncoder();
      const content = encoder.encode("# My Repository\n\nInitialized via WebRTC P2P sync demo.\n");
      const blobId = await store.blobs.store([content]);

      const treeId = await store.trees.storeTree([
        { name: "README.md", mode: 0o100644, id: blobId },
      ]);

      const now = Math.floor(Date.now() / 1000);
      const commitId = await store.commits.storeCommit({
        tree: treeId,
        parents: [],
        message: "Initial commit",
        author: {
          name: "Demo User",
          email: "demo@example.com",
          timestamp: now,
          tzOffset: "+0000",
        },
        committer: {
          name: "Demo User",
          email: "demo@example.com",
          timestamp: now,
          tzOffset: "+0000",
        },
      });

      // Set refs
      await store.refs.setSymbolic("HEAD", "refs/heads/main");
      await store.refs.set("refs/heads/main", commitId);

      logModel.info(`Repository initialized with commit ${commitId.slice(0, 8)}`);

      // Update model
      await refreshRepositoryState(store);
    } catch (error) {
      logModel.error(`Failed to initialize repository: ${(error as Error).message}`);
    }
  }

  /**
   * Refresh repository state from storage.
   */
  async function handleRefresh(): Promise<void> {
    const store = getGitStore(ctx);
    if (!store) {
      logModel.warn("No repository to refresh");
      return;
    }

    await refreshRepositoryState(store);
  }

  /**
   * Add a file to the repository.
   */
  async function handleAddFile(name: string, content: string): Promise<void> {
    const store = getGitStore(ctx);
    if (!store) {
      logModel.error("No repository initialized");
      return;
    }

    try {
      const encoder = new TextEncoder();

      // Get current HEAD
      const headRef = await store.refs.get("refs/heads/main");
      if (!headRef || !("objectId" in headRef)) {
        logModel.error("No HEAD commit");
        return;
      }
      const head = headRef.objectId;

      // Load current tree
      const commit = await store.commits.loadCommit(head);
      if (!commit.tree) {
        logModel.error("Commit has no tree");
        return;
      }
      const entries: Array<{ name: string; mode: number; id: string }> = [];
      for await (const entry of store.trees.loadTree(commit.tree)) {
        entries.push({ name: entry.name, mode: entry.mode, id: entry.id });
      }

      // Add new file
      const blobId = await store.blobs.store([encoder.encode(content)]);
      entries.push({ name, mode: 0o100644, id: blobId });

      // Create new tree
      const treeId = await store.trees.storeTree(entries);

      // Create commit
      const now = Math.floor(Date.now() / 1000);
      const commitId = await store.commits.storeCommit({
        tree: treeId,
        parents: head ? [head] : [],
        message: `Add ${name}`,
        author: {
          name: "Demo User",
          email: "demo@example.com",
          timestamp: now,
          tzOffset: "+0000",
        },
        committer: {
          name: "Demo User",
          email: "demo@example.com",
          timestamp: now,
          tzOffset: "+0000",
        },
      });

      // Update ref
      await store.refs.set("refs/heads/main", commitId);

      logModel.info(`Added ${name} in commit ${commitId.slice(0, 8)}`);

      // Refresh state
      await refreshRepositoryState(store);
    } catch (error) {
      logModel.error(`Failed to add file: ${(error as Error).message}`);
    }
  }

  /**
   * Create a commit with staged changes.
   *
   * Note: For this demo, we don't have a staging area.
   * This is a placeholder for future implementation.
   */
  async function handleCommit(_message: string): Promise<void> {
    logModel.warn("Commit with custom message not yet implemented");
  }

  /**
   * Update repository model from current state.
   */
  async function refreshRepositoryState(store: GitStore): Promise<void> {
    try {
      // Get HEAD
      const headRef = await store.refs.get("refs/heads/main");
      if (!headRef || !("objectId" in headRef)) {
        repoModel.update({
          initialized: true,
          branch: "main",
          commitCount: 0,
          files: [],
          headCommitId: null,
          commits: [],
        });
        return;
      }

      const head = headRef.objectId;

      // Load commit
      const commit = await store.commits.loadCommit(head);
      if (!commit.tree) {
        logModel.error("Commit has no tree");
        return;
      }

      // Load files from tree
      const files: FileEntry[] = [];
      for await (const entry of store.trees.loadTree(commit.tree)) {
        files.push({
          name: entry.name,
          path: entry.name,
          type: entry.mode === 0o040000 ? "directory" : "file",
          mode: entry.mode,
          id: entry.id,
        });
      }

      // Build commit history (walk back through parents)
      const commits: CommitEntry[] = [];
      let currentId: string | undefined = head;
      while (currentId && commits.length < 20) {
        const c = await store.commits.loadCommit(currentId);
        commits.push({
          id: currentId,
          message: c.message,
          author: c.author.name,
          timestamp: new Date(c.author.timestamp * 1000),
        });
        currentId = c.parents[0];
      }

      // Update model
      repoModel.update({
        initialized: true,
        branch: "main",
        commitCount: commits.length,
        files,
        headCommitId: head,
        commits,
      });
    } catch (error) {
      logModel.error(`Failed to refresh repository: ${(error as Error).message}`);
    }
  }

  return cleanup;
}
