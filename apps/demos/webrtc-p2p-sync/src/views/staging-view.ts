/**
 * Staging view - displays staging area for commits.
 *
 * Note: For this demo, staging is simplified.
 * Files are automatically committed when added.
 */

import type { AppContext } from "../controllers/index.js";
import { getRepositoryModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the staging view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createStagingView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const repoModel = getRepositoryModel(ctx);

  // Render function
  function render(): void {
    const state = repoModel.getState();

    if (!state.initialized) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = `
      <div class="staging-panel">
        <h3>Staging Area</h3>
        <p class="hint">In this demo, files are automatically committed when added.</p>
      </div>
    `;
  }

  // Subscribe to model updates
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
