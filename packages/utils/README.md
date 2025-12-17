# @webrun-vcs/utils

Foundation utilities for cryptographic hashing, compression, and diff/delta algorithms.

## Overview

This package provides the low-level building blocks that power the webrun-vcs ecosystem. It handles the fundamental operations needed for content-addressable storage: computing SHA-1 hashes to identify objects, compressing and decompressing data using zlib-compatible algorithms, and creating efficient binary deltas between similar content.

The utilities are designed to work seamlessly in both Node.js and browser environments. Where platform-specific optimizations are available (like Node.js's native zlib), dedicated sub-exports provide better performance while maintaining the same API.

All functions are pure and stateless, making them easy to test and compose. The streaming interfaces allow processing large files without loading them entirely into memory.

## Installation

```bash
pnpm add @webrun-vcs/utils
```

## Public API

### Main Export

The root export combines all major functionality:

```typescript
import { sha1, compress, decompress, createDelta, applyDelta } from "@webrun-vcs/utils";
```

### Sub-exports

| Export Path | Description |
|-------------|-------------|
| `@webrun-vcs/utils/compression` | `compress()`, `decompress()` using pako (browser-compatible) |
| `@webrun-vcs/utils/compression-node` | Node.js-optimized compression using native zlib |
| `@webrun-vcs/utils/hash` | Hash algorithm registry and utilities |
| `@webrun-vcs/utils/hash/sha1` | SHA-1 hashing for Git object IDs |
| `@webrun-vcs/utils/hash/crc32` | CRC32 checksum calculation |
| `@webrun-vcs/utils/hash/fossil-checksum` | Fossil VCS compatible checksum |
| `@webrun-vcs/utils/hash/rolling-checksum` | Rolling hash for rsync-style delta |
| `@webrun-vcs/utils/hash/strong-checksum` | Strong checksum verification |
| `@webrun-vcs/utils/hash/utils` | Hash conversion utilities |
| `@webrun-vcs/utils/diff` | Delta encoding/decoding and text diff |

## Usage Examples

### Computing SHA-1 Hash

Git identifies objects by their SHA-1 hash. Here's how to compute one:

```typescript
import { sha1 } from "@webrun-vcs/utils/hash/sha1";

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
import { compress, decompress } from "@webrun-vcs/utils/compression";

const original = new TextEncoder().encode("Some content to compress");

// Compress
const compressed = compress(original);

// Decompress
const restored = decompress(compressed);
```

For Node.js environments, prefer the optimized version:

```typescript
import { compress, decompress } from "@webrun-vcs/utils/compression-node";
```

### Creating and Applying Binary Deltas

Delta compression stores differences between similar objects, dramatically reducing storage for incremental changes:

```typescript
import { createDelta, applyDelta } from "@webrun-vcs/utils/diff";

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
import { crc32 } from "@webrun-vcs/utils/hash/crc32";

const data = new Uint8Array([1, 2, 3, 4, 5]);
const checksum = crc32(data);
```

## Architecture

### Design Decisions

The package prioritizes correctness and compatibility with Git's formats. All hashing and compression algorithms produce output that Git can read, enabling interoperability with standard Git tooling.

Browser compatibility is achieved through pako for compression, while Node.js can use native zlib through the separate `/compression-node` export. This split allows bundlers to tree-shake the unused implementation.

### Implementation Details

The delta algorithm implements the same format Git uses for pack files, based on the rsync rolling checksum approach. This allows webrun-vcs pack files to be read by standard Git clients and vice versa.

Hash functions operate on `Uint8Array` input and output, providing a consistent interface across all environments without string encoding issues.

## JGit References

Developers familiar with JGit will recognize these mappings:

| webrun-vcs | JGit |
|------------|------|
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
