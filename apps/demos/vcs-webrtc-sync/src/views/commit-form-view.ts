/**
 * Commit Form View
 *
 * Renders the commit message input and commit button.
 */

import type { AppContext } from "../controllers/index.js";
import { commit } from "../controllers/index.js";
import { getCommitFormModel, getRepositoryModel, getStagingModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the commit form view.
 * Returns cleanup function.
 */
export function createCommitFormView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const commitFormModel = getCommitFormModel(ctx);
  const stagingModel = getStagingModel(ctx);
  const repoModel = getRepositoryModel(ctx);

  // Create UI structure
  container.innerHTML = `
    <div class="commit-form">
      <input type="text" id="commit-message" placeholder="Commit message..." />
      <button id="btn-commit" class="success" disabled>Commit</button>
    </div>
  `;

  const messageInput = container.querySelector("#commit-message") as HTMLInputElement;
  const commitBtn = container.querySelector("#btn-commit") as HTMLButtonElement;

  // Input handler
  messageInput.addEventListener("input", () => {
    commitFormModel.setMessage(messageInput.value);
  });

  // Commit handler
  commitBtn.addEventListener("click", async () => {
    const message = commitFormModel.message.trim();
    if (message && !stagingModel.isEmpty) {
      await commit(ctx, message);
      messageInput.value = "";
    }
  });

  // Enter key handler
  messageInput.addEventListener("keydown", async (e) => {
    if (e.key === "Enter" && !commitBtn.disabled) {
      commitBtn.click();
    }
  });

  // Render function
  function render(): void {
    const isCommitting = commitFormModel.isCommitting;
    const hasMessage = commitFormModel.message.trim().length > 0;
    const hasStaged = !stagingModel.isEmpty;
    const repoReady = repoModel.status === "ready";

    // Update input state
    messageInput.disabled = isCommitting || !repoReady;

    // Sync input value if model was cleared
    if (commitFormModel.message === "" && messageInput.value !== "") {
      messageInput.value = "";
    }

    // Update button state
    commitBtn.disabled = isCommitting || !hasMessage || !hasStaged || !repoReady;
    commitBtn.textContent = isCommitting ? "Committing..." : "Commit";
  }

  // Subscribe to model updates
  register(commitFormModel.onUpdate(render));
  register(stagingModel.onUpdate(render));
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
