/**
 * MessagePack TypeScript Types
 *
 * Based on the MessagePack specification:
 * https://github.com/msgpack/msgpack/blob/master/spec.md
 *
 * Original JS implementation by cuzic:
 * https://github.com/cuzic/MessagePack-JS
 */

/**
 * Types that can be serialized/deserialized by MessagePack
 */
export type MessagePackValue =
  | null
  | undefined
  | boolean
  | number
  | string
  | Uint8Array
  | MessagePackValue[]
  | { [key: string]: MessagePackValue };

/**
 * Character set options for decoding raw data
 */
export enum CharSet {
  /** UTF-8 encoded strings (default) */
  UTF8 = 0,
  /** ASCII 8-bit strings */
  ASCII = 1,
  /** UTF-16 encoded strings (not yet implemented) */
  UTF16 = 2,
  /** Return raw byte arrays instead of strings */
  ByteArray = -1,
}

/**
 * Options for the decoder
 */
export interface DecoderOptions {
  /** Character set to use when decoding raw data */
  charSet?: CharSet | "utf-8" | "ascii" | "utf16" | "byte-array";
}

/**
 * Options for the encoder
 */
export interface EncoderOptions {
  /** Whether to encode strings as UTF-8 bytes (default: true) */
  utf8Strings?: boolean;
}

/**
 * MessagePack format bytes (first byte markers)
 */
export const Format = {
  // Nil, Boolean
  NIL: 0xc0,
  NEVER_USED: 0xc1, // This byte is never used in MessagePack
  FALSE: 0xc2,
  TRUE: 0xc3,

  // Binary (raw bytes)
  BIN8: 0xc4,
  BIN16: 0xc5,
  BIN32: 0xc6,

  // Extension
  EXT8: 0xc7,
  EXT16: 0xc8,
  EXT32: 0xc9,

  // Float
  FLOAT32: 0xca,
  FLOAT64: 0xcb,

  // Unsigned integers
  UINT8: 0xcc,
  UINT16: 0xcd,
  UINT32: 0xce,
  UINT64: 0xcf,

  // Signed integers
  INT8: 0xd0,
  INT16: 0xd1,
  INT32: 0xd2,
  INT64: 0xd3,

  // Fixed extension
  FIXEXT1: 0xd4,
  FIXEXT2: 0xd5,
  FIXEXT4: 0xd6,
  FIXEXT8: 0xd7,
  FIXEXT16: 0xd8,

  // String (raw in old spec)
  STR8: 0xd9,
  STR16: 0xda,
  STR32: 0xdb,

  // Array
  ARRAY16: 0xdc,
  ARRAY32: 0xdd,

  // Map
  MAP16: 0xde,
  MAP32: 0xdf,
} as const;

/**
 * Fixed format ranges
 */
export const FixedRange = {
  // Positive fixint: 0x00 - 0x7f (0 to 127)
  POSITIVE_FIXINT_MAX: 0x7f,

  // Fixmap: 0x80 - 0x8f (0 to 15 elements)
  FIXMAP_PREFIX: 0x80,
  FIXMAP_MAX: 0x8f,

  // Fixarray: 0x90 - 0x9f (0 to 15 elements)
  FIXARRAY_PREFIX: 0x90,
  FIXARRAY_MAX: 0x9f,

  // Fixstr: 0xa0 - 0xbf (0 to 31 bytes)
  FIXSTR_PREFIX: 0xa0,
  FIXSTR_MAX: 0xbf,

  // Negative fixint: 0xe0 - 0xff (-32 to -1)
  NEGATIVE_FIXINT_PREFIX: 0xe0,
} as const;
