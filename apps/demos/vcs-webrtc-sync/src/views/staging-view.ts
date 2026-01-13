/**
 * Staging View
 *
 * Renders the staging area with staged files and unstage buttons.
 */

import type { AppContext } from "../controllers/index.js";
import { unstageFile } from "../controllers/index.js";
import { getStagingModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the staging view.
 * Returns cleanup function.
 */
export function createStagingView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const stagingModel = getStagingModel(ctx);

  // Create UI structure
  container.innerHTML = `<div id="staging-list" class="file-list"></div>`;

  const stagingList = container.querySelector("#staging-list") as HTMLElement;

  // Unstage button handler (delegated)
  stagingList.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("btn-unstage")) {
      const path = target.dataset.path;
      if (path) {
        (target as HTMLButtonElement).disabled = true;
        await unstageFile(ctx, path);
      }
    }
  });

  // Render function
  function render(): void {
    const files = stagingModel.stagedFiles;

    if (files.length === 0) {
      stagingList.innerHTML = '<p class="empty-state">No files staged</p>';
      return;
    }

    const html = files
      .map(
        (file) => `
        <div class="file-item">
          <span class="file-name">${escapeHtml(file.path)}</span>
          <span class="file-status staged">staged</span>
          <button class="btn-unstage btn-small danger" data-path="${escapeHtml(file.path)}">-</button>
        </div>
      `,
      )
      .join("");

    stagingList.innerHTML = html;
  }

  // Subscribe to model updates
  register(stagingModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
