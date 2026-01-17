/**
 * Pack serialization/deserialization for transport over MessagePort.
 *
 * This module provides utilities to serialize git protocol packets into
 * fixed-size binary blocks suitable for transport with backpressure,
 * and to deserialize them back on the receiving end.
 *
 * ## Architecture
 *
 * The transport layer converts between high-level git protocol packets
 * and low-level binary blocks optimized for network transmission:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      Application Layer                         │
 * │  Packet stream: want, have, ACK, NAK, pack data, etc.          │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                    serializePacks() / deserializePacks()
 *                              │
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      Transport Layer                           │
 * │  Fixed-size binary blocks (128KB default) with ACK flow ctrl   │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                    sendPortStream() / receivePortStream()
 *                              │
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      MessagePort Layer                         │
 * │  postMessage() with transferable ArrayBuffers                  │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * ## Serialization Process
 *
 * 1. **Packets → pkt-line binary**: Each packet is encoded with 4-byte
 *    hex length prefix per git protocol specification
 * 2. **Binary → Fixed blocks**: Stream is chunked into predictable
 *    block sizes for efficient transmission and memory management
 *
 * ## Deserialization Process
 *
 * 1. **Fixed blocks → Binary stream**: Blocks are concatenated
 *    (pktLineReader handles buffering internally)
 * 2. **Binary → Packets**: pkt-line format is parsed to extract packets
 *
 * ## Backpressure Flow Control
 *
 * When combined with `sendPortStream()`/`receivePortStream()` from
 * `@statewalker/vcs-utils`, the transport implements ACK-based flow
 * control:
 *
 * 1. Sender sends a block and waits for ACK
 * 2. Receiver processes block and sends ACK when ready for next
 * 3. This prevents memory exhaustion when receiver is slower
 *
 * ## Integration with MessagePort
 *
 * @example
 * ```typescript
 * import { createPortStreamPair } from "@statewalker/vcs-utils";
 * import { serializePacks, deserializePacks } from "@statewalker/vcs-transport";
 *
 * // Create connected port pair
 * const [port1, port2] = createPortStreamPair();
 *
 * // Sender side: packets → blocks → port
 * async function send(packets: AsyncIterable<Packet>) {
 *   const blocks = serializePacks(packets);
 *   await port1.send(blocks);
 * }
 *
 * // Receiver side: port → blocks → packets
 * async function* receive(): AsyncGenerator<Packet> {
 *   const blocks = port2.receive();
 *   yield* deserializePacks(blocks);
 * }
 * ```
 *
 * ## Block Size Considerations
 *
 * The default block size of 128KB balances:
 * - **Backpressure granularity**: Smaller blocks = finer control
 * - **Throughput**: Larger blocks = fewer ACK round-trips
 * - **Memory usage**: Block size × queue depth = memory consumption
 *
 * For high-latency connections, larger blocks reduce ACK overhead.
 * For memory-constrained environments, smaller blocks limit buffering.
 */

import { toChunks } from "@statewalker/vcs-utils";
import { pktLineReader, pktLineWriter } from "../protocol/pkt-line-codec.js";
import type { Packet } from "../protocol/types.js";

/**
 * Default block size for chunked transport (128KB).
 * This provides a good balance between:
 * - Small enough for backpressure to be effective
 * - Large enough to minimize overhead from ACK round-trips
 */
export const DEFAULT_BLOCK_SIZE = 128 * 1024;

/**
 * Options for pack serialization.
 */
export interface SerializeOptions {
	/** Block size in bytes for chunking (default: 128KB) */
	blockSize?: number;
}

/**
 * Serialize packets into fixed-size binary blocks.
 *
 * This function:
 * 1. Encodes packets to pkt-line binary format
 * 2. Chunks the binary stream into fixed-size blocks
 *
 * Each block is exactly `blockSize` bytes, except possibly the last
 * block which may be smaller.
 *
 * @param packets Stream of packets to serialize
 * @param options Serialization options
 * @returns AsyncGenerator yielding fixed-size binary blocks
 */
export async function* serializePacks(
	packets: AsyncIterable<Packet>,
	options: SerializeOptions = {},
): AsyncGenerator<Uint8Array> {
	const { blockSize = DEFAULT_BLOCK_SIZE } = options;

	// Encode packets to pkt-line binary format
	const binaryStream = pktLineWriter(packets);

	// Chunk into fixed-size blocks for transport
	yield* toChunks(binaryStream, blockSize);
}

/**
 * Deserialize binary blocks back into packets.
 *
 * This function:
 * 1. Reassembles chunked binary blocks into a continuous stream
 * 2. Parses pkt-line format to extract packets
 *
 * @param blocks Stream of binary blocks to deserialize
 * @returns AsyncGenerator yielding packets
 */
export async function* deserializePacks(
	blocks: AsyncIterable<Uint8Array>,
): AsyncGenerator<Packet> {
	// Parse pkt-line packets from the binary stream
	// (pktLineReader handles buffering and partial packets internally)
	yield* pktLineReader(blocks);
}

/**
 * Create a bidirectional packet transport over a binary stream.
 *
 * This is a higher-level utility that combines serialization and
 * deserialization for bidirectional communication.
 *
 * @example
 * ```typescript
 * const transport = createPacketTransport(128 * 1024);
 *
 * // Send packets
 * const blocks = transport.serialize(outgoingPackets);
 *
 * // Receive packets
 * const packets = transport.deserialize(incomingBlocks);
 * ```
 */
export interface PacketTransport {
	/**
	 * Serialize packets into fixed-size blocks.
	 */
	serialize(packets: AsyncIterable<Packet>): AsyncGenerator<Uint8Array>;

	/**
	 * Deserialize blocks back into packets.
	 */
	deserialize(blocks: AsyncIterable<Uint8Array>): AsyncGenerator<Packet>;
}

/**
 * Create a packet transport with the specified block size.
 *
 * @param blockSize Block size for chunking (default: 128KB)
 */
export function createPacketTransport(
	blockSize: number = DEFAULT_BLOCK_SIZE,
): PacketTransport {
	return {
		serialize: (packets) => serializePacks(packets, { blockSize }),
		deserialize: (blocks) => deserializePacks(blocks),
	};
}
