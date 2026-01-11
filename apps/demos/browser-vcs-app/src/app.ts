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
  type StorageBackend,
  type StorageType,
} from "./storage.js";

// UI Elements
let storageStatus: HTMLElement;
let repoStatus: HTMLElement;
let fileTree: HTMLElement;
let commitHistory: HTMLElement;
let activityLog: HTMLElement;
let fileNameInput: HTMLInputElement;
let fileContentInput: HTMLTextAreaElement;
let commitMessageInput: HTMLInputElement;

// App State
let currentStorage: StorageBackend | null = null;
let repository: GitRepository | null = null;
let store: GitStore | null = null;
let git: Git | null = null;
const stagedFiles: Map<string, string> = new Map();

/**
 * Initialize the application
 */
export async function createApp(): Promise<void> {
  // Get UI elements
  storageStatus = document.getElementById("storage-status")!;
  repoStatus = document.getElementById("repo-status")!;
  fileTree = document.getElementById("file-tree")!;
  commitHistory = document.getElementById("commit-history")!;
  activityLog = document.getElementById("activity-log")!;
  fileNameInput = document.getElementById("file-name") as HTMLInputElement;
  fileContentInput = document.getElementById("file-content") as HTMLTextAreaElement;
  commitMessageInput = document.getElementById("commit-message") as HTMLInputElement;

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
  document.getElementById("btn-init")?.addEventListener("click", initRepository);

  // File buttons
  document.getElementById("btn-add-file")?.addEventListener("click", addFile);

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
    repoStatus.textContent = "No repository";
    stagedFiles.clear();
    updateFileTree();
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
 * Initialize a new Git repository
 */
async function initRepository(): Promise<void> {
  if (!currentStorage) {
    log("No storage backend selected", "error");
    return;
  }

  try {
    // Create repository
    repository = (await createGitRepository(currentStorage.files, ".git", {
      create: true,
      defaultBranch: "main",
    })) as GitRepository;

    // Initialize commands API
    const staging = new MemoryStagingStore();
    store = createGitStore({ repository, staging });
    git = Git.wrap(store);

    repoStatus.textContent = "Repository initialized (main)";
    stagedFiles.clear();
    updateFileTree();
    updateCommitHistory();

    log("Repository initialized", "success");
  } catch (error) {
    log(`Failed to initialize repository: ${(error as Error).message}`, "error");
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

    // Track staged file
    stagedFiles.set(fileName, content);

    // Clear inputs
    fileNameInput.value = "";
    fileContentInput.value = "";

    // Update UI
    updateFileTree();

    log(`Added file: ${fileName}`, "success");
  } catch (error) {
    log(`Failed to add file: ${(error as Error).message}`, "error");
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
    updateFileTree();
    await updateCommitHistory();

    log(`Created commit: ${commitId.slice(0, 7)}`, "success");
  } catch (error) {
    log(`Failed to create commit: ${(error as Error).message}`, "error");
  }
}

/**
 * Update the file tree display
 */
function updateFileTree(): void {
  if (stagedFiles.size === 0) {
    fileTree.innerHTML = '<p class="empty-state">No files staged</p>';
    return;
  }

  const items = Array.from(stagedFiles.keys())
    .sort()
    .map(
      (name) => `
      <div class="file-item">
        <span class="file-icon">📄</span>
        <span class="file-name">${escapeHtml(name)}</span>
      </div>
    `,
    )
    .join("");

  fileTree.innerHTML = items;
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
    let count = 0;

    for await (const commit of await git.log().call()) {
      // Get commit ID from the iterator
      const commitIds: string[] = [];
      for await (const id of store.commits.walkAncestry(headRef.objectId, { limit: count + 1 })) {
        commitIds.push(id);
      }
      const id = commitIds[count] || "";

      commits.push({
        id,
        message: commit.message.trim().split("\n")[0],
      });
      count++;
      if (count >= 10) break;
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
