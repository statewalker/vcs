export type {
  ExternalIOHandles,
  GitSocketClientOptions,
  HandleGitSocketOptions,
} from "./socket-handler.js";
export {
  createGitSocketClient,
  createMessagePortCloser,
  createMessagePortReader,
  createMessagePortWriter,
  handleGitSocketConnection,
} from "./socket-handler.js";
