// Re-export from the port-peerjs package
export { createPeerJsPort, createPeerJsPortAsync } from "@statewalker/vcs-port-peerjs";

export { generateQrCodeDataUrl, renderQrCodeToCanvas } from "./qr-generator.js";
export {
  buildShareUrl,
  generateSessionId,
  isValidSessionId,
  parseSessionIdFromUrl,
} from "./session-id.js";
