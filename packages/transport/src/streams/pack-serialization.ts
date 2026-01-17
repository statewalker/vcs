/**
 * Pack serialization/deserialization for transport over MessagePort.
 *
 * This module provides utilities to serialize git protocol packets into
 * fixed-size binary blocks suitable for transport with backpressure,
 * and to deserialize them back on the receiving end.
 *
 * The serialization process:
 * 1. Packets (pkt-line) -> Binary stream (via pktLineWriter)
 * 2. Binary stream -> Fixed-size blocks (via toChunks)
 *
 * The deserialization process:
 * 1. Fixed-size blocks -> Binary stream (via concat)
 * 2. Binary stream -> Packets (via pktLineReader)
 *
 * This enables efficient transport over MessagePort with ACK-based
 * backpressure, preventing memory exhaustion when the receiver is
 * slower than the sender.
 *
 * @example
 * ```typescript
 * // Sender side
 * const packets = createPacketStream();
 * for await (const block of serializePacks(packets)) {
 *   await sendOverPort(block);
 * }
 *
 * // Receiver side
 * const receivedBlocks = receiveFromPort();
 * for await (const packet of deserializePacks(receivedBlocks)) {
 *   await processPacket(packet);
 * }
 * ```
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
