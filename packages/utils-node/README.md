# @statewalker/vcs-utils-node

Node.js-specific optimizations for `@statewalker/vcs-utils`.

## Overview

This package provides Node.js-optimized implementations that can optionally replace the portable defaults in `@statewalker/vcs-utils`. All optimizations are **opt-in** and must be explicitly registered.

### What This Package Provides

| Module | Description | Performance Benefit |
|--------|-------------|---------------------|
| `compression` | Node.js native zlib compression | 2-5x faster than pako for large files |
| `files` | Node.js filesystem adapter | Direct filesystem access for repositories |

## Installation

```bash
pnpm add @statewalker/vcs-utils-node @statewalker/vcs-utils
```

Note: This package has a peer dependency on `@statewalker/vcs-utils`.

## Usage

### Compression Optimization

Register Node.js native zlib at application startup:

```typescript
import { setCompressionUtils } from "@statewalker/vcs-utils/compression";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";

// Register once at application startup
setCompressionUtils(createNodeCompression());

// Now all compression operations use native zlib
import { deflate, inflate } from "@statewalker/vcs-utils/compression";
const compressed = await deflate(data);
```

### Node.js Filesystem

Create a filesystem adapter for local repositories:

```typescript
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";
import { createGitRepository } from "@statewalker/vcs-core";

const files = createNodeFilesApi({ rootDir: "/path/to/repo" });
const repo = await createGitRepository(files, ".git");
```

## API Reference

### `@statewalker/vcs-utils-node/compression`

```typescript
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";

const compression = createNodeCompression();
// Returns CompressionUtils with:
// - deflate: Async compression using zlib
// - inflate: Async decompression using zlib
// - compressBlock: Sync block compression
// - decompressBlock: Sync block decompression
// - decompressBlockPartial: Partial decompression for pack files
```

### `@statewalker/vcs-utils-node/files`

```typescript
import { createNodeFilesApi } from "@statewalker/vcs-utils-node/files";

interface NodeFilesApiOptions {
  rootDir: string;  // Root directory for all file operations
}

const files = createNodeFilesApi({ rootDir: "/path/to/root" });
// Returns FilesApi implementing the standard interface
```

## Design Principles

### No Auto-Registration

This package **never** registers itself automatically. You must explicitly call the appropriate setter function to use the optimized implementations:

```typescript
// WRONG - imports alone don't do anything
import "@statewalker/vcs-utils-node/compression";

// CORRECT - explicitly register the optimization
import { setCompressionUtils } from "@statewalker/vcs-utils/compression";
import { createNodeCompression } from "@statewalker/vcs-utils-node/compression";
setCompressionUtils(createNodeCompression());
```

### Optional by Design

All functionality in `@statewalker/vcs-utils` works without this package. The portable implementations (pako, Web Crypto) provide correct behavior across all runtimes. This package only adds performance benefits for Node.js environments.

### Single Application Entry Point

Register optimizations once at your application's entry point, not in library code. This ensures consistent behavior and avoids initialization order issues.

## When to Use This Package

**Use it when:**
- Running in Node.js
- Processing large files where compression performance matters
- Building CLI tools or server-side applications
- Working with local filesystem repositories

**Don't use it when:**
- Building browser applications
- Creating isomorphic libraries that must work everywhere
- Bundle size is critical (the portable implementations are smaller)

## Dependencies

**Runtime:**
- `@statewalker/vcs-utils` (peer dependency)
- `@statewalker/webrun-files-node` - Node.js filesystem adapter

**Note:** This package uses Node.js built-in `zlib` module, which is available in all Node.js versions.

## License

MIT
