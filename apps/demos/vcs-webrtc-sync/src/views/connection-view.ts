/**
 * Connection View
 *
 * Renders the WebRTC connection status indicator.
 * Updates UserActionsModel on user interactions instead of calling controllers directly.
 */

import type { AppContext } from "../controllers/index.js";
import { type ConnectionState, getConnectionModel, getUserActionsModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the connection view.
 * Returns cleanup function.
 */
export function createConnectionView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const connectionModel = getConnectionModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Create UI structure
  container.innerHTML = `
    <div class="connection-status">
      <span id="connection-indicator" class="status-indicator new">Not Connected</span>
      <button id="btn-disconnect" class="danger btn-small" style="display: none;">Disconnect</button>
    </div>
  `;

  const indicator = container.querySelector("#connection-indicator") as HTMLElement;
  const disconnectBtn = container.querySelector("#btn-disconnect") as HTMLButtonElement;

  // Disconnect handler - update model instead of calling controller
  disconnectBtn.addEventListener("click", () => {
    actionsModel.requestCloseConnection();
  });

  // Get status text
  function getStatusText(state: ConnectionState): string {
    switch (state) {
      case "new":
        return "Not Connected";
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Connected";
      case "disconnected":
        return "Disconnected";
      case "failed":
        return "Connection Failed";
    }
  }

  // Render function
  function render(): void {
    const state = connectionModel.state;
    const role = connectionModel.peerRole;
    const error = connectionModel.error;

    // Update indicator
    indicator.className = `status-indicator ${state}`;
    let statusText = getStatusText(state);
    if (role && state === "connected") {
      statusText += ` (${role})`;
    }
    if (error && state === "failed") {
      statusText += `: ${error}`;
    }
    indicator.textContent = statusText;

    // Show/hide disconnect button
    disconnectBtn.style.display = state === "connected" ? "inline-block" : "none";
  }

  // Subscribe to model updates
  register(connectionModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
