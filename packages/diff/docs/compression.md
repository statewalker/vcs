# Compression Module

The compression module provides a unified interface for compression and decompression operations across different JavaScript environments.

## Overview

This module is **not based on JGit**. It provides a custom abstraction layer to support both Node.js and Web environments with a consistent API.

## Features

### Multi-Environment Support

Automatically detects and uses the best compression provider:
- **Node.js**: Uses `zlib` module
- **Web/Browser**: Uses Compression Streams API
- **Custom**: Pluggable provider interface

### Supported Algorithms

- **Deflate** (zlib) - Standard compression for Git objects
- **Gzip** - Alternative compression format

## Key Components

### CompressionProvider Interface

All compression providers implement this interface:

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

Get the default provider for your environment:

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

For Node.js environments:

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

**Features**:
- Uses Node.js `zlib` module
- Supports compression levels (0-9)
- High performance
- Streaming support (via zlib directly)

### WebCompressionProvider

For browser and Web environments:

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

**Features**:
- Uses `CompressionStream` and `DecompressionStream` APIs
- Modern browser support
- Stream-based processing
- No external dependencies

### Custom Providers

Implement your own compression provider:

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

Used for compressing binary patch content:

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

Used for decompressing binary hunks:

```typescript
import { BinaryHunk } from '@webrun-vcs/diff';

// BinaryHunk automatically uses the compression provider
// to decompress literal and delta hunks
```

## Performance Considerations

### Compression Levels (Node.js)

- **Level 0**: No compression (store only)
- **Level 1-3**: Fast compression, lower ratio
- **Level 4-6**: Balanced (default: 6)
- **Level 7-9**: Best compression, slower

**Git default**: Level 6 (balanced)

### Buffer Sizes

For large files:
- Consider streaming compression (use zlib directly in Node.js)
- Web Compression Streams API handles streaming automatically
- This module's API is buffer-based for simplicity

### Memory Usage

- Compression: ~1-3x input size
- Decompression: ~1x output size
- Use streaming for very large files (>100MB)

## Browser Compatibility

### Compression Streams API

Required for `WebCompressionProvider`:
- Chrome/Edge 80+
- Firefox 113+
- Safari 16.4+

For older browsers, you'll need:
- Polyfill like `pako` or `fflate`
- Custom provider implementation

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

JGit uses Java's built-in compression libraries. This module provides:

1. **Cross-platform abstraction** - Works in both Node.js and browsers
2. **Modern async API** - Promise-based
3. **Pluggable providers** - Easy to add custom implementations
4. **Auto-detection** - Automatically selects the best provider
5. **TypeScript types** - Full type safety

## References

- [Node.js zlib](https://nodejs.org/api/zlib.html)
- [Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API)
- [Deflate (RFC 1951)](https://tools.ietf.org/html/rfc1951)
- [Gzip (RFC 1952)](https://tools.ietf.org/html/rfc1952)
