/**
 * Adapters index - bridges between PeerJS/core and transport APIs.
 */

export {
  createClientDuplex,
  createPeerJsDuplex,
  type GitServiceType,
  waitForClientService,
} from "./peerjs-duplex.js";
export { createRefStoreAdapter } from "./ref-store-adapter.js";
