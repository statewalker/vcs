/**
 * BidirectionalSocket implementation using MessagePort adapters.
 *
 * @deprecated Use the MessagePort adapters directly (createMessagePortReader,
 * createMessagePortWriter, createMessagePortCloser) instead of BidirectionalSocket.
 * This module is maintained for backward compatibility.
 */

import {
  createMessagePortCloser,
  createMessagePortPair,
  createMessagePortReader,
  createMessagePortWriter,
} from "./messageport-adapters.js";
import type { BidirectionalSocket } from "./types.js";

export interface BidirectionalSocketPortsOptions {
  /** Optional channel name (unused, kept for API compatibility) */
  channelName?: string;
  /** Timeout in milliseconds (unused, kept for API compatibility) */
  timeout?: number;
}

/**
 * Create a BidirectionalSocket from a MessagePort.
 *
 * @deprecated Use createMessagePortReader, createMessagePortWriter, and
 * createMessagePortCloser directly instead.
 *
 * @param port - The MessagePort for communication.
 * @param _useCallBidi - Unused, kept for API compatibility.
 * @param _options - Unused, kept for API compatibility.
 * @returns A BidirectionalSocket instance.
 */
export function createBidirectionalSocketPorts(
  port: MessagePort,
  _useCallBidi?: boolean,
  _options?: BidirectionalSocketPortsOptions,
): BidirectionalSocket {
  const input = createMessagePortReader(port);
  const write = createMessagePortWriter(port);
  const close = createMessagePortCloser(port, input);

  return {
    input,
    async write(data: Uint8Array): Promise<void> {
      await write(data);
    },
    async close(): Promise<void> {
      await close();
    },
  };
}

/**
 * Create a pair of connected BidirectionalSockets using MessageChannel.
 *
 * @deprecated Use createMessagePortPair and create sockets directly instead.
 *
 * @param options - Configuration options (unused).
 * @returns A tuple of two connected BidirectionalSocket instances.
 */
export function createBidirectionalSocketPairPorts(
  _options?: BidirectionalSocketPortsOptions,
): [BidirectionalSocket, BidirectionalSocket] {
  const [port1, port2] = createMessagePortPair();

  const socketA = createBidirectionalSocketPorts(port1);
  const socketB = createBidirectionalSocketPorts(port2);

  return [socketA, socketB];
}
