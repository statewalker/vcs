/**
 * Commit History View
 *
 * Renders the commit history with restore buttons.
 * Updates UserActionsModel on user interactions instead of calling controllers directly.
 */

import type { AppContext } from "../controllers/index.js";
import { getCommitHistoryModel, getRepositoryModel, getUserActionsModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the commit history view.
 * Returns cleanup function.
 */
export function createCommitHistoryView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const historyModel = getCommitHistoryModel(ctx);
  const repoModel = getRepositoryModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Create UI structure
  container.innerHTML = `<div id="commit-list" class="commit-list"></div>`;

  const commitList = container.querySelector("#commit-list") as HTMLElement;

  // Restore button handler (delegated) - update model instead of calling controller
  commitList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("btn-restore")) {
      const commitId = target.dataset.commitId;
      if (commitId) {
        // confirm() is a UI operation, acceptable in views
        const confirmed = confirm(`Restore to commit ${commitId.slice(0, 7)}?`);
        if (confirmed) {
          actionsModel.requestRestore(commitId);
        }
      }
    }
  });

  // Format timestamp
  function formatTime(timestamp: number): string {
    const date = new Date(timestamp * 1000);
    return date.toLocaleString();
  }

  // Render function
  function render(): void {
    const commits = historyModel.commits;
    const loading = historyModel.loading;
    const canRestore = !repoModel.hasUncommittedChanges;
    const currentHead = repoModel.headCommit;

    if (loading) {
      commitList.innerHTML = '<p class="empty-state loading">Loading commits...</p>';
      return;
    }

    if (commits.length === 0) {
      commitList.innerHTML = '<p class="empty-state">No commits yet</p>';
      return;
    }

    const html = commits
      .map((commit, index) => {
        const isHead = commit.id === currentHead;
        const showRestore = canRestore && !isHead && index > 0;

        return `
          <div class="commit-item ${isHead ? "current" : ""}">
            <div class="commit-header">
              <span class="commit-id">${commit.shortId}</span>
              ${isHead ? '<span class="head-badge">HEAD</span>' : ""}
              ${showRestore ? `<button class="btn-restore btn-small secondary" data-commit-id="${commit.id}">Restore</button>` : ""}
            </div>
            <div class="commit-message">${escapeHtml(commit.message)}</div>
            <div class="commit-meta">
              <span>${escapeHtml(commit.author)}</span> •
              <span>${formatTime(commit.timestamp)}</span>
            </div>
          </div>
        `;
      })
      .join("");

    commitList.innerHTML = html;
  }

  // Subscribe to model updates
  register(historyModel.onUpdate(render));
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
