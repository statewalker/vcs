/**
 * Storage view - displays repository storage controls.
 *
 * Shows:
 * - Initialize repository button
 * - Open Repository button (persistent storage via FilesApi)
 * - Storage mode indicator
 * - Repository info and controls
 */

import {
  enqueueInitRepoAction,
  enqueueOpenRepoAction,
  enqueueRefreshRepoAction,
} from "../actions/index.js";
import type { AppContext } from "../controllers/index.js";
import { getStorageLabel } from "../controllers/index.js";
import { getRepositoryModel, getUserActionsModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the storage view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createStorageView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const repoModel = getRepositoryModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Render function
  function render(): void {
    const state = repoModel.getState();
    const storageLabel = getStorageLabel(ctx);

    if (!state.initialized) {
      container.innerHTML = `
        <div class="storage-panel">
          <h3>Repository</h3>
          <div class="storage-mode">
            <span class="storage-indicator">${storageLabel === "In-Memory" ? "&#x1F4BE;" : "&#x1F4C2;"} ${storageLabel}</span>
          </div>
          <p class="hint">Initialize a Git repository to start.</p>
          <div class="btn-group">
            <button id="btn-init-repo" class="btn-primary">Initialize Repository</button>
            <button id="btn-open-repo" class="btn-secondary">Open Repository</button>
          </div>
        </div>
      `;

      // Bind init button
      const initBtn = container.querySelector("#btn-init-repo") as HTMLButtonElement;
      initBtn.onclick = () => {
        enqueueInitRepoAction(actionsModel);
      };

      // Bind open button
      const openBtn = container.querySelector("#btn-open-repo") as HTMLButtonElement;
      openBtn.onclick = () => {
        enqueueOpenRepoAction(actionsModel);
      };
    } else {
      container.innerHTML = `
        <div class="storage-panel">
          <h3>Repository</h3>
          <div class="storage-mode">
            <span class="storage-indicator">${storageLabel === "In-Memory" ? "&#x1F4BE;" : "&#x1F4C2;"} ${storageLabel}</span>
          </div>
          <div class="repo-info">
            <div class="info-row">
              <label>Branch:</label>
              <span>${state.branch ?? "none"}</span>
            </div>
            <div class="info-row">
              <label>Commits:</label>
              <span>${state.commitCount}</span>
            </div>
            <div class="info-row">
              <label>HEAD:</label>
              <code>${state.headCommitId?.slice(0, 8) ?? "none"}</code>
            </div>
          </div>
          <div class="btn-group">
            <button id="btn-refresh-repo" class="btn-small">Refresh</button>
            <button id="btn-open-repo" class="btn-small">Open Repository</button>
          </div>
        </div>
      `;

      // Bind refresh button
      const refreshBtn = container.querySelector("#btn-refresh-repo") as HTMLButtonElement;
      refreshBtn.onclick = () => {
        enqueueRefreshRepoAction(actionsModel);
      };

      // Bind open button
      const openBtn = container.querySelector("#btn-open-repo") as HTMLButtonElement;
      openBtn.onclick = () => {
        enqueueOpenRepoAction(actionsModel);
      };
    }
  }

  // Subscribe to model updates
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
