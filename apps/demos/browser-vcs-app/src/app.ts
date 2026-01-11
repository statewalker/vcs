/**
 * Browser VCS App - Application Logic
 *
 * Handles UI interactions and VCS operations.
 */

import { createGitStore, Git, type GitStore } from "@statewalker/vcs-commands";
import { createGitRepository, FileMode, type GitRepository } from "@statewalker/vcs-core";
import { MemoryStagingStore } from "@statewalker/vcs-store-mem";
import {
  createBrowserFsStorage,
  createMemoryStorage,
  hasGitDirectory,
  listAllFiles,
  type StorageBackend,
  type StorageType,
} from "./storage.js";

// UI Elements
let storageStatus: HTMLElement;
let repoStatus: HTMLElement;
let workingDirTree: HTMLElement;
let stagingTree: HTMLElement;
let commitHistory: HTMLElement;
let activityLog: HTMLElement;
let fileNameInput: HTMLInputElement;
let fileContentInput: HTMLTextAreaElement;
let commitMessageInput: HTMLInputElement;
let initBtn: HTMLButtonElement;

// App State
let currentStorage: StorageBackend | null = null;
let repository: GitRepository | null = null;
let store: GitStore | null = null;
let git: Git | null = null;
const stagedFiles: Map<string, string> = new Map();
let workingDirFiles: string[] = [];
let trackedFiles: Set<string> = new Set();

/**
 * Initialize the application
 */
export async function createApp(): Promise<void> {
  // Get UI elements
  storageStatus = document.getElementById("storage-status")!;
  repoStatus = document.getElementById("repo-status")!;
  workingDirTree = document.getElementById("working-dir-tree")!;
  stagingTree = document.getElementById("staging-tree")!;
  commitHistory = document.getElementById("commit-history")!;
  activityLog = document.getElementById("activity-log")!;
  fileNameInput = document.getElementById("file-name") as HTMLInputElement;
  fileContentInput = document.getElementById("file-content") as HTMLTextAreaElement;
  commitMessageInput = document.getElementById("commit-message") as HTMLInputElement;
  initBtn = document.getElementById("btn-init") as HTMLButtonElement;

  // Setup event listeners
  setupEventListeners();

  // Initialize with memory storage
  await switchStorage("memory");

  log("App initialized", "info");
}

function setupEventListeners(): void {
  // Storage buttons
  document.getElementById("btn-memory")?.addEventListener("click", () => switchStorage("memory"));
  document
    .getElementById("btn-browser-fs")
    ?.addEventListener("click", () => switchStorage("browser-fs"));

  // Repository button
  document.getElementById("btn-init")?.addEventListener("click", initOrOpenRepository);

  // File buttons
  document.getElementById("btn-add-file")?.addEventListener("click", addFile);
  document.getElementById("btn-refresh")?.addEventListener("click", refreshWorkingDir);

  // Commit button
  document.getElementById("btn-commit")?.addEventListener("click", createCommit);
}

/**
 * Switch storage backend
 */
async function switchStorage(type: StorageType): Promise<void> {
  try {
    // Close existing repository
    if (repository) {
      await repository.close();
      repository = null;
      store = null;
      git = null;
    }

    // Create new storage
    if (type === "memory") {
      currentStorage = await createMemoryStorage();
    } else {
      currentStorage = await createBrowserFsStorage();
    }

    // Update UI
    updateStorageButtons(type);
    storageStatus.textContent = currentStorage.label;
    stagedFiles.clear();
    workingDirFiles = [];
    trackedFiles.clear();

    // Check if repository exists (for browser FS)
    if (type === "browser-fs" && currentStorage.rootHandle) {
      const hasRepo = await hasGitDirectory(currentStorage.rootHandle);
      if (hasRepo) {
        repoStatus.textContent = "Repository found - click to open";
        initBtn.textContent = "Open Repository";
        log("Existing .git directory found", "info");

        // Load working directory files
        await refreshWorkingDir();
      } else {
        repoStatus.textContent = "No repository";
        initBtn.textContent = "Initialize Repository";
      }
    } else {
      repoStatus.textContent = "No repository";
      initBtn.textContent = "Initialize Repository";
    }

    updateStagingTree();
    updateWorkingDirTree();
    updateCommitHistory();

    log(`Switched to ${currentStorage.label}`, "success");
  } catch (error) {
    log(`Failed to switch storage: ${(error as Error).message}`, "error");
  }
}

function updateStorageButtons(active: StorageType): void {
  const memoryBtn = document.getElementById("btn-memory")!;
  const browserBtn = document.getElementById("btn-browser-fs")!;

  memoryBtn.classList.toggle("active", active === "memory");
  browserBtn.classList.toggle("active", active === "browser-fs");
}

/**
 * Refresh working directory file list
 */
async function refreshWorkingDir(): Promise<void> {
  if (!currentStorage) return;

  try {
    if (currentStorage.type === "browser-fs" && currentStorage.rootHandle) {
      workingDirFiles = await listAllFiles(currentStorage.rootHandle);
      log(`Found ${workingDirFiles.length} files in working directory`, "info");
    } else {
      workingDirFiles = [];
    }

    // Update tracked files from repository
    await updateTrackedFiles();
    updateWorkingDirTree();
  } catch (error) {
    log(`Failed to list files: ${(error as Error).message}`, "error");
  }
}

/**
 * Update the set of tracked files from the repository
 */
async function updateTrackedFiles(): Promise<void> {
  trackedFiles.clear();

  if (!store) return;

  try {
    const headRef = await store.refs.resolve("HEAD");
    if (!headRef?.objectId) return;

    const commit = await store.commits.loadCommit(headRef.objectId);
    await collectTreeFiles(commit.tree, "");
  } catch {
    // No commits yet
  }
}

/**
 * Recursively collect files from a tree
 */
async function collectTreeFiles(treeId: string, prefix: string): Promise<void> {
  if (!store) return;

  for await (const entry of store.trees.loadTree(treeId)) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.mode === FileMode.TREE) {
      await collectTreeFiles(entry.id, path);
    } else {
      trackedFiles.add(path);
    }
  }
}

/**
 * Initialize a new repository or open an existing one
 */
async function initOrOpenRepository(): Promise<void> {
  if (!currentStorage) {
    log("No storage backend selected", "error");
    return;
  }

  try {
    // Check if repository already exists
    let repoExists = false;
    if (currentStorage.type === "browser-fs" && currentStorage.rootHandle) {
      repoExists = await hasGitDirectory(currentStorage.rootHandle);
    }

    // Create or open repository
    repository = (await createGitRepository(currentStorage.files, ".git", {
      create: !repoExists,
      defaultBranch: "main",
    })) as GitRepository;

    // Initialize commands API
    const staging = new MemoryStagingStore();
    store = createGitStore({ repository, staging });
    git = Git.wrap(store);

    // Get current branch
    const headRef = await store.refs.resolve("HEAD");
    const branch = headRef?.symbolicRef?.replace("refs/heads/", "") || "main";

    repoStatus.textContent = `Repository ready (${branch})`;
    initBtn.textContent = "Repository Ready";
    initBtn.disabled = true;
    stagedFiles.clear();

    // Refresh working directory and tracked files
    await refreshWorkingDir();
    await updateCommitHistory();

    log(repoExists ? "Opened existing repository" : "Initialized new repository", "success");
  } catch (error) {
    log(`Failed to ${repository ? "open" : "initialize"} repository: ${(error as Error).message}`, "error");
  }
}

/**
 * Add a file to staging
 */
async function addFile(): Promise<void> {
  if (!store) {
    log("No repository initialized", "error");
    return;
  }

  const fileName = fileNameInput.value.trim();
  const content = fileContentInput.value;

  if (!fileName) {
    log("Please enter a file name", "error");
    return;
  }

  try {
    // Store blob
    const data = new TextEncoder().encode(content);
    const objectId = await store.blobs.store([data]);

    // Add to staging
    const editor = store.staging.editor();
    editor.add({
      path: fileName,
      apply: () => ({
        path: fileName,
        mode: FileMode.REGULAR_FILE,
        objectId,
        stage: 0,
        size: data.length,
        mtime: Date.now(),
      }),
    });
    await editor.finish();

    // Also write to filesystem if using browser FS
    if (currentStorage?.type === "browser-fs") {
      await currentStorage.files.write(fileName, content);
    }

    // Track staged file
    stagedFiles.set(fileName, content);

    // Clear inputs
    fileNameInput.value = "";
    fileContentInput.value = "";

    // Update UI
    await refreshWorkingDir();
    updateStagingTree();

    log(`Added file: ${fileName}`, "success");
  } catch (error) {
    log(`Failed to add file: ${(error as Error).message}`, "error");
  }
}

/**
 * Stage an existing file from working directory
 */
async function stageFile(fileName: string): Promise<void> {
  if (!store || !currentStorage) {
    log("No repository initialized", "error");
    return;
  }

  try {
    // Read file content
    const content = await currentStorage.files.read(fileName);
    if (!content) {
      log(`File not found: ${fileName}`, "error");
      return;
    }

    // Store blob
    const objectId = await store.blobs.store([content]);

    // Add to staging
    const editor = store.staging.editor();
    editor.add({
      path: fileName,
      apply: () => ({
        path: fileName,
        mode: FileMode.REGULAR_FILE,
        objectId,
        stage: 0,
        size: content.length,
        mtime: Date.now(),
      }),
    });
    await editor.finish();

    // Track staged file
    stagedFiles.set(fileName, new TextDecoder().decode(content));

    // Update UI
    updateStagingTree();
    updateWorkingDirTree();

    log(`Staged file: ${fileName}`, "success");
  } catch (error) {
    log(`Failed to stage file: ${(error as Error).message}`, "error");
  }
}

/**
 * Create a new commit
 */
async function createCommit(): Promise<void> {
  if (!store || !git) {
    log("No repository initialized", "error");
    return;
  }

  const message = commitMessageInput.value.trim();
  if (!message) {
    log("Please enter a commit message", "error");
    return;
  }

  if (stagedFiles.size === 0) {
    log("No files staged for commit", "error");
    return;
  }

  try {
    // Create commit
    const commit = await git.commit().setMessage(message).call();
    const commitId = await store.commits.storeCommit(commit);

    // Clear staged files
    stagedFiles.clear();

    // Clear input
    commitMessageInput.value = "";

    // Update UI
    await updateTrackedFiles();
    updateStagingTree();
    updateWorkingDirTree();
    await updateCommitHistory();

    log(`Created commit: ${commitId.slice(0, 7)}`, "success");
  } catch (error) {
    log(`Failed to create commit: ${(error as Error).message}`, "error");
  }
}

/**
 * Update the working directory tree display
 */
function updateWorkingDirTree(): void {
  if (workingDirFiles.length === 0) {
    workingDirTree.innerHTML = '<p class="empty-state">No files in working directory</p>';
    return;
  }

  const items = workingDirFiles
    .map((name) => {
      const isTracked = trackedFiles.has(name);
      const isStaged = stagedFiles.has(name);
      let status = "";
      let statusClass = "";

      if (isStaged) {
        status = "staged";
        statusClass = "status-staged";
      } else if (isTracked) {
        status = "tracked";
        statusClass = "status-tracked";
      } else {
        status = "untracked";
        statusClass = "status-untracked";
      }

      const canStage = !isStaged && store;

      return `
      <div class="file-item ${statusClass}">
        <span class="file-icon">📄</span>
        <span class="file-name">${escapeHtml(name)}</span>
        <span class="file-status">${status}</span>
        ${canStage ? `<button class="btn-stage" data-file="${escapeHtml(name)}">Stage</button>` : ""}
      </div>
    `;
    })
    .join("");

  workingDirTree.innerHTML = items;

  // Add click handlers for stage buttons
  workingDirTree.querySelectorAll(".btn-stage").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const fileName = (e.target as HTMLElement).getAttribute("data-file");
      if (fileName) stageFile(fileName);
    });
  });
}

/**
 * Update the staging tree display
 */
function updateStagingTree(): void {
  if (stagedFiles.size === 0) {
    stagingTree.innerHTML = '<p class="empty-state">No files staged</p>';
    return;
  }

  const items = Array.from(stagedFiles.keys())
    .sort()
    .map(
      (name) => `
      <div class="file-item status-staged">
        <span class="file-icon">📄</span>
        <span class="file-name">${escapeHtml(name)}</span>
        <span class="file-status">staged</span>
      </div>
    `,
    )
    .join("");

  stagingTree.innerHTML = items;
}

/**
 * Update the commit history display
 */
async function updateCommitHistory(): Promise<void> {
  if (!git || !store) {
    commitHistory.innerHTML = '<p class="empty-state">No commits yet</p>';
    return;
  }

  try {
    const headRef = await store.refs.resolve("HEAD");
    if (!headRef?.objectId) {
      commitHistory.innerHTML = '<p class="empty-state">No commits yet</p>';
      return;
    }

    const commits: { id: string; message: string }[] = [];

    // Walk ancestry to get commit IDs
    const commitIds: string[] = [];
    for await (const id of store.commits.walkAncestry(headRef.objectId, { limit: 10 })) {
      commitIds.push(id);
    }

    // Load commit messages
    for (const id of commitIds) {
      const commit = await store.commits.loadCommit(id);
      commits.push({
        id,
        message: commit.message.trim().split("\n")[0],
      });
    }

    if (commits.length === 0) {
      commitHistory.innerHTML = '<p class="empty-state">No commits yet</p>';
      return;
    }

    const items = commits
      .map(
        (c) => `
        <div class="commit-item">
          <span class="commit-hash">${c.id.slice(0, 7)}</span>
          <div class="commit-message">${escapeHtml(c.message)}</div>
        </div>
      `,
      )
      .join("");

    commitHistory.innerHTML = items;
  } catch (error) {
    log(`Failed to load commit history: ${(error as Error).message}`, "error");
    commitHistory.innerHTML = '<p class="empty-state">Error loading commits</p>';
  }
}

/**
 * Log a message to the activity log
 */
function log(message: string, type: "info" | "success" | "error" = "info"): void {
  const timestamp = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${timestamp}] ${message}`;

  activityLog.insertBefore(entry, activityLog.firstChild);

  // Keep only last 50 entries
  while (activityLog.children.length > 50) {
    activityLog.removeChild(activityLog.lastChild!);
  }
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
