/**
 * MessagePack Encoder
 *
 * Encodes JavaScript values into MessagePack binary format.
 *
 * Based on the MessagePack specification:
 * https://github.com/msgpack/msgpack/blob/master/spec.md
 *
 * Original JS implementation by cuzic:
 * https://github.com/cuzic/MessagePack-JS
 */

import { type EncoderOptions, Format, type MessagePackValue } from "./types.js";

/**
 * Encoder for MessagePack binary data
 */
export class Encoder {
  private buffer: number[] = [];
  private utf8Strings: boolean;

  /**
   * Create a new encoder
   * @param options - Encoder options
   */
  constructor(options: EncoderOptions = {}) {
    this.utf8Strings = options.utf8Strings !== false;
  }

  /**
   * Encode a value to MessagePack format
   * @param value - Value to encode
   * @returns Uint8Array containing the encoded data
   */
  pack(value: MessagePackValue): Uint8Array {
    this.buffer = [];
    this.packValue(value);
    return new Uint8Array(this.buffer);
  }

  /**
   * Encode a value to a string (for compatibility with original implementation)
   * @param value - Value to encode
   * @returns String where each character represents a byte
   */
  packToString(value: MessagePackValue): string {
    const bytes = this.pack(value);
    return String.fromCharCode(...bytes);
  }

  private packValue(value: MessagePackValue): void {
    if (value === null) {
      this.buffer.push(Format.NIL);
      return;
    }

    if (value === undefined) {
      this.buffer.push(Format.NIL);
      return;
    }

    const type = typeof value;

    if (type === "boolean") {
      this.buffer.push(value ? Format.TRUE : Format.FALSE);
      return;
    }

    if (type === "number") {
      if (Number.isInteger(value)) {
        this.packInteger(value);
      } else {
        this.packFloat64(value);
      }
      return;
    }

    if (type === "string") {
      this.packString(value);
      return;
    }

    if (value instanceof Uint8Array) {
      this.packBinary(value);
      return;
    }

    if (Array.isArray(value)) {
      this.packArray(value);
      return;
    }

    if (type === "object") {
      this.packObject(value as { [key: string]: MessagePackValue });
      return;
    }

    throw new Error(`MessagePack: unsupported type ${type}`);
  }

  private packInteger(num: number): void {
    // Positive fixint (0 to 127)
    if (num >= 0 && num <= 0x7f) {
      this.buffer.push(num);
      return;
    }

    // Negative fixint (-32 to -1)
    if (num >= -0x20 && num < 0) {
      this.buffer.push(num & 0xff);
      return;
    }

    // uint8 (0 to 255)
    if (num >= 0 && num <= 0xff) {
      this.buffer.push(Format.UINT8);
      this.packUint8(num);
      return;
    }

    // int8 (-128 to -33)
    if (num >= -0x80 && num < -0x20) {
      this.buffer.push(Format.INT8);
      this.packInt8(num);
      return;
    }

    // uint16 (256 to 65535)
    if (num >= 0 && num <= 0xffff) {
      this.buffer.push(Format.UINT16);
      this.packUint16(num);
      return;
    }

    // int16 (-32768 to -129)
    if (num >= -0x8000 && num < -0x80) {
      this.buffer.push(Format.INT16);
      this.packInt16(num);
      return;
    }

    // uint32 (65536 to 4294967295)
    if (num >= 0 && num <= 0xffffffff) {
      this.buffer.push(Format.UINT32);
      this.packUint32(num);
      return;
    }

    // int32 (-2147483648 to -32769)
    if (num >= -0x80000000 && num < -0x8000) {
      this.buffer.push(Format.INT32);
      this.packInt32(num);
      return;
    }

    // int64 or uint64 for larger values
    if (num < 0) {
      this.buffer.push(Format.INT64);
      this.packInt64(num);
    } else {
      this.buffer.push(Format.UINT64);
      this.packUint64(num);
    }
  }

  private packUint8(num: number): void {
    this.buffer.push(num & 0xff);
  }

  private packUint16(num: number): void {
    this.buffer.push((num >> 8) & 0xff, num & 0xff);
  }

  private packUint32(num: number): void {
    this.buffer.push((num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff);
  }

  private packUint64(num: number): void {
    const high = Math.floor(num / 0x100000000);
    const low = num >>> 0;

    this.buffer.push(
      (high >>> 24) & 0xff,
      (high >>> 16) & 0xff,
      (high >>> 8) & 0xff,
      high & 0xff,
      (low >>> 24) & 0xff,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff,
    );
  }

  private packInt8(num: number): void {
    this.buffer.push(num & 0xff);
  }

  private packInt16(num: number): void {
    this.buffer.push((num >> 8) & 0xff, num & 0xff);
  }

  private packInt32(num: number): void {
    this.buffer.push((num >>> 24) & 0xff, (num >>> 16) & 0xff, (num >>> 8) & 0xff, num & 0xff);
  }

  private packInt64(num: number): void {
    const high = Math.floor(num / 0x100000000);
    const low = num >>> 0;

    this.buffer.push(
      (high >>> 24) & 0xff,
      (high >>> 16) & 0xff,
      (high >>> 8) & 0xff,
      high & 0xff,
      (low >>> 24) & 0xff,
      (low >>> 16) & 0xff,
      (low >>> 8) & 0xff,
      low & 0xff,
    );
  }

  private packFloat64(num: number): void {
    this.buffer.push(Format.FLOAT64);

    // Handle special cases
    if (num === 0) {
      if (1 / num === -Infinity) {
        // Negative zero
        this.buffer.push(0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
      } else {
        this.buffer.push(0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00);
      }
      return;
    }

    let sign = 0;
    if (num < 0) {
      sign = 1;
      num = -num;
    }

    const exp = Math.floor(Math.log(num) / Math.LN2);
    const frac0 = num / 2 ** exp - 1;
    const frac1 = Math.floor(frac0 * 2 ** 52);
    const b32 = 2 ** 32;

    const h32 = (sign << 31) | ((exp + 1023) << 20) | Math.floor(frac1 / b32);
    const l32 = frac1 % b32;

    this.packInt32(h32);
    this.packInt32(l32);
  }

  private packString(str: string): void {
    let bytes: number[];

    if (this.utf8Strings) {
      bytes = this.encodeUtf8(str);
    } else {
      // Legacy: each character as one byte (ASCII-like)
      bytes = [];
      for (let i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i) & 0xff);
      }
    }

    const length = bytes.length;

    // Fixstr (up to 31 bytes)
    if (length <= 0x1f) {
      this.buffer.push(0xa0 | length);
    }
    // str8 (up to 255 bytes)
    else if (length <= 0xff) {
      this.buffer.push(Format.STR8);
      this.packUint8(length);
    }
    // str16 (up to 65535 bytes)
    else if (length <= 0xffff) {
      this.buffer.push(Format.STR16);
      this.packUint16(length);
    }
    // str32 (up to 4294967295 bytes)
    else if (length <= 0xffffffff) {
      this.buffer.push(Format.STR32);
      this.packUint32(length);
    } else {
      throw new Error("MessagePack: string too long");
    }

    this.buffer.push(...bytes);
  }

  private encodeUtf8(str: string): number[] {
    const bytes: number[] = [];

    for (let i = 0; i < str.length; i++) {
      let code = str.charCodeAt(i);

      // Handle surrogate pairs
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
        const next = str.charCodeAt(i + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
          i++;
        }
      }

      if (code < 0x80) {
        // Single byte
        bytes.push(code);
      } else if (code < 0x800) {
        // Two bytes
        bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        // Three bytes
        bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
      } else {
        // Four bytes
        bytes.push(
          0xf0 | (code >> 18),
          0x80 | ((code >> 12) & 0x3f),
          0x80 | ((code >> 6) & 0x3f),
          0x80 | (code & 0x3f),
        );
      }
    }

    return bytes;
  }

  private packBinary(data: Uint8Array): void {
    const length = data.length;

    // bin8 (up to 255 bytes)
    if (length <= 0xff) {
      this.buffer.push(Format.BIN8);
      this.packUint8(length);
    }
    // bin16 (up to 65535 bytes)
    else if (length <= 0xffff) {
      this.buffer.push(Format.BIN16);
      this.packUint16(length);
    }
    // bin32 (up to 4294967295 bytes)
    else if (length <= 0xffffffff) {
      this.buffer.push(Format.BIN32);
      this.packUint32(length);
    } else {
      throw new Error("MessagePack: binary data too long");
    }

    this.buffer.push(...data);
  }

  private packArray(array: MessagePackValue[]): void {
    const length = array.length;

    // Fixarray (up to 15 elements)
    if (length <= 0x0f) {
      this.buffer.push(0x90 | length);
    }
    // array16 (up to 65535 elements)
    else if (length <= 0xffff) {
      this.buffer.push(Format.ARRAY16);
      this.packUint16(length);
    }
    // array32 (up to 4294967295 elements)
    else if (length <= 0xffffffff) {
      this.buffer.push(Format.ARRAY32);
      this.packUint32(length);
    } else {
      throw new Error("MessagePack: array too long");
    }

    for (const item of array) {
      this.packValue(item);
    }
  }

  private packObject(obj: { [key: string]: MessagePackValue }): void {
    const keys = Object.keys(obj);
    const length = keys.length;

    // Fixmap (up to 15 pairs)
    if (length <= 0x0f) {
      this.buffer.push(0x80 | length);
    }
    // map16 (up to 65535 pairs)
    else if (length <= 0xffff) {
      this.buffer.push(Format.MAP16);
      this.packUint16(length);
    }
    // map32 (up to 4294967295 pairs)
    else if (length <= 0xffffffff) {
      this.buffer.push(Format.MAP32);
      this.packUint32(length);
    } else {
      throw new Error("MessagePack: object too large");
    }

    for (const key of keys) {
      this.packValue(key);
      this.packValue(obj[key]);
    }
  }
}
