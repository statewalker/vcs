# Compression Module

The compression module provides a unified interface for compression and decompression operations across different JavaScript environments.

## Overview

This module is **not based on JGit**. It provides a custom abstraction layer to support both Node.js and Web environments with a consistent API. When you compress data, the module automatically detects your environment and picks the right implementation—`zlib` in Node.js or the Compression Streams API in browsers. You can also plug in custom providers.

## Compression Support

The module handles deflate (zlib), which Git uses for objects, and gzip as an alternative format. In Node.js, it uses the `zlib` module. In browsers, it leverages the Compression Streams API. If you need something different, the pluggable provider interface lets you bring your own implementation.

## Key Components

### CompressionProvider Interface

All compression providers follow this interface, giving you a consistent way to compress and decompress data:

```typescript
interface CompressionProvider {
  compress(
    data: Uint8Array,
    algorithm: CompressionAlgorithm,
    options?: CompressionOptions
  ): Promise<Uint8Array>;

  decompress(
    data: Uint8Array,
    algorithm: CompressionAlgorithm,
    options?: DecompressionOptions
  ): Promise<Uint8Array>;
}
```

### Auto-Detection

When you call `getDefaultCompressionProvider()`, the module detects your environment and returns the appropriate provider:

```typescript
import { getDefaultCompressionProvider } from '@webrun-vcs/diff';

const provider = await getDefaultCompressionProvider();

const compressed = await provider.compress(
  data,
  CompressionAlgorithm.DEFLATE
);

const decompressed = await provider.decompress(
  compressed,
  CompressionAlgorithm.DEFLATE
);
```

### NodeCompressionProvider

In Node.js environments, this provider uses the `zlib` module. You get support for compression levels (0-9), high performance, and streaming support when you use zlib directly:

```typescript
import { NodeCompressionProvider, CompressionAlgorithm } from '@webrun-vcs/diff';

const provider = new NodeCompressionProvider();

// Compress with deflate
const compressed = await provider.compress(
  data,
  CompressionAlgorithm.DEFLATE,
  { level: 9 } // Maximum compression
);

// Decompress
const original = await provider.decompress(
  compressed,
  CompressionAlgorithm.DEFLATE
);
```

### WebCompressionProvider

For browser and Web environments, this provider uses the `CompressionStream` and `DecompressionStream` APIs. It works in modern browsers, processes data as streams, and requires no external dependencies:

```typescript
import { WebCompressionProvider, CompressionAlgorithm } from '@webrun-vcs/diff';

const provider = new WebCompressionProvider();

// Compress with deflate
const compressed = await provider.compress(
  data,
  CompressionAlgorithm.DEFLATE
);

// Decompress
const original = await provider.decompress(
  compressed,
  CompressionAlgorithm.DEFLATE
);
```

### Custom Providers

When you need custom compression—maybe using pako or another library—you implement the `CompressionProvider` interface and set it as the default:

```typescript
import { CompressionProvider, CompressionAlgorithm, setDefaultCompressionProvider } from '@webrun-vcs/diff';

class MyCompressionProvider implements CompressionProvider {
  async compress(data: Uint8Array, algorithm: CompressionAlgorithm): Promise<Uint8Array> {
    // Your compression logic
    return compressedData;
  }

  async decompress(data: Uint8Array, algorithm: CompressionAlgorithm): Promise<Uint8Array> {
    // Your decompression logic
    return originalData;
  }
}

// Set as default
setDefaultCompressionProvider(new MyCompressionProvider());
```

## Types

### CompressionAlgorithm

```typescript
enum CompressionAlgorithm {
  DEFLATE = 'deflate',
  GZIP = 'gzip'
}
```

### CompressionOptions

```typescript
interface CompressionOptions {
  level?: number; // Compression level (0-9), Node.js only
}
```

### DecompressionOptions

```typescript
interface DecompressionOptions {
  // Currently no options, reserved for future use
}
```

### CompressionError

```typescript
class CompressionError extends Error {
  constructor(message: string, cause?: Error);
}
```

## Usage Examples

### Basic Compression

```typescript
import { getDefaultCompressionProvider, CompressionAlgorithm } from '@webrun-vcs/diff';

const provider = await getDefaultCompressionProvider();

// Compress data
const data = new TextEncoder().encode('Hello, World!');
const compressed = await provider.compress(data, CompressionAlgorithm.DEFLATE);

console.log(`Original: ${data.length} bytes`);
console.log(`Compressed: ${compressed.length} bytes`);

// Decompress
const decompressed = await provider.decompress(compressed, CompressionAlgorithm.DEFLATE);
const text = new TextDecoder().decode(decompressed);
console.log(text); // "Hello, World!"
```

### Node.js with Compression Level

```typescript
import { NodeCompressionProvider, CompressionAlgorithm } from '@webrun-vcs/diff';

const provider = new NodeCompressionProvider();

// Fast compression (level 1)
const fast = await provider.compress(
  data,
  CompressionAlgorithm.DEFLATE,
  { level: 1 }
);

// Best compression (level 9)
const best = await provider.compress(
  data,
  CompressionAlgorithm.DEFLATE,
  { level: 9 }
);

console.log(`Fast: ${fast.length} bytes`);
console.log(`Best: ${best.length} bytes`);
```

### Git Object Compression

Git uses deflate compression for objects:

```typescript
import { getDefaultCompressionProvider, CompressionAlgorithm } from '@webrun-vcs/diff';

async function compressGitObject(type: string, content: Uint8Array): Promise<Uint8Array> {
  const provider = await getDefaultCompressionProvider();

  // Git object format: "<type> <size>\0<content>"
  const header = new TextEncoder().encode(`${type} ${content.length}\0`);
  const object = new Uint8Array(header.length + content.length);
  object.set(header);
  object.set(content, header.length);

  return provider.compress(object, CompressionAlgorithm.DEFLATE);
}

const content = new TextEncoder().encode('file content');
const compressed = await compressGitObject('blob', content);
```

### Error Handling

```typescript
import { getDefaultCompressionProvider, CompressionError, CompressionAlgorithm } from '@webrun-vcs/diff';

try {
  const provider = await getDefaultCompressionProvider();
  const result = await provider.decompress(invalidData, CompressionAlgorithm.DEFLATE);
} catch (error) {
  if (error instanceof CompressionError) {
    console.error('Compression error:', error.message);
    console.error('Caused by:', error.cause);
  } else {
    throw error;
  }
}
```

### Environment-Specific Setup

```typescript
import {
  setDefaultCompressionProvider,
  NodeCompressionProvider,
  WebCompressionProvider
} from '@webrun-vcs/diff';

// Manually configure for your environment
if (typeof process !== 'undefined' && process.versions?.node) {
  // Node.js environment
  setDefaultCompressionProvider(new NodeCompressionProvider());
} else if (typeof CompressionStream !== 'undefined') {
  // Web environment
  setDefaultCompressionProvider(new WebCompressionProvider());
} else {
  throw new Error('No compression support available');
}
```

## Integration with Other Modules

### Binary Patches

When you encode Git binary deltas, the compression module handles the deflate compression automatically:

```typescript
import {
  encodeGitBinaryDelta,
  getDefaultCompressionProvider,
  CompressionAlgorithm
} from '@webrun-vcs/diff';

// Binary delta is automatically compressed
const delta = await encodeGitBinaryDelta(source, target);
// Delta content is deflate-compressed
```

### Patch Application

BinaryHunk automatically uses the compression provider to decompress literal and delta hunks:

```typescript
import { BinaryHunk } from '@webrun-vcs/diff';

// BinaryHunk automatically uses the compression provider
// to decompress literal and delta hunks
```

## Performance Considerations

### Compression Levels (Node.js)

In Node.js, you can control compression levels. Level 0 stores without compression. Levels 1-3 compress quickly but with lower ratios. Levels 4-6 balance speed and compression, with 6 as the default (matching Git). Levels 7-9 give the best compression but run slower.

### Buffer Sizes

For large files, consider streaming compression using zlib directly in Node.js. The Web Compression Streams API handles streaming automatically. This module's API uses buffers for simplicity.

### Memory Usage

Compression typically uses 1-3x the input size in memory. Decompression uses about 1x the output size. When working with very large files (over 100MB), streaming becomes important.

## Browser Compatibility

### Compression Streams API

The `WebCompressionProvider` requires the Compression Streams API. You'll find it in Chrome and Edge 80+, Firefox 113+, and Safari 16.4+. For older browsers, use a polyfill like pako or fflate with a custom provider implementation.

### Example with Pako

```typescript
import pako from 'pako';
import { CompressionProvider, CompressionAlgorithm, setDefaultCompressionProvider } from '@webrun-vcs/diff';

class PakoCompressionProvider implements CompressionProvider {
  async compress(data: Uint8Array, algorithm: CompressionAlgorithm): Promise<Uint8Array> {
    if (algorithm === CompressionAlgorithm.DEFLATE) {
      return pako.deflate(data);
    } else if (algorithm === CompressionAlgorithm.GZIP) {
      return pako.gzip(data);
    }
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }

  async decompress(data: Uint8Array, algorithm: CompressionAlgorithm): Promise<Uint8Array> {
    if (algorithm === CompressionAlgorithm.DEFLATE) {
      return pako.inflate(data);
    } else if (algorithm === CompressionAlgorithm.GZIP) {
      return pako.ungzip(data);
    }
    throw new Error(`Unsupported algorithm: ${algorithm}`);
  }
}

setDefaultCompressionProvider(new PakoCompressionProvider());
```

## Differences from JGit

JGit uses Java's built-in compression libraries. This module provides a cross-platform abstraction that works in both Node.js and browsers, a modern async API using Promises, pluggable providers for custom implementations, auto-detection that picks the best provider, and TypeScript types for full type safety.

## References

- [Node.js zlib](https://nodejs.org/api/zlib.html)
- [Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API)
- [Deflate (RFC 1951)](https://tools.ietf.org/html/rfc1951)
- [Gzip (RFC 1952)](https://tools.ietf.org/html/rfc1952)
