import { afterEach, describe, expect, it } from "vitest";
import {
	createPortStream,
	createPortStreamPair,
	receivePortStream,
	sendPortStream,
	type PortStream,
} from "../../src/streams/port-stream";

// Track created resources for cleanup
const channels: MessageChannel[] = [];
const ports: PortStream[] = [];

function createChannel(): MessageChannel {
	const channel = new MessageChannel();
	channels.push(channel);
	return channel;
}

function createPair(): [PortStream, PortStream] {
	const [a, b] = createPortStreamPair();
	ports.push(a, b);
	return [a, b];
}

afterEach(() => {
	for (const channel of channels) {
		channel.port1.close();
		channel.port2.close();
	}
	channels.length = 0;

	for (const port of ports) {
		port.close();
	}
	ports.length = 0;
});

describe("sendPortStream() and receivePortStream()", () => {
	// Helper to create Uint8Array from numbers
	function bytes(...values: number[]): Uint8Array {
		return new Uint8Array(values);
	}

	// Helper to collect all chunks
	async function collect(
		stream: AsyncIterable<Uint8Array>,
	): Promise<Uint8Array[]> {
		const result: Uint8Array[] = [];
		for await (const chunk of stream) {
			result.push(chunk);
		}
		return result;
	}

	// =============================================================================
	// Basic functionality
	// =============================================================================

	it("should send and receive empty stream", async () => {
		const channel = createChannel();

		const sendPromise = sendPortStream(channel.port1, []);
		const received = await collect(receivePortStream(channel.port2));

		await sendPromise;
		expect(received).toEqual([]);
	});

	it("should send and receive single block", async () => {
		const channel = createChannel();

		async function* input(): AsyncGenerator<Uint8Array> {
			yield bytes(1, 2, 3, 4, 5);
		}

		const sendPromise = sendPortStream(channel.port1, input());
		const received = await collect(receivePortStream(channel.port2));

		await sendPromise;
		expect(received).toHaveLength(1);
		expect(received[0]).toEqual(bytes(1, 2, 3, 4, 5));
	});

	it("should send and receive multiple blocks", async () => {
		const channel = createChannel();

		async function* input(): AsyncGenerator<Uint8Array> {
			yield bytes(1, 2);
			yield bytes(3, 4);
			yield bytes(5);
		}

		const sendPromise = sendPortStream(channel.port1, input());
		const received = await collect(receivePortStream(channel.port2));

		await sendPromise;
		expect(received).toHaveLength(3);
		expect(received[0]).toEqual(bytes(1, 2));
		expect(received[1]).toEqual(bytes(3, 4));
		expect(received[2]).toEqual(bytes(5));
	});

	// =============================================================================
	// Backpressure
	// =============================================================================

	it("should implement backpressure - sender waits for receiver", async () => {
		const channel = createChannel();
		const sendOrder: string[] = [];
		const receiveOrder: string[] = [];

		async function* input(): AsyncGenerator<Uint8Array> {
			sendOrder.push("send-1");
			yield bytes(1);
			sendOrder.push("send-2");
			yield bytes(2);
			sendOrder.push("send-3");
			yield bytes(3);
			sendOrder.push("done");
		}

		const sendPromise = sendPortStream(channel.port1, input());

		// Receive with delays
		for await (const chunk of receivePortStream(channel.port2)) {
			receiveOrder.push(`recv-${chunk[0]}`);
			await new Promise((r) => setTimeout(r, 10));
		}

		await sendPromise;

		// With backpressure, send should interleave with receive
		// Each send waits for ACK before next send
		expect(sendOrder).toEqual(["send-1", "send-2", "send-3", "done"]);
		expect(receiveOrder).toEqual(["recv-1", "recv-2", "recv-3"]);
	});

	// =============================================================================
	// Error handling
	// =============================================================================

	it("should propagate error from sender to receiver", async () => {
		const channel = createChannel();
		const testError = new Error("Test sender error");

		async function* input(): AsyncGenerator<Uint8Array> {
			yield bytes(1);
			throw testError;
		}

		// Start sending - catch rejection immediately to prevent unhandled rejection
		let sendError: Error | undefined;
		const sendPromise = sendPortStream(channel.port1, input()).catch((err) => {
			sendError = err;
		});

		const received: Uint8Array[] = [];
		let caughtError: Error | undefined;

		try {
			for await (const chunk of receivePortStream(channel.port2)) {
				received.push(chunk);
			}
		} catch (err) {
			caughtError = err as Error;
		}

		await sendPromise;
		expect(sendError?.message).toBe("Test sender error");
		expect(received).toHaveLength(1);
		expect(caughtError?.message).toBe("Test sender error");
	});

	// =============================================================================
	// PortStream interface
	// =============================================================================

	it("should work with createPortStream", async () => {
		const channel = createChannel();
		const stream1 = createPortStream(channel.port1);
		const stream2 = createPortStream(channel.port2);
		ports.push(stream1, stream2);

		async function* input(): AsyncGenerator<Uint8Array> {
			yield bytes(1, 2, 3);
			yield bytes(4, 5);
		}

		const sendPromise = stream1.send(input());
		const received = await collect(stream2.receive());

		await sendPromise;
		expect(received).toHaveLength(2);
		expect(received[0]).toEqual(bytes(1, 2, 3));
		expect(received[1]).toEqual(bytes(4, 5));
	});

	it("should work with createPortStreamPair", async () => {
		const [stream1, stream2] = createPair();

		async function* input(): AsyncGenerator<Uint8Array> {
			yield bytes(10, 20);
			yield bytes(30);
		}

		const sendPromise = stream1.send(input());
		const received = await collect(stream2.receive());

		await sendPromise;
		expect(received).toHaveLength(2);
		expect(received[0]).toEqual(bytes(10, 20));
		expect(received[1]).toEqual(bytes(30));
	});

	// =============================================================================
	// Data integrity
	// =============================================================================

	it("should preserve large data blocks", async () => {
		const channel = createChannel();
		const largeBlock = new Uint8Array(64 * 1024);
		for (let i = 0; i < largeBlock.length; i++) {
			largeBlock[i] = i % 256;
		}

		async function* input(): AsyncGenerator<Uint8Array> {
			yield largeBlock;
		}

		const sendPromise = sendPortStream(channel.port1, input());
		const received = await collect(receivePortStream(channel.port2));

		await sendPromise;
		expect(received).toHaveLength(1);
		expect(received[0].length).toBe(largeBlock.length);
		expect(received[0]).toEqual(largeBlock);
	});

	it("should handle many small blocks", async () => {
		const channel = createChannel();
		const blockCount = 100;

		async function* input(): AsyncGenerator<Uint8Array> {
			for (let i = 0; i < blockCount; i++) {
				yield bytes(i % 256);
			}
		}

		const sendPromise = sendPortStream(channel.port1, input());
		const received = await collect(receivePortStream(channel.port2));

		await sendPromise;
		expect(received).toHaveLength(blockCount);
		for (let i = 0; i < blockCount; i++) {
			expect(received[i]).toEqual(bytes(i % 256));
		}
	});

	// =============================================================================
	// ACK timeout (with short timeout for testing)
	// =============================================================================

	it("should timeout if receiver does not acknowledge", async () => {
		const channel = createChannel();

		// Don't set up a receiver, just let messages go unacknowledged
		// Use very short timeout
		async function* input(): AsyncGenerator<Uint8Array> {
			yield bytes(1, 2, 3);
		}

		const sendPromise = sendPortStream(channel.port1, input(), {
			ackTimeout: 50,
		});

		// Should timeout because no receiver
		await expect(sendPromise).rejects.toThrow(/ACK timeout/);
	});
});
