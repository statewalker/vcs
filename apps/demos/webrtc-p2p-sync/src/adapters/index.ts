/**
 * Adapters index - bridges between PeerJS/core and transport APIs.
 */

export {
  createMessagePortClientDuplex,
  createMessagePortDuplex,
  waitForMessagePortClientService,
} from "./messageport-duplex.js";
export {
  createClientDuplex,
  createPeerJsDuplex,
  type GitServiceType,
  waitForClientService,
} from "./peerjs-duplex.js";
export { createRefStoreAdapter } from "./ref-store-adapter.js";
