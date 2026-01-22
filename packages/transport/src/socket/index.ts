// MessagePort adapters - direct MessagePort usage (preferred)

// Socket transport layer - bidirectional socket, client and server
export {
  type BidirectionalSocketPortsOptions,
  createBidirectionalSocketPairPorts as createBidirectionalSocketPair,
  createBidirectionalSocketPorts as createBidirectionalSocket,
} from "./bidirectional-socket-ports.js";
// Git protocol client over socket
export { createGitSocketClient, type GitSocketClientOptions } from "./client.js";
export {
  createMessagePortCloser,
  createMessagePortPair,
  createMessagePortReader,
  createMessagePortWriter,
} from "./messageport-adapters.js";

// Git protocol server over socket
export {
  createGitSocketServer,
  type GitSocketServerOptions,
  handleGitSocketConnection,
} from "./server.js";

export type { BidirectionalSocket, BidirectionalSocketOptions } from "./types.js";
