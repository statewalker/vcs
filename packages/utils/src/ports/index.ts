/**
 * Port-based RPC communication utilities.
 *
 * Provides a simple request/response pattern over MessagePort,
 * as well as bidirectional streaming capabilities for complex communication patterns.
 */

// Core RPC primitives
export { serializeError, deserializeError, type SerializedError } from "./errors.js";
export { callPort, type CallPortOptions } from "./call-port.js";
export { listenPort, type ListenPortOptions, type PortHandler } from "./listen-port.js";

// Iterator-based streaming
export {
  receiveIterator,
  type MessageHandler,
  type MessageParams,
} from "./receive-iterator.js";
export { sendIterator } from "./send-iterator.js";
export { receive } from "./receive.js";
export { send } from "./send.js";

// Bidirectional I/O
export { ioHandle } from "./io-handle.js";
export { ioSend } from "./io-send.js";

// Bidirectional call/listen with streaming
export {
  callBidi,
  type CallBidiOptions,
  type CallBidiParams,
} from "./call-bidi.js";
export {
  listenBidi,
  type BidiParams,
  type BidiAcceptor,
} from "./listen-bidi.js";
