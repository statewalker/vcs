/**
 * MessagePortLike interfaces for universal transport abstraction.
 *
 * These interfaces align with the standard MessagePort API to provide
 * a familiar and interoperable abstraction for various transport types.
 */

/**
 * Universal message port interface aligned with the standard MessagePort API.
 * Supports binary data transfer via ArrayBuffer/Uint8Array.
 *
 * This is the minimal interface that all transports must implement.
 */
export interface MessagePortLike {
  /**
   * Post a message to the remote endpoint.
   * Data must be ArrayBuffer or Uint8Array for binary transport.
   */
  postMessage(data: ArrayBuffer | Uint8Array): void;

  /**
   * Handler for incoming messages.
   * Event data will be ArrayBuffer for binary transports.
   */
  onmessage: ((event: MessageEvent<ArrayBuffer>) => void) | null;

  /**
   * Handler for message deserialization errors.
   */
  onmessageerror: ((event: MessageEvent) => void) | null;

  /**
   * Close the port and release resources.
   */
  close(): void;

  /**
   * Start receiving messages.
   * Required by MessagePort spec; may be no-op for some transports.
   */
  start(): void;
}

/**
 * Extended MessagePortLike with connection state and backpressure support.
 * Use this for transports that need flow control (WebSocket, WebRTC, PeerJS).
 */
export interface MessagePortLikeExtended extends MessagePortLike {
  /**
   * Handler for connection close events.
   */
  onclose: (() => void) | null;

  /**
   * Handler for connection errors.
   */
  onerror: ((error: Error) => void) | null;

  /**
   * Current buffered amount in bytes (for backpressure).
   * Returns 0 if not supported by the transport.
   */
  readonly bufferedAmount: number;

  /**
   * Whether the port is currently open and ready for communication.
   */
  readonly isOpen: boolean;
}
