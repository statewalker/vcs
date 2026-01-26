/**
 * MessagePack TypeScript Implementation
 *
 * A pure TypeScript implementation of the MessagePack serialization format.
 *
 * Specification: https://github.com/msgpack/msgpack/blob/master/spec.md
 * Based on: https://github.com/cuzic/MessagePack-JS
 *
 * @example
 * ```typescript
 * import { pack, unpack } from "@statewalker/vcs-utils/msgpack";
 *
 * // Encode
 * const packed = pack({ hello: "world", num: 42 });
 *
 * // Decode
 * const unpacked = unpack(packed);
 * console.log(unpacked); // { hello: "world", num: 42 }
 * ```
 *
 * @module
 */

export { Decoder } from "./decoder.js";
export { Encoder } from "./encoder.js";
export {
  CharSet,
  type DecoderOptions,
  type EncoderOptions,
  FixedRange,
  Format,
  type MessagePackValue,
} from "./types.js";

import { Decoder } from "./decoder.js";
import { Encoder } from "./encoder.js";
import type { DecoderOptions, EncoderOptions, MessagePackValue } from "./types.js";

/**
 * Encode a value to MessagePack format
 * @param value - Value to encode
 * @param options - Encoder options
 * @returns Uint8Array containing the encoded data
 */
export function pack(value: MessagePackValue, options?: EncoderOptions): Uint8Array {
  const encoder = new Encoder(options);
  return encoder.pack(value);
}

/**
 * Decode MessagePack data
 * @param data - Binary data to decode (Uint8Array or string)
 * @param options - Decoder options
 * @returns Decoded value
 */
export function unpack(data: Uint8Array | string, options?: DecoderOptions): MessagePackValue {
  const decoder = new Decoder(data, options);
  return decoder.unpack();
}

/**
 * Encode a value to a string (for compatibility with original implementation)
 * @param value - Value to encode
 * @param options - Encoder options
 * @returns String where each character represents a byte
 */
export function packToString(value: MessagePackValue, options?: EncoderOptions): string {
  const encoder = new Encoder(options);
  return encoder.packToString(value);
}
