/**
 * Sharing View
 *
 * Renders the Share/Connect UI for establishing WebRTC connections.
 */

import type { AppContext } from "../controllers/index.js";
import {
  acceptAnswer,
  acceptOffer,
  createOffer,
  fetchFromRemote,
  pushToRemote,
} from "../controllers/index.js";
import { getConnectionModel, getRepositoryModel, getSharingFormModel } from "../models/index.js";
import { newRegistry } from "../utils/index.js";

/**
 * Create the sharing view.
 * Returns cleanup function.
 */
export function createSharingView(ctx: AppContext, container: HTMLElement): () => void {
  const [register, cleanup] = newRegistry();
  const sharingModel = getSharingFormModel(ctx);
  const connectionModel = getConnectionModel(ctx);
  const repoModel = getRepositoryModel(ctx);

  // Create UI structure
  container.innerHTML = `
    <div class="sharing-panel">
      <div class="sharing-buttons">
        <button id="btn-share" class="primary">Share</button>
        <button id="btn-connect" class="secondary">Connect</button>
      </div>

      <div id="sharing-form" class="sharing-form" style="display: none;">
        <div id="share-section" style="display: none;">
          <p>Copy this signal and send to your peer:</p>
          <textarea id="local-signal" class="signal-textarea" readonly></textarea>
          <button id="btn-copy-signal" class="btn-small">Copy to Clipboard</button>
          <p>Paste the answer from your peer:</p>
          <textarea id="remote-signal" class="signal-textarea" placeholder="Paste answer here..."></textarea>
          <button id="btn-accept-answer" class="success" disabled>Accept Answer</button>
        </div>

        <div id="connect-section" style="display: none;">
          <p>Paste the offer signal from your peer:</p>
          <textarea id="offer-input" class="signal-textarea" placeholder="Paste offer here..."></textarea>
          <button id="btn-accept-offer" class="success" disabled>Accept Offer</button>
          <div id="answer-section" style="display: none;">
            <p>Copy this answer and send back to your peer:</p>
            <textarea id="answer-signal" class="signal-textarea" readonly></textarea>
            <button id="btn-copy-answer" class="btn-small">Copy to Clipboard</button>
          </div>
        </div>
      </div>

      <div id="sync-controls" class="sync-controls" style="display: none;">
        <button id="btn-push" class="primary">Push</button>
        <button id="btn-fetch" class="secondary">Fetch</button>
      </div>
    </div>
  `;

  // Get elements
  const shareBtn = container.querySelector("#btn-share") as HTMLButtonElement;
  const connectBtn = container.querySelector("#btn-connect") as HTMLButtonElement;
  const sharingForm = container.querySelector("#sharing-form") as HTMLElement;
  const shareSection = container.querySelector("#share-section") as HTMLElement;
  const connectSection = container.querySelector("#connect-section") as HTMLElement;
  const answerSection = container.querySelector("#answer-section") as HTMLElement;

  const localSignal = container.querySelector("#local-signal") as HTMLTextAreaElement;
  const remoteSignal = container.querySelector("#remote-signal") as HTMLTextAreaElement;
  const offerInput = container.querySelector("#offer-input") as HTMLTextAreaElement;
  const answerSignal = container.querySelector("#answer-signal") as HTMLTextAreaElement;

  const copySignalBtn = container.querySelector("#btn-copy-signal") as HTMLButtonElement;
  const acceptAnswerBtn = container.querySelector("#btn-accept-answer") as HTMLButtonElement;
  const acceptOfferBtn = container.querySelector("#btn-accept-offer") as HTMLButtonElement;
  const copyAnswerBtn = container.querySelector("#btn-copy-answer") as HTMLButtonElement;

  const syncControls = container.querySelector("#sync-controls") as HTMLElement;
  const pushBtn = container.querySelector("#btn-push") as HTMLButtonElement;
  const fetchBtn = container.querySelector("#btn-fetch") as HTMLButtonElement;

  // Event handlers
  shareBtn.addEventListener("click", async () => {
    shareBtn.disabled = true;
    await createOffer(ctx);
    shareBtn.disabled = false;
  });

  connectBtn.addEventListener("click", () => {
    sharingModel.startConnect();
  });

  copySignalBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(localSignal.value);
    copySignalBtn.textContent = "Copied!";
    setTimeout(() => {
      copySignalBtn.textContent = "Copy to Clipboard";
    }, 2000);
  });

  copyAnswerBtn.addEventListener("click", async () => {
    await navigator.clipboard.writeText(answerSignal.value);
    copyAnswerBtn.textContent = "Copied!";
    setTimeout(() => {
      copyAnswerBtn.textContent = "Copy to Clipboard";
    }, 2000);
  });

  remoteSignal.addEventListener("input", () => {
    sharingModel.setRemoteSignal(remoteSignal.value);
    acceptAnswerBtn.disabled = remoteSignal.value.trim().length === 0;
  });

  offerInput.addEventListener("input", () => {
    sharingModel.setRemoteSignal(offerInput.value);
    acceptOfferBtn.disabled = offerInput.value.trim().length === 0;
  });

  acceptAnswerBtn.addEventListener("click", async () => {
    acceptAnswerBtn.disabled = true;
    await acceptAnswer(ctx, remoteSignal.value);
  });

  acceptOfferBtn.addEventListener("click", async () => {
    acceptOfferBtn.disabled = true;
    await acceptOffer(ctx, offerInput.value);
    acceptOfferBtn.disabled = false;
  });

  pushBtn.addEventListener("click", async () => {
    pushBtn.disabled = true;
    await pushToRemote(ctx);
    pushBtn.disabled = false;
  });

  fetchBtn.addEventListener("click", async () => {
    fetchBtn.disabled = true;
    await fetchFromRemote(ctx);
    fetchBtn.disabled = false;
  });

  // Render function
  function render(): void {
    const mode = sharingModel.mode;
    const signal = sharingModel.localSignal;
    const isConnected = connectionModel.isConnected;
    const repoReady = repoModel.status === "ready";

    // Show/hide main sections
    sharingForm.style.display = mode !== "idle" ? "block" : "none";
    shareSection.style.display = mode === "share" ? "block" : "none";
    connectSection.style.display = mode === "connect" ? "block" : "none";

    // Update local signal display
    if (signal) {
      localSignal.value = signal;
      answerSignal.value = signal;
      if (mode === "connect") {
        answerSection.style.display = "block";
      }
    }

    // Show/hide share/connect buttons based on connection state
    shareBtn.disabled = isConnected || mode !== "idle";
    connectBtn.disabled = isConnected || mode !== "idle";

    // Show sync controls when connected
    syncControls.style.display = isConnected ? "block" : "none";
    pushBtn.disabled = !repoReady;
    fetchBtn.disabled = !repoReady;
  }

  // Subscribe to model updates
  register(sharingModel.onUpdate(render));
  register(connectionModel.onUpdate(render));
  register(repoModel.onUpdate(render));

  // Initial render
  render();

  return cleanup;
}
