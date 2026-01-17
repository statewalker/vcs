/**
 * MessagePort-based binary stream with ACK-based backpressure.
 *
 * This module provides bidirectional streaming over MessagePort with proper
 * flow control. Each sent block requires acknowledgment from the receiver
 * before the next block is sent, preventing memory exhaustion when the
 * receiver is slower than the sender.
 *
 * Based on principles from @statewalker/webrun-ports library.
 *
 * @example
 * ```typescript
 * // Create a channel
 * const channel = new MessageChannel();
 *
 * // Sender side
 * const sender = createPortSender(channel.port1);
 * await sender.send(dataStream);
 *
 * // Receiver side
 * const receiver = createPortReceiver(channel.port2);
 * for await (const block of receiver.receive()) {
 *   await processBlock(block);
 * }
 * ```
 */

import { newAsyncGenerator } from "./new-async-generator.js";

/**
 * Message types for the protocol.
 */
interface DataMessage {
	type: "data";
	id: number;
	block: ArrayBuffer;
}

interface AckMessage {
	type: "ack";
	id: number;
	handled: boolean;
}

interface EndMessage {
	type: "end";
}

interface ErrorMessage {
	type: "error";
	message: string;
}

type Message = DataMessage | AckMessage | EndMessage | ErrorMessage;

/**
 * Options for port stream operations.
 */
export interface PortStreamOptions {
	/** Timeout for ACK response in milliseconds (default: 30000) */
	ackTimeout?: number;
}

const DEFAULT_ACK_TIMEOUT = 30000;

/**
 * Send a binary stream over MessagePort with ACK-based backpressure.
 *
 * Each block is sent and waits for acknowledgment before sending the next.
 * This ensures the receiver controls the flow rate.
 *
 * @param port MessagePort to send over
 * @param stream Binary stream to send
 * @param options Configuration options
 * @throws Error if receiver closes or ACK timeout occurs
 */
export async function sendPortStream(
	port: MessagePort,
	stream: AsyncIterable<Uint8Array>,
	options: PortStreamOptions = {},
): Promise<void> {
	const { ackTimeout = DEFAULT_ACK_TIMEOUT } = options;

	let blockId = 0;
	let currentTimer: ReturnType<typeof setTimeout> | null = null;
	let currentResolve: ((handled: boolean) => void) | null = null;

	// Handle ACK messages
	const handleMessage = (event: MessageEvent<Message>) => {
		const msg = event.data;
		if (msg?.type === "ack" && currentResolve) {
			if (currentTimer) {
				clearTimeout(currentTimer);
				currentTimer = null;
			}
			const resolve = currentResolve;
			currentResolve = null;
			resolve(msg.handled);
		}
	};

	port.addEventListener("message", handleMessage);
	port.start();

	try {
		for await (const block of stream) {
			const id = blockId++;

			// Send block and wait for ACK
			const handled = await new Promise<boolean>((resolve, reject) => {
				currentTimer = setTimeout(() => {
					currentTimer = null;
					currentResolve = null;
					reject(new Error(`ACK timeout for block ${id}`));
				}, ackTimeout);

				currentResolve = resolve;

				// Transfer the buffer for efficiency
				const buffer = block.buffer.slice(
					block.byteOffset,
					block.byteOffset + block.byteLength,
				) as ArrayBuffer;
				port.postMessage({ type: "data", id, block: buffer }, [buffer]);
			});

			if (!handled) {
				throw new Error("Receiver closed the stream");
			}
		}

		// Signal completion
		port.postMessage({ type: "end" } as EndMessage);
	} catch (error) {
		// Signal error to receiver
		port.postMessage({
			type: "error",
			message: error instanceof Error ? error.message : String(error),
		} as ErrorMessage);
		throw error;
	} finally {
		port.removeEventListener("message", handleMessage);
		if (currentTimer) {
			clearTimeout(currentTimer);
		}
	}
}

/**
 * Receive a binary stream from MessagePort with ACK-based backpressure.
 *
 * Uses newAsyncGenerator to create proper backpressure - the sender only
 * receives ACK after the consumer processes each block.
 *
 * @param port MessagePort to receive from
 * @returns AsyncIterable yielding received binary blocks
 */
export function receivePortStream(
	port: MessagePort,
): AsyncIterable<Uint8Array> {
	return newAsyncGenerator<Uint8Array>((next, done) => {
		const handleMessage = async (event: MessageEvent<Message>) => {
			const msg = event.data;
			if (!msg) return;

			switch (msg.type) {
				case "data": {
					// Wait for consumer to process before sending ACK
					// This is the key to backpressure - sender blocks until ACK
					const handled = await next(new Uint8Array(msg.block));
					port.postMessage({ type: "ack", id: msg.id, handled } as AckMessage);
					break;
				}
				case "end": {
					await done();
					break;
				}
				case "error": {
					await done(new Error(msg.message));
					break;
				}
			}
		};

		port.addEventListener("message", handleMessage);
		port.start();

		// Cleanup function
		return () => {
			port.removeEventListener("message", handleMessage);
		};
	});
}

/**
 * Bidirectional port stream for request/response patterns.
 *
 * Combines sending and receiving capabilities over a single port.
 */
export interface PortStream {
	/**
	 * Send a binary stream to the peer.
	 * Blocks until each chunk is acknowledged.
	 */
	send(stream: AsyncIterable<Uint8Array>): Promise<void>;

	/**
	 * Receive a binary stream from the peer.
	 * Returns an async iterable with proper backpressure.
	 */
	receive(): AsyncIterable<Uint8Array>;

	/**
	 * Close the port and cleanup resources.
	 */
	close(): void;
}

/**
 * Create a bidirectional stream over a MessagePort.
 *
 * @param port MessagePort for communication
 * @param options Configuration options
 * @returns PortStream interface for bidirectional communication
 */
export function createPortStream(
	port: MessagePort,
	options: PortStreamOptions = {},
): PortStream {
	return {
		send: (stream) => sendPortStream(port, stream, options),
		receive: () => receivePortStream(port),
		close: () => port.close(),
	};
}

/**
 * Create a pair of connected PortStreams for testing or in-process communication.
 *
 * @param options Configuration options
 * @returns Tuple of two connected PortStream instances
 */
export function createPortStreamPair(
	options: PortStreamOptions = {},
): [PortStream, PortStream] {
	const channel = new MessageChannel();
	return [
		createPortStream(channel.port1, options),
		createPortStream(channel.port2, options),
	];
}
