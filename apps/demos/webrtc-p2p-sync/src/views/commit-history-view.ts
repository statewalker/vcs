/**
 * Commit history view - displays repository commit history.
 *
 * Shows:
 * - List of recent commits
 * - Commit message, author, and date
 */

import type { AppContext } from "../controllers/index.js";
import { getRepositoryModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the commit history view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createCommitHistoryView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const repoModel = getRepositoryModel(ctx);

  // Render function
  function render(): void {
    const state = repoModel.getState();

    if (!state.initialized) {
      container.innerHTML = `
        <div class="history-panel">
          <h3>Commit History</h3>
          <p class="empty-state">No repository initialized.</p>
        </div>
      `;
      return;
    }

    if (state.commits.length === 0) {
      container.innerHTML = `
        <div class="history-panel">
          <h3>Commit History</h3>
          <p class="empty-state">No commits yet.</p>
        </div>
      `;
      return;
    }

    const commitItems = state.commits
      .map(
        (commit) => `
          <div class="commit-item">
            <div class="commit-header">
              <code class="commit-id">${commit.id.slice(0, 8)}</code>
              <span class="commit-date">${formatDate(commit.timestamp)}</span>
            </div>
            <div class="commit-message">${escapeHtml(commit.message)}</div>
            <div class="commit-author">${escapeHtml(commit.author)}</div>
          </div>
        `,
      )
      .join("");

    container.innerHTML = `
      <div class="history-panel">
        <h3>Commit History (${state.commits.length})</h3>
        <div class="commit-list">${commitItems}</div>
      </div>
    `;
  }

  // Subscribe to model updates
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}

/**
 * Format a date for display.
 */
function formatDate(date: Date): string {
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
