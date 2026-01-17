/**
 * File list view - displays files in the repository.
 *
 * Shows:
 * - List of files in the repository
 * - Add file button
 */

import type { AppContext } from "../controllers/index.js";
import { getRepositoryModel, getUserActionsModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

let fileCounter = 1;

/**
 * Create the file list view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createFileListView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const repoModel = getRepositoryModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Render function
  function render(): void {
    const state = repoModel.getState();

    if (!state.initialized) {
      container.innerHTML = `
        <div class="files-panel">
          <h3>Files</h3>
          <p class="empty-state">No repository initialized.</p>
        </div>
      `;
      return;
    }

    const fileItems =
      state.files.length === 0
        ? '<p class="empty-state">No files yet.</p>'
        : state.files
            .map(
              (file) => `
            <div class="file-item">
              <span class="file-icon">${file.type === "directory" ? "📁" : "📄"}</span>
              <span class="file-name">${escapeHtml(file.name)}</span>
            </div>
          `,
            )
            .join("");

    container.innerHTML = `
      <div class="files-panel">
        <h3>Files</h3>
        <div class="file-list">${fileItems}</div>
        <div class="file-actions">
          <button id="btn-add-file" class="btn-secondary">Add File</button>
        </div>
      </div>
    `;

    // Bind add file button
    const addFileBtn = container.querySelector("#btn-add-file") as HTMLButtonElement;
    addFileBtn.onclick = () => {
      const name = `file-${fileCounter++}.txt`;
      const content = `File created at ${new Date().toISOString()}\n`;
      actionsModel.requestAddFile(name, content);
    };
  }

  // Subscribe to model updates
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
