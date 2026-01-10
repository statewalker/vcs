# @statewalker/vcs-utils

Foundation utilities for cryptographic hashing, compression, and diff/delta algorithms.

## Overview

This package provides the low-level building blocks that power the StateWalker VCS ecosystem. It handles the fundamental operations needed for content-addressable storage: computing SHA-1 hashes to identify objects, compressing and decompressing data using zlib-compatible algorithms, and creating efficient binary deltas between similar content.

### WinterTC/WinterCG Compliance

This package is fully compliant with [WinterTC](https://tc39.es/proposal-wintercg/) Web Platform APIs, meaning it works out of the box in:

- **Browsers** (Chrome, Firefox, Safari, Edge)
- **Node.js** (v18+)
- **Deno**
- **Bun**
- **Cloudflare Workers**
- Any other JavaScript runtime supporting standard Web APIs

The default implementations use:
- **Web Crypto API** (`crypto.subtle`) for SHA-1 hashing
- **pako** library for zlib compression (pure JavaScript)
- **CompressionStream/DecompressionStream** for streaming compression
- Standard **Uint8Array** and **AsyncIterator** interfaces

### Pluggable Architecture

All core utilities can be enhanced with optimized implementations via explicit setter methods:

```typescript
import { setCompressionUtils } from "@statewalker/vcs-utils/compression";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";

// Opt-in to Node.js zlib for better performance
setCompressionUtils(createNodeCompression());
```

**Key principle**: The package works everywhere without any overloading. Node.js optimizations from `@statewalker/vcs-utils-node` are opt-in performance improvements, not requirements.

All functions are pure and stateless, making them easy to test and compose. The streaming interfaces allow processing large files without loading them entirely into memory.

## Installation

```bash
pnpm add @statewalker/vcs-utils
```

## Public API

### Main Export

The root export combines all major functionality:

```typescript
import { sha1, compress, decompress, createDelta, applyDelta } from "@statewalker/vcs-utils";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@statewalker/vcs-utils/compression` | `compress()`, `decompress()` using pako (browser-compatible) |
| `@statewalker/vcs-utils/hash` | Hash algorithm registry and utilities |
| `@statewalker/vcs-utils/hash/sha1` | SHA-1 hashing for Git object IDs |
| `@statewalker/vcs-utils/hash/crc32` | CRC32 checksum calculation |
| `@statewalker/vcs-utils/hash/fossil-checksum` | Fossil VCS compatible checksum |
| `@statewalker/vcs-utils/hash/rolling-checksum` | Rolling hash for rsync-style delta |
| `@statewalker/vcs-utils/hash/strong-checksum` | Strong checksum verification |
| `@statewalker/vcs-utils/hash/utils` | Hash conversion utilities |
| `@statewalker/vcs-utils/diff` | Delta encoding/decoding, text diff (Myers), and Git patch format |
| `@statewalker/vcs-utils/cache` | LRU cache and intermediate caching utilities |
| `@statewalker/vcs-utils/streams` | Async iterable utilities for streaming data |
| `@statewalker/vcs-utils/files` | In-memory filesystem API and file utilities |

## Usage Examples

### Computing SHA-1 Hash

Git identifies objects by their SHA-1 hash. Here's how to compute one:

```typescript
import { sha1 } from "@statewalker/vcs-utils/hash/sha1";

const content = new TextEncoder().encode("Hello, World!");
const hash = sha1(content);
// Returns Uint8Array of 20 bytes

// Convert to hex string
const hexHash = Array.from(hash)
  .map(b => b.toString(16).padStart(2, '0'))
  .join('');
```

### Compressing and Decompressing Data

Git stores objects in zlib-compressed format:

```typescript
import { compress, decompress } from "@statewalker/vcs-utils/compression";

const original = new TextEncoder().encode("Some content to compress");

// Compress
const compressed = compress(original);

// Decompress
const restored = decompress(compressed);
```

For Node.js environments, use the optimized version from `@statewalker/vcs-utils-node`:

```typescript
import { setCompressionUtils } from "@statewalker/vcs-utils/compression";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";

// Register Node.js compression at application startup
setCompressionUtils(createNodeCompression());
```

### Creating and Applying Binary Deltas

Delta compression stores differences between similar objects, dramatically reducing storage for incremental changes:

```typescript
import { createDelta, applyDelta } from "@statewalker/vcs-utils/diff";

const baseContent = new TextEncoder().encode("Original file content");
const newContent = new TextEncoder().encode("Original file content with additions");

// Create a delta from base to new
const delta = createDelta(baseContent, newContent);

// Apply delta to reconstruct new content
const reconstructed = applyDelta(baseContent, delta);
```

### CRC32 Checksum

Pack files use CRC32 for integrity verification:

```typescript
import { crc32 } from "@statewalker/vcs-utils/hash/crc32";

const data = new Uint8Array([1, 2, 3, 4, 5]);
const checksum = crc32(data);
```

### Text Diff with Myers Algorithm

The Myers diff algorithm finds the minimal edit sequence between two text contents:

```typescript
import { RawText, RawTextComparator, myersDiff } from "@statewalker/vcs-utils/diff";

const oldText = new RawText(new TextEncoder().encode("line1\nline2\nline3"));
const newText = new RawText(new TextEncoder().encode("line1\nmodified\nline3"));

const comparator = new RawTextComparator();
const edits = myersDiff(oldText, newText, comparator);

for (const edit of edits) {
  console.log(`${edit.type}: lines ${edit.beginA}-${edit.endA} → ${edit.beginB}-${edit.endB}`);
}
```

### LRU Cache

Efficiently cache computed values with automatic eviction of least-recently-used entries:

```typescript
import { LruCache } from "@statewalker/vcs-utils/cache";

const cache = new LruCache<string, Uint8Array>(100); // Max 100 entries

// Store and retrieve
cache.set("key1", someData);
const data = cache.get("key1");

// Check existence
if (cache.has("key1")) {
  // ...
}
```

### Stream Utilities

Process data streams efficiently without loading everything into memory:

```typescript
import { collect, concat, toLines, mapStream } from "@statewalker/vcs-utils/streams";

// Collect async iterable into single Uint8Array
const allData = await collect(asyncDataSource);

// Concatenate multiple byte arrays
const combined = concat([chunk1, chunk2, chunk3]);

// Split stream into lines
for await (const line of toLines(byteStream)) {
  console.log(new TextDecoder().decode(line));
}

// Transform stream elements
const transformed = mapStream(source, (chunk) => processChunk(chunk));
```

## Architecture

### Design Decisions

The package prioritizes correctness, compatibility with Git's formats, and universal runtime support. All hashing and compression algorithms produce output that Git can read, enabling interoperability with standard Git tooling.

**Universal by default**: The package uses only Web Platform APIs that work across all modern JavaScript runtimes. No Node.js-specific code is included.

**Explicit opt-in for optimizations**: Platform-specific optimizations are available in separate packages (like `@statewalker/vcs-utils-node`) and must be explicitly registered via setter methods. This ensures:
- Tree-shaking works correctly for bundlers
- No unexpected runtime dependencies
- Clear separation between portable and optimized code

### Implementation Details

The delta algorithm implements the same format Git uses for pack files, based on the rsync rolling checksum approach. This allows StateWalker VCS pack files to be read by standard Git clients and vice versa.

Hash functions operate on `Uint8Array` input and output, providing a consistent interface across all environments without string encoding issues.

## JGit References

Developers familiar with JGit will recognize these mappings:

| StateWalker VCS | JGit |
|-----------------|------|
| `sha1` | `org.eclipse.jgit.util.sha1.SHA1`, `SHA1Java` |
| `crc32` | CRC32 validation in pack processing |
| `compress`/`decompress` | `InflaterCache`, zlib usage throughout |
| `diff` | `org.eclipse.jgit.diff.MyersDiff`, `HistogramDiff` |
| Delta algorithms | `org.eclipse.jgit.internal.storage.pack.BinaryDelta`, `DeltaEncoder` |

## Dependencies

**Runtime:**
- `pako` - zlib compression for browser environments

**Development:**
- `vitest` - Testing
- `rolldown` - Bundling
- `typescript` - Type definitions

## License

MIT
