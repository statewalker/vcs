/**
 * File List View
 *
 * Renders the working directory file list with status indicators and stage buttons.
 */

import type { AppContext } from "../controllers/index.js";
import { refreshFiles, stageFile } from "../controllers/index.js";
import { type FileStatus, getFileListModel, getRepositoryModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the file list view.
 * Returns cleanup function.
 */
export function createFileListView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const fileListModel = getFileListModel(ctx);
  const repoModel = getRepositoryModel(ctx);

  // Create UI structure
  container.innerHTML = `
    <div class="file-list-controls">
      <button id="btn-refresh" class="secondary btn-small">Refresh</button>
    </div>
    <div id="file-list" class="file-list"></div>
  `;

  const refreshBtn = container.querySelector("#btn-refresh") as HTMLButtonElement;
  const fileList = container.querySelector("#file-list") as HTMLElement;

  // Refresh button handler
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.disabled = true;
    try {
      await refreshFiles(ctx);
    } finally {
      refreshBtn.disabled = false;
    }
  });

  // Stage button handler (delegated)
  fileList.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("btn-stage")) {
      const path = target.dataset.path;
      if (path) {
        target.classList.add("disabled");
        (target as HTMLButtonElement).disabled = true;
        await stageFile(ctx, path);
      }
    }
  });

  // Get status badge class
  function getStatusClass(status: FileStatus): string {
    switch (status) {
      case "untracked":
        return "file-status untracked";
      case "modified":
        return "file-status modified";
      case "staged":
        return "file-status staged";
      case "deleted":
        return "file-status deleted";
      case "unchanged":
        return "file-status unchanged";
    }
  }

  // Render function
  function render(): void {
    const files = fileListModel.files;
    const loading = fileListModel.loading;
    const repoReady = repoModel.status === "ready";

    if (loading) {
      fileList.innerHTML = '<p class="empty-state loading">Loading files...</p>';
      return;
    }

    if (files.length === 0) {
      fileList.innerHTML = '<p class="empty-state">No files in working directory</p>';
      return;
    }

    const html = files
      .map((file) => {
        const canStage = repoReady && file.status !== "staged" && file.status !== "unchanged";
        return `
          <div class="file-item">
            <span class="file-name">${escapeHtml(file.path)}</span>
            <span class="${getStatusClass(file.status)}">${file.status}</span>
            ${canStage ? `<button class="btn-stage btn-small" data-path="${escapeHtml(file.path)}">+</button>` : ""}
          </div>
        `;
      })
      .join("");

    fileList.innerHTML = html;
  }

  // Subscribe to model updates
  register(fileListModel.onUpdate(render));
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
