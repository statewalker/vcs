/**
 * Storage view - displays repository storage controls.
 *
 * Shows:
 * - Initialize repository button
 * - Storage info and controls
 */

import type { AppContext } from "../controllers/index.js";
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

    if (!state.initialized) {
      container.innerHTML = `
        <div class="storage-panel">
          <h3>Repository</h3>
          <p class="hint">Initialize a Git repository to start.</p>
          <button id="btn-init-repo" class="btn-primary">Initialize Repository</button>
        </div>
      `;

      // Bind init button
      const initBtn = container.querySelector("#btn-init-repo") as HTMLButtonElement;
      initBtn.onclick = () => {
        actionsModel.requestInitRepo();
      };
    } else {
      container.innerHTML = `
        <div class="storage-panel">
          <h3>Repository</h3>
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
          <button id="btn-refresh-repo" class="btn-small">Refresh</button>
        </div>
      `;

      // Bind refresh button
      const refreshBtn = container.querySelector("#btn-refresh-repo") as HTMLButtonElement;
      refreshBtn.onclick = () => {
        actionsModel.requestRefreshRepo();
      };
    }
  }

  // Subscribe to model updates
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
