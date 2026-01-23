/**
 * Socket transport types.
 */

/**
 * Bidirectional socket interface for symmetric communication.
 *
 * This interface abstracts the underlying transport mechanism (MessagePort,
 * WebRTC DataChannel, WebSocket, etc.) providing a simple read/write/close API.
 */
export interface BidirectionalSocket {
  /** Read data from the remote endpoint */
  input: AsyncGenerator<Uint8Array>;

  /** Write data to the remote endpoint */
  write(data: Uint8Array): Promise<void>;

  /** Close the socket */
  close(): Promise<void>;
}

/**
 * Options for creating a BidirectionalSocket.
 */
export interface BidirectionalSocketOptions {
  /** Byte threshold for ACK-based backpressure (default: 64KB) */
  chunkSize?: number;

  /** Timeout for ACK response in milliseconds (default: 5000) */
  ackTimeout?: number;
}
