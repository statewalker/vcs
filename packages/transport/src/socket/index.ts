// Socket transport layer - bidirectional socket, client and server
export {
  createBidirectionalSocket,
  createBidirectionalSocketPair,
} from "./bidirectional-socket.js";
// Git protocol client over socket
export { createGitSocketClient, type GitSocketClientOptions } from "./client.js";
// Git protocol server over socket
export {
  createGitSocketServer,
  type GitSocketServerOptions,
  handleGitSocketConnection,
} from "./server.js";
export type { BidirectionalSocket, BidirectionalSocketOptions } from "./types.js";
