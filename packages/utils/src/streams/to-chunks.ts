/**
 * Chunks a binary stream into fixed-size blocks.
 *
 * This utility takes an input stream of arbitrary-sized Uint8Array chunks
 * and yields fixed-size blocks. The final block may be smaller than the
 * specified size if the total stream length is not evenly divisible.
 *
 * Useful for:
 * - Network transport with fixed packet sizes
 * - Flow control with block-level acknowledgment
 * - Memory-efficient processing of large streams
 *
 * @example
 * ```typescript
 * // Chunk a stream into 128KB blocks
 * const blocks = toChunks(inputStream, 128 * 1024);
 * for await (const block of blocks) {
 *   await sendBlock(block); // Each block is exactly 128KB (except possibly last)
 * }
 * ```
 *
 * @param stream Input binary stream (sync or async iterable)
 * @param size Block size in bytes (default: 128KB)
 * @returns AsyncGenerator yielding fixed-size Uint8Array blocks
 */
export async function* toChunks(
	stream: Iterable<Uint8Array> | AsyncIterable<Uint8Array>,
	size: number = 128 * 1024,
): AsyncGenerator<Uint8Array> {
	let buffer: Uint8Array = new Uint8Array(0);

	for await (const chunk of stream) {
		// Append incoming chunk to buffer
		buffer = concatBytes(buffer, chunk);

		// Yield complete blocks
		while (buffer.length >= size) {
			yield buffer.slice(0, size);
			buffer = buffer.slice(size);
		}
	}

	// Yield any remaining data as final (possibly smaller) block
	if (buffer.length > 0) {
		yield buffer;
	}
}

/**
 * Concatenate multiple Uint8Arrays efficiently.
 */
function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
	if (a.length === 0) return b;
	if (b.length === 0) return a;

	const result = new Uint8Array(a.length + b.length);
	result.set(a, 0);
	result.set(b, a.length);
	return result;
}
