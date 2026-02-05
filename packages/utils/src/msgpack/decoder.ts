/**
 * MessagePack Decoder
 *
 * Decodes MessagePack binary data into JavaScript values.
 *
 * Based on the MessagePack specification:
 * https://github.com/msgpack/msgpack/blob/master/spec.md
 *
 * Original JS implementation by cuzic:
 * https://github.com/cuzic/MessagePack-JS
 */

import {
  CharSet,
  type DecoderOptions,
  FixedRange,
  Format,
  type MessagePackValue,
} from "./types.js";

/**
 * Decoder for MessagePack binary data
 */
export class Decoder {
  private data: Uint8Array;
  private index = 0;
  private charSet: CharSet;

  /**
   * Create a new decoder
   * @param data - Binary data to decode (Uint8Array or string)
   * @param options - Decoder options
   */
  constructor(data: Uint8Array | string, options: DecoderOptions = {}) {
    if (typeof data === "string") {
      // Convert string to Uint8Array (each char code becomes a byte)
      const bytes = new Uint8Array(data.length);
      for (let i = 0; i < data.length; i++) {
        bytes[i] = data.charCodeAt(i) & 0xff;
      }
      this.data = bytes;
    } else {
      this.data = data;
    }

    this.charSet = this.parseCharSet(options.charSet);
  }

  private parseCharSet(charSet: DecoderOptions["charSet"] | undefined): CharSet {
    if (charSet === undefined) return CharSet.UTF8;
    if (typeof charSet === "number") return charSet;

    switch (charSet) {
      case "utf-8":
        return CharSet.UTF8;
      case "ascii":
        return CharSet.ASCII;
      case "utf16":
        return CharSet.UTF16;
      case "byte-array":
        return CharSet.ByteArray;
      default:
        return CharSet.UTF8;
    }
  }

  /**
   * Decode the next value from the buffer
   */
  unpack(): MessagePackValue {
    const type = this.unpackUint8();

    // Positive fixint (0x00 - 0x7f)
    if (type <= FixedRange.POSITIVE_FIXINT_MAX) {
      return type;
    }

    // Negative fixint (0xe0 - 0xff)
    if (type >= FixedRange.NEGATIVE_FIXINT_PREFIX) {
      return type - 256;
    }

    // Fixmap (0x80 - 0x8f)
    if (type >= FixedRange.FIXMAP_PREFIX && type <= FixedRange.FIXMAP_MAX) {
      const size = type & 0x0f;
      return this.unpackMap(size);
    }

    // Fixarray (0x90 - 0x9f)
    if (type >= FixedRange.FIXARRAY_PREFIX && type <= FixedRange.FIXARRAY_MAX) {
      const size = type & 0x0f;
      return this.unpackArray(size);
    }

    // Fixstr (0xa0 - 0xbf)
    if (type >= FixedRange.FIXSTR_PREFIX && type <= FixedRange.FIXSTR_MAX) {
      const size = type & 0x1f;
      return this.unpackRaw(size);
    }

    // Other formats
    switch (type) {
      case Format.NIL:
        return null;
      case Format.NEVER_USED:
        return undefined;
      case Format.FALSE:
        return false;
      case Format.TRUE:
        return true;

      case Format.BIN8: {
        const size = this.unpackUint8();
        return this.unpackBinary(size);
      }
      case Format.BIN16: {
        const size = this.unpackUint16();
        return this.unpackBinary(size);
      }
      case Format.BIN32: {
        const size = this.unpackUint32();
        return this.unpackBinary(size);
      }

      case Format.FLOAT32:
        return this.unpackFloat32();
      case Format.FLOAT64:
        return this.unpackFloat64();

      case Format.UINT8:
        return this.unpackUint8();
      case Format.UINT16:
        return this.unpackUint16();
      case Format.UINT32:
        return this.unpackUint32();
      case Format.UINT64:
        return this.unpackUint64();

      case Format.INT8:
        return this.unpackInt8();
      case Format.INT16:
        return this.unpackInt16();
      case Format.INT32:
        return this.unpackInt32();
      case Format.INT64:
        return this.unpackInt64();

      // Fixed extension types return undefined (not fully implemented)
      case Format.FIXEXT1:
      case Format.FIXEXT2:
      case Format.FIXEXT4:
      case Format.FIXEXT8:
      case Format.FIXEXT16:
        return this.unpackFixExt(type);

      case Format.STR8: {
        const size = this.unpackUint8();
        return this.unpackRaw(size);
      }
      case Format.STR16: {
        const size = this.unpackUint16();
        return this.unpackRaw(size);
      }
      case Format.STR32: {
        const size = this.unpackUint32();
        return this.unpackRaw(size);
      }

      case Format.ARRAY16: {
        const size = this.unpackUint16();
        return this.unpackArray(size);
      }
      case Format.ARRAY32: {
        const size = this.unpackUint32();
        return this.unpackArray(size);
      }

      case Format.MAP16: {
        const size = this.unpackUint16();
        return this.unpackMap(size);
      }
      case Format.MAP32: {
        const size = this.unpackUint32();
        return this.unpackMap(size);
      }

      default:
        throw new Error(`MessagePack: unknown format type 0x${type.toString(16)}`);
    }
  }

  private unpackUint8(): number {
    if (this.index >= this.data.length) {
      throw new Error("MessagePack: index is out of range");
    }
    return this.data[this.index++];
  }

  private unpackUint16(): number {
    if (this.index + 2 > this.data.length) {
      throw new Error("MessagePack: index is out of range");
    }
    const value = (this.data[this.index] << 8) | this.data[this.index + 1];
    this.index += 2;
    return value;
  }

  private unpackUint32(): number {
    if (this.index + 4 > this.data.length) {
      throw new Error("MessagePack: index is out of range");
    }
    const value =
      ((this.data[this.index] * 256 + this.data[this.index + 1]) * 256 +
        this.data[this.index + 2]) *
        256 +
      this.data[this.index + 3];
    this.index += 4;
    return value >>> 0; // Ensure unsigned
  }

  private unpackUint64(): number {
    if (this.index + 8 > this.data.length) {
      throw new Error("MessagePack: index is out of range");
    }
    // Note: JavaScript numbers can only safely represent integers up to 2^53-1
    // For larger values, precision may be lost
    let value = 0;
    for (let i = 0; i < 8; i++) {
      value = value * 256 + this.data[this.index + i];
    }
    this.index += 8;
    return value;
  }

  private unpackInt8(): number {
    const uint8 = this.unpackUint8();
    return uint8 < 0x80 ? uint8 : uint8 - 256;
  }

  private unpackInt16(): number {
    const uint16 = this.unpackUint16();
    return uint16 < 0x8000 ? uint16 : uint16 - 65536;
  }

  private unpackInt32(): number {
    const uint32 = this.unpackUint32();
    return uint32 < 0x80000000 ? uint32 : uint32 - 4294967296;
  }

  private unpackInt64(): number {
    const uint64 = this.unpackUint64();
    // Note: JavaScript numbers can only safely represent integers up to 2^53-1
    return uint64 < 2 ** 63 ? uint64 : uint64 - 2 ** 64;
  }

  private unpackFloat32(): number {
    if (this.index + 4 > this.data.length) {
      throw new Error("MessagePack: index is out of range");
    }

    const uint32 = this.unpackUint32();
    // Handle special cases
    if (uint32 === 0) return 0;
    if (uint32 === 0x80000000) return -0;

    const sign = uint32 >> 31;
    const exp = ((uint32 >> 23) & 0xff) - 127;
    const fraction = (uint32 & 0x7fffff) | 0x800000;

    return (sign === 0 ? 1 : -1) * fraction * 2 ** (exp - 23);
  }

  private unpackFloat64(): number {
    if (this.index + 8 > this.data.length) {
      throw new Error("MessagePack: index is out of range");
    }

    const h32 =
      ((this.data[this.index] * 256 + this.data[this.index + 1]) * 256 +
        this.data[this.index + 2]) *
        256 +
      this.data[this.index + 3];
    const l32 =
      ((this.data[this.index + 4] * 256 + this.data[this.index + 5]) * 256 +
        this.data[this.index + 6]) *
        256 +
      this.data[this.index + 7];
    this.index += 8;

    // Handle special cases
    if (h32 === 0 && l32 === 0) return 0;
    if (h32 === 0x80000000 && l32 === 0) return -0;

    const sign = h32 >> 31;
    const exp = ((h32 >> 20) & 0x7ff) - 1023;
    const hfrac = (h32 & 0xfffff) | 0x100000;
    const frac = hfrac * 2 ** (exp - 20) + l32 * 2 ** (exp - 52);

    return (sign === 0 ? 1 : -1) * frac;
  }

  private unpackRaw(size: number): string | number[] {
    if (this.index + size > this.data.length) {
      throw new Error(
        `MessagePack: index is out of range ${this.index} ${size} ${this.data.length}`,
      );
    }

    const bytes = this.data.slice(this.index, this.index + size);
    this.index += size;

    if (this.charSet === CharSet.ASCII) {
      // ASCII 8-bit encoding
      return String.fromCharCode(...bytes);
    } else if (this.charSet === CharSet.ByteArray) {
      // Return raw byte array
      return Array.from(bytes);
    } else {
      // UTF-8 decoding
      return this.decodeUtf8(bytes);
    }
  }

  private unpackBinary(size: number): Uint8Array {
    if (this.index + size > this.data.length) {
      throw new Error("MessagePack: index is out of range");
    }

    const bytes = this.data.slice(this.index, this.index + size);
    this.index += size;
    return bytes;
  }

  private decodeUtf8(bytes: Uint8Array): string {
    let i = 0;
    let str = "";

    while (i < bytes.length) {
      const c = bytes[i];

      if (c < 0x80) {
        // Single byte character (ASCII)
        str += String.fromCharCode(c);
        i++;
      } else if ((c & 0xe0) === 0xc0) {
        // Two byte character
        const code = ((c & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
        str += String.fromCharCode(code);
        i += 2;
      } else if ((c & 0xf0) === 0xe0) {
        // Three byte character
        const code = ((c & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
        str += String.fromCharCode(code);
        i += 3;
      } else if ((c & 0xf8) === 0xf0) {
        // Four byte character (surrogate pair)
        const code =
          ((c & 0x07) << 18) |
          ((bytes[i + 1] & 0x3f) << 12) |
          ((bytes[i + 2] & 0x3f) << 6) |
          (bytes[i + 3] & 0x3f);
        // Convert to surrogate pair
        const codePoint = code - 0x10000;
        str += String.fromCharCode(0xd800 + (codePoint >> 10), 0xdc00 + (codePoint & 0x3ff));
        i += 4;
      } else {
        // Invalid UTF-8 sequence, skip byte
        i++;
      }
    }

    return str;
  }

  private unpackArray(size: number): MessagePackValue[] {
    const array: MessagePackValue[] = new Array(size);
    for (let i = 0; i < size; i++) {
      array[i] = this.unpack();
    }
    return array;
  }

  private unpackMap(size: number): { [key: string]: MessagePackValue } {
    const map: { [key: string]: MessagePackValue } = {};
    for (let i = 0; i < size; i++) {
      const key = this.unpack();
      const value = this.unpack();
      map[String(key)] = value;
    }
    return map;
  }

  private unpackFixExt(type: number): undefined {
    // Skip extension data based on type
    let size: number;
    switch (type) {
      case Format.FIXEXT1:
        size = 1;
        break;
      case Format.FIXEXT2:
        size = 2;
        break;
      case Format.FIXEXT4:
        size = 4;
        break;
      case Format.FIXEXT8:
        size = 8;
        break;
      case Format.FIXEXT16:
        size = 16;
        break;
      default:
        size = 0;
    }
    // Skip type byte + data
    this.index += 1 + size;
    return undefined;
  }
}
