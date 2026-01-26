# MessagePack TypeScript Implementation

A pure TypeScript implementation of the [MessagePack](https://msgpack.org/) serialization format.

## References

- **MessagePack Specification**: https://github.com/msgpack/msgpack/blob/master/spec.md
- **Original JavaScript Implementation**: https://github.com/cuzic/MessagePack-JS (MIT License)

## Usage

```typescript
import { pack, unpack } from "@statewalker/vcs-utils";

// Encode data
const packed = pack({ hello: "world", count: 42 });
// packed is a Uint8Array

// Decode data
const unpacked = unpack(packed);
// { hello: "world", count: 42 }
```

## API

### Functions

#### `pack(value, options?): Uint8Array`

Encode a JavaScript value to MessagePack format.

```typescript
const bytes = pack({ name: "test", enabled: true });
```

#### `unpack(data, options?): MessagePackValue`

Decode MessagePack data to a JavaScript value.

```typescript
const value = unpack(bytes);
```

#### `packToString(value, options?): string`

Encode to a string where each character represents a byte. Useful for compatibility with legacy code.

### Classes

#### `Encoder`

Reusable encoder instance.

```typescript
const encoder = new Encoder();
const bytes1 = encoder.pack(42);
const bytes2 = encoder.pack("hello");
```

#### `Decoder`

Decoder with configurable character set.

```typescript
const decoder = new Decoder(data, { charSet: "utf-8" });
const value = decoder.unpack();
```

### Options

#### DecoderOptions

```typescript
interface DecoderOptions {
  charSet?: CharSet | "utf-8" | "ascii" | "utf16" | "byte-array";
}
```

- `utf-8`: Decode strings as UTF-8 (default)
- `ascii`: Decode strings as ASCII
- `byte-array`: Return raw byte arrays instead of strings

#### EncoderOptions

```typescript
interface EncoderOptions {
  utf8Strings?: boolean; // Encode strings as UTF-8 (default: true)
}
```

## Supported Types

| JavaScript Type | MessagePack Format |
|----------------|-------------------|
| `null` | nil |
| `boolean` | true/false |
| `number` (integer) | fixint, uint8-64, int8-64 |
| `number` (float) | float64 |
| `string` | fixstr, str8-32 |
| `Uint8Array` | bin8-32 |
| `Array` | fixarray, array16-32 |
| `Object` | fixmap, map16-32 |

## Format Details

The encoder automatically selects the most compact format:

- Integers 0-127: single byte (positive fixint)
- Integers -32 to -1: single byte (negative fixint)
- Strings up to 31 bytes: 1-byte header (fixstr)
- Arrays up to 15 elements: 1-byte header (fixarray)
- Maps up to 15 pairs: 1-byte header (fixmap)

## Limitations

- 64-bit integers may lose precision beyond Number.MAX_SAFE_INTEGER
- Extension types are decoded as `undefined` (not fully implemented)
- UTF-16 charset is not implemented

## License

This implementation is based on [MessagePack-JS](https://github.com/cuzic/MessagePack-JS) by cuzic, released under the MIT License.
