/**
 * RTCDataChannel adapter for MessagePortLikeExtended.
 *
 * Wraps an RTCDataChannel to provide the MessagePortLikeExtended interface,
 * enabling use with MessagePortStream for Git protocol communication.
 */

import type { MessagePortLikeExtended } from "@statewalker/vcs-transport";

/**
 * Wrap an RTCDataChannel as MessagePortLikeExtended.
 *
 * The channel must be in "open" state or opening.
 *
 * @param channel The RTCDataChannel to wrap
 * @returns MessagePortLikeExtended adapter
 */
export function createDataChannelPort(channel: RTCDataChannel): MessagePortLikeExtended {
  const port: MessagePortLikeExtended = {
    onmessage: null,
    onmessageerror: null,
    onclose: null,
    onerror: null,

    get bufferedAmount() {
      return channel.bufferedAmount;
    },

    get isOpen() {
      return channel.readyState === "open";
    },

    postMessage(data: ArrayBuffer | Uint8Array) {
      if (channel.readyState !== "open") {
        throw new Error("DataChannel is not open");
      }
      // Convert to ArrayBuffer for sending
      const buffer =
        data instanceof ArrayBuffer
          ? data
          : (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
      channel.send(buffer);
    },

    close() {
      channel.close();
    },

    start() {
      channel.binaryType = "arraybuffer";

      channel.onmessage = (e) => {
        port.onmessage?.({ data: e.data } as MessageEvent<ArrayBuffer>);
      };

      channel.onclose = () => port.onclose?.();

      channel.onerror = (e) => {
        const err = (e as RTCErrorEvent).error ?? new Error("DataChannel error");
        port.onerror?.(err);
      };
    },
  };

  return port;
}

/**
 * Create DataChannel port and wait for it to open.
 *
 * @param channel The RTCDataChannel to wrap
 * @returns Promise resolving to MessagePortLikeExtended when channel is open
 */
export async function createDataChannelPortAsync(
  channel: RTCDataChannel,
): Promise<MessagePortLikeExtended> {
  if (channel.readyState === "open") {
    return createDataChannelPort(channel);
  }

  await new Promise<void>((resolve, reject) => {
    channel.onopen = () => resolve();
    channel.onerror = (e) => {
      const err = (e as RTCErrorEvent).error ?? new Error("DataChannel error");
      reject(err);
    };
  });

  return createDataChannelPort(channel);
}
