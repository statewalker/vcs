// Re-export from the port-peerjs package
export {
  createPeerJsPort,
  createPeerJsPortAsync,
  type PeerJsPort,
} from "@statewalker/vcs-port-peerjs";

export { generateQrCodeDataUrl, renderQrCodeToCanvas } from "./qr-generator.js";
export {
  buildShareUrl,
  generateSessionId,
  isValidSessionId,
  parseSessionIdFromUrl,
} from "./session-id.js";
