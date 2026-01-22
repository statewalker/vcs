/**
 * RTCDataChannel adapter returning standard MessagePort.
 *
 * Bridges an RTCDataChannel to a MessagePort using the MessageChannel pattern,
 * enabling use with any code that expects standard MessagePort interface.
 */

/**
 * Normalize data to Uint8Array for MessagePort transport.
 */
function normalizeToUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  // Fallback: encode as UTF-8
  return new TextEncoder().encode(String(data));
}

/**
 * Create a MessagePort that bridges to an RTCDataChannel.
 *
 * The channel must be in "open" state or opening.
 *
 * This uses the MessageChannel bridge pattern:
 * - Creates a MessageChannel to get port1 and port2
 * - Returns port1 to the caller (standard MessagePort)
 * - Internally connects port2 to the RTCDataChannel
 *
 * @param channel - The RTCDataChannel to wrap
 * @returns A standard MessagePort that bridges to the channel
 */
export function createDataChannelPort(channel: RTCDataChannel): MessagePort {
  const { port1, port2 } = new MessageChannel();

  // Configure channel for binary data
  channel.binaryType = "arraybuffer";

  // port2 → RTCDataChannel: forward messages to DataChannel
  port2.onmessage = (e: MessageEvent) => {
    if (channel.readyState !== "open") return;
    // Convert to ArrayBuffer for RTCDataChannel.send()
    const uint8 = e.data instanceof Uint8Array ? e.data : normalizeToUint8Array(e.data);
    const buffer =
      uint8.byteOffset === 0 && uint8.byteLength === uint8.buffer.byteLength
        ? (uint8.buffer as ArrayBuffer)
        : (uint8.buffer.slice(
            uint8.byteOffset,
            uint8.byteOffset + uint8.byteLength,
          ) as ArrayBuffer);
    channel.send(buffer);
  };

  // RTCDataChannel → port2: forward incoming data to the MessagePort
  channel.onmessage = (e: MessageEvent) => {
    const uint8 = normalizeToUint8Array(e.data);
    // Copy the data to avoid issues with detached buffers
    const copy = new Uint8Array(uint8);
    port2.postMessage(copy);
  };

  // Close port2 when channel closes to signal to port1 consumers
  channel.onclose = () => {
    // Send null to signal end of stream (convention used by messageport-adapters)
    try {
      port2.postMessage(null);
    } catch {
      // Ignore if already closed
    }
    port2.close();
  };

  // Start receiving messages on port2
  port2.start();

  return port1;
}

/**
 * Create a MessagePort and wait for the RTCDataChannel to open.
 *
 * @param channel - The RTCDataChannel to wrap
 * @returns Promise resolving to MessagePort when channel is open
 */
export async function createDataChannelPortAsync(channel: RTCDataChannel): Promise<MessagePort> {
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
