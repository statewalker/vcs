/**
 * Activity log view - displays application log entries.
 *
 * Shows:
 * - Timestamped log messages
 * - Color-coded by severity (info, warn, error)
 * - Auto-scrolls to latest entries
 */

import type { AppContext } from "../controllers/index.js";
import { getActivityLogModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the activity log view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createActivityLogView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const logModel = getActivityLogModel(ctx);

  // Render function
  function render(): void {
    const entries = logModel.getEntries();

    const logItems = entries
      .map(
        (entry) => `
          <div class="log-entry log-${entry.level}">
            <span class="log-time">[${formatTime(entry.timestamp)}]</span>
            <span class="log-message">${escapeHtml(entry.message)}</span>
          </div>
        `,
      )
      .join("");

    container.innerHTML = `
      <div class="log-panel">
        <h3>Activity Log</h3>
        <div class="log-entries" id="log-entries-container">
          ${logItems || '<p class="empty-state">No activity yet.</p>'}
        </div>
      </div>
    `;

    // Auto-scroll to bottom
    const logContainer = container.querySelector("#log-entries-container");
    if (logContainer) {
      logContainer.scrollTop = logContainer.scrollHeight;
    }
  }

  // Subscribe to model updates
  register(logModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}

/**
 * Format time for display.
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString();
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
