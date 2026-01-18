// Re-export from the new transport-peerjs package
export {
  createPeerJsPort,
  createPeerJsPortAsync,
  createPeerJsStream,
  PeerJsStream,
  type PeerJsStreamOptions,
} from "@statewalker/vcs-transport-peerjs";

export { generateQrCodeDataUrl, renderQrCodeToCanvas } from "./qr-generator.js";
export {
  buildShareUrl,
  generateSessionId,
  isValidSessionId,
  parseSessionIdFromUrl,
} from "./session-id.js";
