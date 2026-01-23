// MessagePort adapters - direct MessagePort usage

// Git protocol client over MessagePort
export {
  createGitSocketClient,
  type ExternalIOHandles,
  type GitSocketClientOptions,
} from "./client.js";
export {
  createMessagePortCloser,
  createMessagePortPair,
  createMessagePortReader,
  createMessagePortWriter,
} from "./messageport-adapters.js";

// Git protocol server over MessagePort
export {
  createGitSocketServer,
  type GitSocketServerOptions,
  handleGitSocketConnection,
} from "./server.js";
