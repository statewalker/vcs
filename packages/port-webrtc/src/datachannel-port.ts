/**
 * RTCDataChannel adapter for MessagePortLike.
 *
 * Wraps an RTCDataChannel to provide the MessagePortLike interface,
 * enabling use with port-stream for Git protocol communication.
 */

import type {
  MessagePortEventListener,
  MessagePortEventType,
  MessagePortLike,
} from "@statewalker/vcs-utils";

/**
 * DataChannel port interface - MessagePortLike with bufferedAmount for backpressure.
 */
export interface DataChannelPort extends MessagePortLike {
  readonly bufferedAmount: number;
}

/**
 * Wrap an RTCDataChannel as MessagePortLike.
 *
 * The channel must be in "open" state or opening.
 *
 * @param channel The RTCDataChannel to wrap
 * @returns MessagePortLike adapter with bufferedAmount support
 */
export function createDataChannelPort(channel: RTCDataChannel): DataChannelPort {
  let started = false;
  const messageListeners = new Set<(event: MessageEvent<ArrayBuffer>) => void>();
  const closeListeners = new Set<() => void>();
  const errorListeners = new Set<(error: Error) => void>();

  const port: DataChannelPort = {
    get bufferedAmount() {
      return channel.bufferedAmount;
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
      if (started) return;
      started = true;

      channel.binaryType = "arraybuffer";

      channel.onmessage = (e) => {
        const event = { data: e.data } as MessageEvent<ArrayBuffer>;
        for (const listener of messageListeners) {
          listener(event);
        }
      };

      channel.onclose = () => {
        for (const listener of closeListeners) {
          listener();
        }
      };

      channel.onerror = (e) => {
        const err = (e as RTCErrorEvent).error ?? new Error("DataChannel error");
        for (const listener of errorListeners) {
          listener(err);
        }
      };
    },

    addEventListener<T extends MessagePortEventType>(
      type: T,
      listener: MessagePortEventListener<T>,
    ) {
      if (type === "message") {
        messageListeners.add(listener as (event: MessageEvent<ArrayBuffer>) => void);
      } else if (type === "close") {
        closeListeners.add(listener as () => void);
      } else if (type === "error") {
        errorListeners.add(listener as (error: Error) => void);
      }
    },

    removeEventListener<T extends MessagePortEventType>(
      type: T,
      listener: MessagePortEventListener<T>,
    ) {
      if (type === "message") {
        messageListeners.delete(listener as (event: MessageEvent<ArrayBuffer>) => void);
      } else if (type === "close") {
        closeListeners.delete(listener as () => void);
      } else if (type === "error") {
        errorListeners.delete(listener as (error: Error) => void);
      }
    },
  };

  return port;
}

/**
 * Create DataChannel port and wait for it to open.
 *
 * @param channel The RTCDataChannel to wrap
 * @returns Promise resolving to DataChannelPort when channel is open
 */
export async function createDataChannelPortAsync(
  channel: RTCDataChannel,
): Promise<DataChannelPort> {
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
