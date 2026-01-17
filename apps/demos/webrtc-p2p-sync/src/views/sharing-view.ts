/**
 * Sharing view - displays connected peers when hosting.
 *
 * Shows:
 * - List of connected peers with status
 * - Sync button for each peer
 * - Sync progress when active
 */

import { enqueueCancelSync, enqueueStartSync } from "../actions/index.js";
import type { AppContext } from "../controllers/index.js";
import { getPeersModel, getSyncModel, getUserActionsModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the sharing view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createSharingView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const peersModel = getPeersModel(ctx);
  const syncModel = getSyncModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Render function
  function render(): void {
    const peers = peersModel.getAll();
    const syncState = syncModel.getState();

    if (peers.length === 0) {
      container.innerHTML = `
        <div class="peers-panel">
          <h3>Connected Peers</h3>
          <p class="empty-state">No peers connected yet. Share your session ID or QR code.</p>
        </div>
      `;
      return;
    }

    const peerItems = peers
      .map((peer) => {
        const isCurrentSync = syncState.peerId === peer.id;
        const statusClass = peer.status === "connected" ? "status-connected" : "status-connecting";
        const lastSync = peer.lastSyncAt
          ? `Last sync: ${formatTime(peer.lastSyncAt)}`
          : "Never synced";

        let actionButton = "";
        if (
          isCurrentSync &&
          syncState.phase !== "idle" &&
          syncState.phase !== "complete" &&
          syncState.phase !== "error"
        ) {
          // Show progress
          const progress = syncModel.progressPercent;
          actionButton = `
            <div class="sync-progress">
              <span class="phase">${syncState.phase}</span>
              <div class="progress-bar">
                <div class="progress-fill" style="width: ${progress}%"></div>
              </div>
              <button class="btn-cancel" data-peer-id="${peer.id}">Cancel</button>
            </div>
          `;
        } else if (
          syncState.phase === "idle" ||
          syncState.phase === "complete" ||
          syncState.phase === "error"
        ) {
          // Show sync button
          const disabled = peer.status !== "connected";
          actionButton = `
            <button class="btn-sync" data-peer-id="${peer.id}" ${disabled ? "disabled" : ""}>
              Sync
            </button>
          `;
        }

        return `
          <div class="peer-item" data-peer-id="${peer.id}">
            <div class="peer-info">
              <span class="peer-name">${escapeHtml(peer.displayName)}</span>
              <span class="peer-status ${statusClass}">${peer.status}</span>
              ${peer.isHost ? '<span class="peer-role">Host</span>' : ""}
            </div>
            <div class="peer-meta">${lastSync}</div>
            <div class="peer-actions">${actionButton}</div>
          </div>
        `;
      })
      .join("");

    container.innerHTML = `
      <div class="peers-panel">
        <h3>Connected Peers (${peers.length})</h3>
        <div class="peer-list">${peerItems}</div>
      </div>
    `;

    // Bind sync button events
    container.querySelectorAll(".btn-sync").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const peerId = (e.target as HTMLElement).dataset.peerId;
        if (peerId) {
          enqueueStartSync(actionsModel, { peerId });
        }
      });
    });

    // Bind cancel button events
    container.querySelectorAll(".btn-cancel").forEach((btn) => {
      btn.addEventListener("click", () => {
        enqueueCancelSync(actionsModel);
      });
    });
  }

  // Subscribe to model updates
  register(peersModel.onUpdate(render));
  register(syncModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}

/**
 * Format a date for display.
 */
function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) {
    return "just now";
  } else if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins}m ago`;
  } else {
    return date.toLocaleTimeString();
  }
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
