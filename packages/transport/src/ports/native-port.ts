/**
 * Native MessagePort wrapper for MessagePortLikeExtended.
 *
 * Wraps the standard MessagePort API to provide the extended interface
 * needed by MessagePortStream.
 */

import type { MessagePortLikeExtended } from "./types.js";

/**
 * Wrap a native MessagePort as MessagePortLikeExtended.
 *
 * Native MessagePort doesn't have bufferedAmount or explicit connection state,
 * so these are simulated. The port is considered closed after close() is called.
 *
 * @param port The native MessagePort to wrap
 * @returns MessagePortLikeExtended wrapper
 */
export function createNativePort(port: MessagePort): MessagePortLikeExtended {
  let closed = false;

  const wrapper: MessagePortLikeExtended = {
    onmessage: null,
    onclose: null,
    onerror: null,

    get bufferedAmount() {
      // Native MessagePort doesn't expose bufferedAmount
      return 0;
    },

    get isOpen() {
      return !closed;
    },

    postMessage(data: ArrayBuffer | Uint8Array) {
      if (closed) {
        throw new Error("Port is closed");
      }
      // Transfer the buffer for efficiency
      const buffer =
        data instanceof ArrayBuffer
          ? data
          : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      port.postMessage(buffer, [buffer]);
    },

    close() {
      if (closed) return;
      closed = true;
      port.close();
      wrapper.onclose?.();
    },

    start() {
      port.onmessage = (e) => {
        if (closed) return;
        wrapper.onmessage?.(e as MessageEvent<ArrayBuffer>);
      };

      port.onmessageerror = () => {
        if (closed) return;
        wrapper.onerror?.(new Error("Message deserialization error"));
      };

      port.start();
    },
  };

  return wrapper;
}

/**
 * Create a pair of connected MessagePortLikeExtended ports.
 *
 * Useful for in-process communication and testing.
 *
 * @returns Tuple of two connected ports
 */
export function createNativePortPair(): [MessagePortLikeExtended, MessagePortLikeExtended] {
  const channel = new MessageChannel();
  return [createNativePort(channel.port1), createNativePort(channel.port2)];
}
