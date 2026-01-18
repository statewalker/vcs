/**
 * WebRTC DataChannel to TransportConnection adapter.
 *
 * Adapts a WebRTC RTCDataChannel to implement the TransportConnection
 * interface for Git protocol communication over peer-to-peer connections.
 *
 * This module provides both the new MessagePortLike-based approach
 * (via createDataChannelPort + createMessagePortStream) and the legacy
 * WebRtcStream class for backwards compatibility.
 *
 * Features:
 * - Bidirectional packet streaming over DataChannel
 * - Proper message framing for binary data
 * - Backpressure handling via bufferedAmount
 * - Clean resource cleanup
 */

import {
  MessagePortStream,
  type MessagePortStreamOptions,
  type TransportConnection,
} from "@statewalker/vcs-transport";
import { createDataChannelPort } from "./datachannel-port.js";

/**
 * Options for creating a WebRTC stream.
 */
export interface WebRtcStreamOptions extends MessagePortStreamOptions {}

/**
 * Adapter that wraps RTCDataChannel as a TransportConnection.
 *
 * The DataChannel must be open before use. Messages are sent/received
 * as binary ArrayBuffers, which are then framed using pkt-line protocol.
 *
 * @deprecated Use `createDataChannelPort` + `createMessagePortStream` instead
 * for the new MessagePortLike-based approach.
 */
export class WebRtcStream implements TransportConnection {
  private readonly stream: MessagePortStream;
  private readonly channel: RTCDataChannel;

  constructor(channel: RTCDataChannel, options: WebRtcStreamOptions = {}) {
    this.channel = channel;
    const port = createDataChannelPort(channel);
    this.stream = new MessagePortStream(port, options);
  }

  send(packets: AsyncIterable<import("@statewalker/vcs-transport").Packet>): Promise<void> {
    return this.stream.send(packets);
  }

  sendRaw(body: Uint8Array): Promise<void> {
    return this.stream.sendRaw(body);
  }

  receive(): AsyncIterable<import("@statewalker/vcs-transport").Packet> {
    return this.stream.receive();
  }

  close(): Promise<void> {
    return this.stream.close();
  }

  get isClosed(): boolean {
    return this.stream.isClosed;
  }

  get bufferedAmount(): number {
    return this.channel.bufferedAmount;
  }

  get readyState(): RTCDataChannelState {
    return this.channel.readyState;
  }
}

/**
 * Create a TransportConnection from an RTCDataChannel.
 *
 * The channel must already be open or opening.
 *
 * @param channel The RTCDataChannel to wrap
 * @param options Configuration options
 * @returns TransportConnection adapter
 */
export function createWebRtcStream(
  channel: RTCDataChannel,
  options?: WebRtcStreamOptions,
): TransportConnection {
  return new WebRtcStream(channel, options);
}
