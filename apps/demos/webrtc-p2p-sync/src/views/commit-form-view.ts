/**
 * Commit form view - displays form for creating commits.
 *
 * Note: For this demo, commits are created automatically when files are added.
 * This view is a placeholder for future manual commit functionality.
 */

import { enqueueCreateCommit } from "../actions/index.js";
import type { AppContext } from "../controllers/index.js";
import { getRepositoryModel, getUserActionsModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the commit form view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createCommitFormView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const repoModel = getRepositoryModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Render function
  function render(): void {
    const state = repoModel.getState();

    if (!state.initialized) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML = `
      <div class="commit-form-panel">
        <h3>Create Commit</h3>
        <div class="form-group">
          <textarea id="commit-message" placeholder="Commit message..." rows="2"></textarea>
        </div>
        <button id="btn-commit" class="btn-primary" disabled>Commit</button>
        <p class="hint">Note: Files are auto-committed when added in this demo.</p>
      </div>
    `;

    // Bind commit button
    const messageInput = container.querySelector("#commit-message") as HTMLTextAreaElement;
    const commitBtn = container.querySelector("#btn-commit") as HTMLButtonElement;

    messageInput.oninput = () => {
      commitBtn.disabled = !messageInput.value.trim();
    };

    commitBtn.onclick = () => {
      const message = messageInput.value.trim();
      if (message) {
        enqueueCreateCommit(actionsModel, { message });
        messageInput.value = "";
        commitBtn.disabled = true;
      }
    };
  }

  // Subscribe to model updates
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
