/**
 * Activity Log View
 *
 * Renders the activity log with timestamped entries.
 */

import type { AppContext } from "../controllers/index.js";
import { getActivityLogModel, type LogLevel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the activity log view.
 * Returns cleanup function.
 */
export function createActivityLogView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const logModel = getActivityLogModel(ctx);

  // Create UI structure
  container.innerHTML = `
    <div class="log-controls">
      <button id="btn-clear-log" class="btn-small secondary">Clear</button>
    </div>
    <div id="log-entries" class="activity-log"></div>
  `;

  const clearBtn = container.querySelector("#btn-clear-log") as HTMLButtonElement;
  const logEntries = container.querySelector("#log-entries") as HTMLElement;

  // Clear button handler
  clearBtn.addEventListener("click", () => {
    logModel.clear();
  });

  // Format timestamp
  function formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  }

  // Get level class
  function getLevelClass(level: LogLevel): string {
    switch (level) {
      case "info":
        return "log-info";
      case "success":
        return "log-success";
      case "warning":
        return "log-warning";
      case "error":
        return "log-error";
    }
  }

  // Render function
  function render(): void {
    const entries = logModel.entries;

    if (entries.length === 0) {
      logEntries.innerHTML = '<p class="empty-state">No activity yet</p>';
      return;
    }

    // Render in reverse order (newest first)
    const html = [...entries]
      .reverse()
      .map(
        (entry) => `
        <div class="log-entry ${getLevelClass(entry.level)}">
          <span class="log-timestamp">[${formatTime(entry.timestamp)}]</span>
          <span class="log-message">${escapeHtml(entry.message)}</span>
        </div>
      `,
      )
      .join("");

    logEntries.innerHTML = html;
  }

  // Subscribe to model updates
  register(logModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
