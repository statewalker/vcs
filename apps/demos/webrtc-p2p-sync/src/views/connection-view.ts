/**
 * Connection panel view.
 *
 * Displays the connection UI with three modes:
 * - Disconnected: Share button + Join input
 * - Hosting: Session ID, QR code, share URL, stop button
 * - Joined: Connected to host, disconnect button
 */

import {
  enqueueDisconnectAction,
  enqueueJoinAction,
  enqueueShareAction,
} from "../actions/index.js";
import type { AppContext } from "../controllers/index.js";
import { getSessionModel, getUserActionsModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the connection panel view.
 *
 * @param ctx Application context
 * @param container Container element to render into
 * @returns Cleanup function
 */
export function createConnectionView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();

  // Get models
  const sessionModel = getSessionModel(ctx);
  const actionsModel = getUserActionsModel(ctx);

  // Create UI structure
  container.innerHTML = `
    <div class="connection-panel">
      <!-- Disconnected Panel -->
      <div id="disconnected-panel" class="panel-section">
        <div class="share-section">
          <h3>Share Repository</h3>
          <p class="hint">Create a session for others to join</p>
          <button id="btn-share" class="btn-primary">Share</button>
        </div>
        <div class="divider">or</div>
        <div class="join-section">
          <h3>Join Session</h3>
          <p class="hint">Enter a session ID to connect</p>
          <div class="join-input-group">
            <input type="text" id="input-session-id" placeholder="Session ID" />
            <button id="btn-join" class="btn-secondary">Join</button>
          </div>
        </div>
      </div>

      <!-- Hosting Panel -->
      <div id="hosting-panel" class="panel-section" style="display:none">
        <h3>Sharing Session</h3>
        <div class="session-info">
          <label>Session ID:</label>
          <code id="display-session-id" class="session-id"></code>
        </div>
        <div id="qr-container" class="qr-container"></div>
        <div class="share-url-section">
          <label>Share URL:</label>
          <div class="url-copy-group">
            <a id="display-share-url" class="share-url" href="#" target="_blank" rel="noopener noreferrer"></a>
            <button id="btn-copy-url" class="btn-small" title="Copy URL">Copy</button>
          </div>
        </div>
        <button id="btn-stop-sharing" class="btn-danger">Stop Sharing</button>
      </div>

      <!-- Joined Panel -->
      <div id="joined-panel" class="panel-section" style="display:none">
        <h3>Connected to Session</h3>
        <div class="session-info">
          <label>Session ID:</label>
          <code id="display-joined-session-id" class="session-id"></code>
        </div>
        <button id="btn-disconnect" class="btn-danger">Disconnect</button>
      </div>

      <!-- Error Display -->
      <div id="error-display" class="error-message" style="display:none"></div>
    </div>
  `;

  // Get elements
  const disconnectedPanel = container.querySelector("#disconnected-panel") as HTMLElement;
  const hostingPanel = container.querySelector("#hosting-panel") as HTMLElement;
  const joinedPanel = container.querySelector("#joined-panel") as HTMLElement;
  const errorDisplay = container.querySelector("#error-display") as HTMLElement;

  const shareBtn = container.querySelector("#btn-share") as HTMLButtonElement;
  const joinInput = container.querySelector("#input-session-id") as HTMLInputElement;
  const joinBtn = container.querySelector("#btn-join") as HTMLButtonElement;
  const stopSharingBtn = container.querySelector("#btn-stop-sharing") as HTMLButtonElement;
  const disconnectBtn = container.querySelector("#btn-disconnect") as HTMLButtonElement;
  const copyUrlBtn = container.querySelector("#btn-copy-url") as HTMLButtonElement;

  const sessionIdDisplay = container.querySelector("#display-session-id") as HTMLElement;
  const shareUrlDisplay = container.querySelector("#display-share-url") as HTMLAnchorElement;
  const joinedSessionIdDisplay = container.querySelector(
    "#display-joined-session-id",
  ) as HTMLElement;
  const qrContainer = container.querySelector("#qr-container") as HTMLElement;

  // Bind events → update UserActionsModel
  shareBtn.onclick = () => {
    enqueueShareAction(actionsModel);
  };

  joinInput.oninput = () => {
    sessionModel.setJoinInputValue(joinInput.value);
  };

  joinInput.onkeydown = (e) => {
    if (e.key === "Enter") {
      const sessionId = sessionModel.getState().joinInputValue.trim();
      if (sessionId) {
        enqueueJoinAction(actionsModel, { sessionId });
      }
    }
  };

  joinBtn.onclick = () => {
    const sessionId = sessionModel.getState().joinInputValue.trim();
    if (sessionId) {
      enqueueJoinAction(actionsModel, { sessionId });
    }
  };

  stopSharingBtn.onclick = () => {
    enqueueDisconnectAction(actionsModel);
  };

  disconnectBtn.onclick = () => {
    enqueueDisconnectAction(actionsModel);
  };

  copyUrlBtn.onclick = async () => {
    const url = sessionModel.getState().shareUrl;
    if (url) {
      try {
        await navigator.clipboard.writeText(url);
        copyUrlBtn.textContent = "Copied!";
        setTimeout(() => {
          copyUrlBtn.textContent = "Copy";
        }, 2000);
      } catch {
        // Fallback
        shareUrlDisplay.textContent = url;
      }
    }
  };

  // Render function
  function render(): void {
    const state = sessionModel.getState();

    // Show/hide panels based on mode
    disconnectedPanel.style.display = state.mode === "disconnected" ? "block" : "none";
    hostingPanel.style.display = state.mode === "hosting" ? "block" : "none";
    joinedPanel.style.display = state.mode === "joined" ? "block" : "none";

    // Update join input
    if (state.mode === "disconnected") {
      if (joinInput.value !== state.joinInputValue) {
        joinInput.value = state.joinInputValue;
      }
      joinBtn.disabled = !state.joinInputValue.trim();
    }

    // Update hosting panel
    if (state.mode === "hosting") {
      sessionIdDisplay.textContent = state.sessionId ?? "";
      shareUrlDisplay.textContent = state.shareUrl ?? "";
      shareUrlDisplay.href = state.shareUrl ?? "#";

      // Update QR code
      if (state.qrCodeDataUrl) {
        qrContainer.innerHTML = `<img src="${state.qrCodeDataUrl}" alt="QR Code" class="qr-code" />`;
      } else {
        qrContainer.innerHTML = '<div class="qr-placeholder">Generating QR code...</div>';
      }
    }

    // Update joined panel
    if (state.mode === "joined") {
      joinedSessionIdDisplay.textContent = state.sessionId ?? "";
    }

    // Update error display
    if (state.error) {
      errorDisplay.style.display = "block";
      errorDisplay.textContent = state.error;
    } else {
      errorDisplay.style.display = "none";
    }
  }

  // Subscribe to model updates
  register(sessionModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
