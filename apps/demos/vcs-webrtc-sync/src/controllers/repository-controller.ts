/**
 * Repository Controller
 *
 * Manages Git repository operations using vcs-commands.
 * Updates models based on repository state.
 */

import { Git, type GitStore, type GitStoreWithWorkTree } from "@statewalker/vcs-commands";
import { FileMode, FileStagingStore, type GitRepository } from "@statewalker/vcs-core";
import {
  type CommitEntry,
  type FileEntry,
  type FileStatus,
  getActivityLogModel,
  getCommitFormModel,
  getCommitHistoryModel,
  getFileListModel,
  getRepositoryModel,
  getStagingModel,
} from "../models/index.js";
import { newAdapter, newRegistry } from "../utils/index.js";
import { getStorageBackend } from "./storage-controller.js";

// Adapters for Git state
export const [getGitRepository, setGitRepository] = newAdapter<GitRepository | null>(
  "git-repository",
  () => null,
);

export const [getGitStore, setGitStore] = newAdapter<GitStore | GitStoreWithWorkTree | null>(
  "git-store",
  () => null,
);

export const [getGit, setGit] = newAdapter<Git | null>("git-instance", () => null);

let refreshInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Create the repository controller.
 * Returns cleanup function.
 */
export function createRepositoryController(ctx: Map<string, unknown>): () => void {
  const [register, cleanup] = newRegistry();

  register(() => {
    stopAutoRefresh();
    const repo = getGitRepository(ctx);
    if (repo) {
      repo.close();
      setGitRepository(ctx, null);
      setGitStore(ctx, null);
      setGit(ctx, null);
    }
  });

  return cleanup;
}

/**
 * Initialize or open a Git repository.
 */
export async function initOrOpenRepository(ctx: Map<string, unknown>): Promise<boolean> {
  const backend = getStorageBackend(ctx);
  const repoModel = getRepositoryModel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!backend) {
    logModel.error("No storage backend selected");
    return false;
  }

  try {
    // Check if repository already exists (for browser FS)
    let repoExists = false;
    if (backend.type === "browser-fs" && backend.rootHandle) {
      try {
        await backend.rootHandle.getDirectoryHandle(".git");
        repoExists = true;
      } catch {
        repoExists = false;
      }
    }

    // Configure staging store
    let customStaging: FileStagingStore | undefined;
    if (backend.type === "browser-fs") {
      customStaging = new FileStagingStore(backend.files, ".git/index");
      if (repoExists) {
        await customStaging.read();
      }
    }

    // Use Git.init() to initialize or open
    const initCommand = Git.init()
      .setFilesApi(backend.files)
      .setGitDir(".git")
      .setInitialBranch("main")
      .setWorktree(true);

    if (customStaging) {
      initCommand.setStagingStore(customStaging);
    }

    const result = await initCommand.call();

    setGitRepository(ctx, result.repository as GitRepository);
    setGitStore(ctx, result.store);
    setGit(ctx, result.git);

    // Get current branch
    const headRef = await result.store.refs.resolve("HEAD");
    const branch = headRef?.symbolicRef?.replace("refs/heads/", "") || "main";
    const headCommit = headRef?.objectId || "";

    repoModel.setReady(backend.folderName, branch, headCommit);
    logModel.success(repoExists ? "Opened existing repository" : "Initialized new repository");

    // Load initial state
    await refreshFiles(ctx);
    await loadHistory(ctx);

    // Start auto-refresh for browser FS
    if (backend.type === "browser-fs") {
      startAutoRefresh(ctx, 3000);
    }

    return true;
  } catch (error) {
    logModel.error(`Failed to initialize repository: ${(error as Error).message}`);
    repoModel.setError((error as Error).message);
    return false;
  }
}

/**
 * Create sample files for a new repository.
 */
export async function createSampleFiles(ctx: Map<string, unknown>): Promise<void> {
  const backend = getStorageBackend(ctx);
  const git = getGit(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!backend || !git) {
    logModel.error("No repository initialized");
    return;
  }

  const encoder = new TextEncoder();

  const sampleFiles = [
    {
      path: "index.md",
      content: `# My Project

Welcome to this VCS WebRTC Sync demo project.

## Overview

This project demonstrates peer-to-peer Git synchronization using WebRTC.
`,
    },
    {
      path: "docs/getting-started.md",
      content: `# Getting Started

## Prerequisites

- A modern web browser with WebRTC support
- Two browser tabs/windows to test P2P sync

## Quick Start

1. Open this app in two browser tabs
2. Initialize a repository in each
3. Use Share/Connect to establish a P2P connection
4. Make changes and sync between peers
`,
    },
    {
      path: "docs/architecture.md",
      content: `# Architecture

## Components

- **Models**: Observable state containers
- **Controllers**: Business logic and external API interactions
- **Views**: UI rendering based on model state

## Data Flow

\`\`\`
External World <---> Controllers <---> Models <---> Views <---> User
\`\`\`
`,
    },
    {
      path: "docs/api-reference.md",
      content: `# API Reference

## Git Operations

- \`init\`: Initialize a new repository
- \`add\`: Stage files for commit
- \`commit\`: Create a new commit
- \`status\`: Check working directory status

## WebRTC Operations

- \`createOffer\`: Generate connection offer
- \`acceptOffer\`: Accept and respond to offer
- \`sync\`: Synchronize repositories
`,
    },
  ];

  try {
    for (const file of sampleFiles) {
      await backend.files.write(file.path, [encoder.encode(file.content)]);
      await git.add().addFilepattern(file.path).call();
    }

    logModel.success(`Created ${sampleFiles.length} sample files`);
    await refreshFiles(ctx);
  } catch (error) {
    logModel.error(`Failed to create sample files: ${(error as Error).message}`);
  }
}

/**
 * Refresh the file list from the working directory.
 */
export async function refreshFiles(ctx: Map<string, unknown>): Promise<void> {
  const backend = getStorageBackend(ctx);
  const store = getGitStore(ctx);
  const fileListModel = getFileListModel(ctx);
  const stagingModel = getStagingModel(ctx);
  const repoModel = getRepositoryModel(ctx);

  if (!backend || !store) return;

  fileListModel.setLoading(true);

  try {
    // Get tracked files from HEAD
    const trackedFiles = new Map<string, string>();
    const headRef = await store.refs.resolve("HEAD");
    if (headRef?.objectId) {
      const commit = await store.commits.loadCommit(headRef.objectId);
      await collectTreeFiles(store, commit.tree, "", trackedFiles);
    }

    // Get staged files from staging store
    const stagedFiles = new Map<string, string>();
    if ("staging" in store && store.staging) {
      for await (const entry of store.staging.entries()) {
        stagedFiles.set(entry.path, entry.objectId);
      }
    }

    // List working directory files
    const workingFiles: string[] = [];
    if (backend.type === "browser-fs" && backend.rootHandle) {
      await listFilesRecursive(backend.rootHandle, "", workingFiles);
    } else {
      // For memory storage, list from files API
      for await (const entry of backend.files.list("")) {
        if (entry.type === "file") {
          workingFiles.push(entry.name);
        }
      }
    }

    // Build file entries with status
    const fileEntries: FileEntry[] = [];
    const allPaths = new Set([...workingFiles, ...trackedFiles.keys()]);

    for (const path of allPaths) {
      const isInWorkdir = workingFiles.includes(path);
      const isTracked = trackedFiles.has(path);
      const isStaged = stagedFiles.has(path);

      let status: FileStatus;
      if (!isInWorkdir && isTracked) {
        status = "deleted";
      } else if (isStaged) {
        status = "staged";
      } else if (!isTracked) {
        status = "untracked";
      } else {
        // Check if modified (simplified - just check if in staging differs from HEAD)
        status = "unchanged";
      }

      fileEntries.push({ path, status });
    }

    fileListModel.setFiles(fileEntries);

    // Update staging model
    const staged = Array.from(stagedFiles.entries()).map(([path, objectId]) => ({
      path,
      objectId,
    }));
    stagingModel.setStagedFiles(staged);

    // Update uncommitted changes flag
    const hasChanges =
      stagedFiles.size > 0 ||
      fileEntries.some((f) => f.status !== "unchanged" && f.status !== "staged");
    repoModel.setUncommittedChanges(hasChanges);
  } catch (error) {
    console.error("Failed to refresh files:", error);
  } finally {
    fileListModel.setLoading(false);
  }
}

/**
 * Stage a file for commit.
 */
export async function stageFile(ctx: Map<string, unknown>, path: string): Promise<void> {
  const git = getGit(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!git) {
    logModel.error("No repository initialized");
    return;
  }

  try {
    await git.add().addFilepattern(path).call();
    logModel.info(`Staged: ${path}`);
    await refreshFiles(ctx);
  } catch (error) {
    logModel.error(`Failed to stage ${path}: ${(error as Error).message}`);
  }
}

/**
 * Unstage a file.
 */
export async function unstageFile(ctx: Map<string, unknown>, path: string): Promise<void> {
  const store = getGitStore(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!store || !("staging" in store) || !store.staging) {
    logModel.error("No repository initialized");
    return;
  }

  try {
    await store.staging.remove(path);
    logModel.info(`Unstaged: ${path}`);
    await refreshFiles(ctx);
  } catch (error) {
    logModel.error(`Failed to unstage ${path}: ${(error as Error).message}`);
  }
}

/**
 * Create a commit with the staged files.
 */
export async function commit(ctx: Map<string, unknown>, message: string): Promise<string | null> {
  const git = getGit(ctx);
  const store = getGitStore(ctx);
  const repoModel = getRepositoryModel(ctx);
  const commitFormModel = getCommitFormModel(ctx);
  const stagingModel = getStagingModel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!git || !store) {
    logModel.error("No repository initialized");
    return null;
  }

  if (stagingModel.isEmpty) {
    logModel.error("No files staged for commit");
    return null;
  }

  commitFormModel.setCommitting(true);

  try {
    const commitData = await git.commit().setMessage(message).call();
    const commitId = await store.commits.storeCommit(commitData);

    // Update HEAD
    repoModel.updateHead(commitId);
    commitFormModel.clear();
    stagingModel.clear();

    logModel.success(`Created commit: ${commitId.slice(0, 7)}`);

    await refreshFiles(ctx);
    await loadHistory(ctx);

    return commitId;
  } catch (error) {
    logModel.error(`Failed to commit: ${(error as Error).message}`);
    return null;
  } finally {
    commitFormModel.setCommitting(false);
  }
}

/**
 * Load commit history.
 */
export async function loadHistory(ctx: Map<string, unknown>): Promise<void> {
  const store = getGitStore(ctx);
  const historyModel = getCommitHistoryModel(ctx);

  if (!store) return;

  historyModel.setLoading(true);

  try {
    const headRef = await store.refs.resolve("HEAD");
    if (!headRef?.objectId) {
      historyModel.setCommits([]);
      return;
    }

    const commits: CommitEntry[] = [];

    for await (const id of store.commits.walkAncestry(headRef.objectId, { limit: 50 })) {
      const commit = await store.commits.loadCommit(id);
      commits.push({
        id,
        shortId: id.slice(0, 7),
        message: commit.message.trim().split("\n")[0],
        author: commit.author.name,
        timestamp: commit.author.timestamp,
      });
    }

    historyModel.setCommits(commits);
  } catch (error) {
    console.error("Failed to load history:", error);
  } finally {
    historyModel.setLoading(false);
  }
}

/**
 * Restore working directory to a specific commit.
 */
export async function restoreToCommit(ctx: Map<string, unknown>, commitId: string): Promise<void> {
  const store = getGitStore(ctx);
  const backend = getStorageBackend(ctx);
  const repoModel = getRepositoryModel(ctx);
  const logModel = getActivityLogModel(ctx);

  if (!store || !backend) {
    logModel.error("No repository initialized");
    return;
  }

  if (repoModel.hasUncommittedChanges) {
    logModel.warning("Cannot restore: uncommitted changes exist");
    return;
  }

  try {
    const commit = await store.commits.loadCommit(commitId);

    // Clear working directory and restore from tree
    await restoreTree(store, backend, commit.tree, "");

    // Update refs
    await store.refs.set("refs/heads/main", commitId);
    repoModel.updateHead(commitId);

    logModel.success(`Restored to commit: ${commitId.slice(0, 7)}`);
    await refreshFiles(ctx);
    await loadHistory(ctx);
  } catch (error) {
    logModel.error(`Failed to restore: ${(error as Error).message}`);
  }
}

/**
 * Start auto-refresh interval.
 */
export function startAutoRefresh(ctx: Map<string, unknown>, intervalMs: number): void {
  stopAutoRefresh();
  refreshInterval = setInterval(() => refreshFiles(ctx), intervalMs);
}

/**
 * Stop auto-refresh interval.
 */
export function stopAutoRefresh(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// Helper functions

async function collectTreeFiles(
  store: GitStore | GitStoreWithWorkTree,
  treeId: string,
  prefix: string,
  files: Map<string, string>,
): Promise<void> {
  for await (const entry of store.trees.loadTree(treeId)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.mode === FileMode.TREE) {
      await collectTreeFiles(store, entry.id, path, files);
    } else {
      files.set(path, entry.id);
    }
  }
}

async function listFilesRecursive(
  handle: FileSystemDirectoryHandle,
  prefix: string,
  files: string[],
): Promise<void> {
  for await (const entry of handle.values()) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "file") {
      files.push(path);
    } else if (entry.kind === "directory" && entry.name !== ".git") {
      const subHandle = await handle.getDirectoryHandle(entry.name);
      await listFilesRecursive(subHandle, path, files);
    }
  }
}

async function restoreTree(
  store: GitStore | GitStoreWithWorkTree,
  backend: { files: { write: (path: string, chunks: Uint8Array[]) => Promise<void> } },
  treeId: string,
  prefix: string,
): Promise<void> {
  for await (const entry of store.trees.loadTree(treeId)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.mode === FileMode.TREE) {
      await restoreTree(store, backend, entry.id, path);
    } else {
      const chunks: Uint8Array[] = [];
      for await (const chunk of store.blobs.load(entry.id)) {
        chunks.push(chunk);
      }
      await backend.files.write(path, chunks);
    }
  }
}
