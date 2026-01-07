# Simplified Files API Plan

This document proposes moving all FS-related functionality to `@statewalker/vcs-utils`, which concentrates all interfaces with the external world.

## Current State Analysis

### Methods and Types Used from @statewalker/webrun-files

The codebase currently imports from `@statewalker/webrun-files`:

**FilesApi Methods Used:**
| Method | Signature | Description | Status |
|--------|-----------|-------------|--------|
| `read(path)` | `AsyncIterable<Uint8Array>` | Stream reading | **Keep** (enhanced with options) |
| `readFile(path)` | `Promise<Uint8Array>` | Bulk reading | **Remove** → utility function |
| `write(path, content)` | Write AsyncIterable | Stream writing | Keep |
| `mkdir(path)` | Create directory | Recursive mkdir | Keep |
| `remove(path)` | Delete file/directory | Remove path | Keep |
| `stats(path)` | `{kind, size, lastModified}` | File metadata | Keep |
| `list(path)` | `AsyncIterable<FileInfo>` | Directory listing | Keep |
| `exists(path)` | `Promise<boolean>` | Existence check | Keep |

**Types:**
- `FilesApi` - Main class wrapping implementations
- `FileInfo` - Entry info from `list()` with `name`, `kind`, `size`, `lastModified`
- `FileHandle` - Used by `open()` for random access → **Remove** (replaced by `read()` with options)

**Implementation Classes:**
- `MemFilesApi` - In-memory implementation
- `NodeFilesApi` - Node.js `fs` wrapper

**Utilities:**
- `joinPath(...parts)` - Cross-platform path joining
- `basename(path)` - Extract filename
- `dirname(path)` - Extract directory

### Files Importing from @statewalker/webrun-files

**packages/core/src/ (5 files):**
1. `files/index.ts` - Current abstraction layer
2. `stores/create-repository.ts` - Uses `MemFilesApi`
3. `binary/volatile-store.files.ts` - Direct import
4. `binary/raw-store.files.ts` - Direct import
5. `worktree/working-tree-iterator.impl.ts` - Uses `FileInfo`

**Tests (10+ files):** All import `MemFilesApi` or `NodeFilesApi` directly

**Apps (9+ files):** All import `NodeFilesApi` directly

## Proposed Architecture

All FS-related functionality moves to `@statewalker/vcs-utils/files`.

### New Module Structure in vcs-utils

```
packages/utils/src/
├── files/
│   ├── index.ts              # Main exports
│   ├── files-api.ts          # FilesApi interface definition
│   ├── file-info.ts          # FileInfo, FileStats types
│   ├── file-mode.ts          # FileMode constants (moved from vcs-core)
│   ├── path-utils.ts         # joinPath, basename, dirname
│   ├── file-utils.ts         # readFile, readText, tryReadFile, tryReadText
│   ├── mem-files-api.ts      # createInMemoryFilesApi factory
│   └── node-files-api.ts     # createNodeFilesApi factory
└── index.ts                  # Add: export * from "./files/index.js"
```

### Public API from @statewalker/vcs-utils/files

```typescript
// ===== Core Interface =====
/**
 * Abstract file system interface for VCS operations.
 * All library code should depend only on this interface.
 *
 * NOTE: No readFile() method - use utility functions instead.
 */
export interface FilesApi {
  /**
   * Stream read file content with optional range support.
   * @param path - File path
   * @param options.start - Start offset (bytes)
   * @param options.len - Number of bytes to read
   * @param options.signal - AbortSignal for cancellation
   */
  read(path: string, options?: ReadOptions): AsyncIterable<Uint8Array>;

  /** Write content to file (creates parent dirs) */
  write(path: string, content: AsyncIterable<Uint8Array>): Promise<void>;

  /** Create directory (recursive) */
  mkdir(path: string): Promise<void>;

  /** Remove file or directory */
  remove(path: string): Promise<boolean>;

  /** Get file/directory stats */
  stats(path: string): Promise<FileStats | undefined>;

  /** List directory entries */
  list(path: string): AsyncIterable<FileInfo>;

  /** Check if path exists */
  exists(path: string): Promise<boolean>;
}

export interface ReadOptions {
  /** Start offset in bytes */
  start?: number;
  /** Number of bytes to read */
  len?: number;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

// ===== Types =====
export interface FileInfo {
  name: string;
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
}

export interface FileStats {
  kind: "file" | "directory";
  size?: number;
  lastModified?: number;
}

/** Git file mode constants */
export const FileMode = {
  TREE: 0o040000,
  REGULAR_FILE: 0o100644,
  EXECUTABLE_FILE: 0o100755,
  SYMLINK: 0o120000,
  GITLINK: 0o160000,
} as const;

export type FileModeValue = (typeof FileMode)[keyof typeof FileMode];

// ===== Factory Functions =====
/**
 * Create an in-memory FilesApi instance.
 * Useful for tests and temporary storage.
 *
 * @param initialFiles - Optional initial file contents
 * @returns FilesApi instance
 */
export function createInMemoryFilesApi(
  initialFiles?: Record<string, string | Uint8Array>
): FilesApi;

/**
 * Create a Node.js filesystem-backed FilesApi instance.
 *
 * @param options.fs - Node.js fs/promises module
 * @param options.rootDir - Root directory for all operations
 * @returns FilesApi instance
 */
export function createNodeFilesApi(options: {
  fs: typeof import("node:fs/promises");
  rootDir: string;
}): FilesApi;

// ===== Path Utilities =====
/** Join path segments */
export function joinPath(...parts: string[]): string;

/** Extract filename from path */
export function basename(path: string): string;

/** Extract directory from path */
export function dirname(path: string): string;

// ===== File Reading Utilities =====
// These replace the removed readFile() method on FilesApi.
// They use read() + collect() internally.

/**
 * Read entire file content as Uint8Array.
 * Uses files.read() internally with collect().
 */
export async function readFile(files: FilesApi, path: string): Promise<Uint8Array>;

/**
 * Read entire file content as UTF-8 text.
 * Uses files.read() internally with collect() + TextDecoder.
 */
export async function readText(files: FilesApi, path: string): Promise<string>;

/**
 * Read file or return undefined if not found.
 * Useful for optional config files.
 */
export async function tryReadFile(
  files: FilesApi,
  path: string
): Promise<Uint8Array | undefined>;

/**
 * Read text file or return undefined if not found.
 */
export async function tryReadText(
  files: FilesApi,
  path: string
): Promise<string | undefined>;

// ===== Random Access Utilities =====
// These replace FilesApi.open() and FileHandle.

/**
 * Read bytes at specific position into buffer.
 * Use when you have a pre-allocated buffer.
 */
export async function readAt(
  files: FilesApi,
  path: string,
  buffer: Uint8Array,
  bufferOffset: number,
  length: number,
  position: number
): Promise<number>;

/**
 * Read bytes at specific position, returning new Uint8Array.
 * Simpler when you don't need to write into existing buffer.
 */
export async function readRange(
  files: FilesApi,
  path: string,
  position: number,
  length: number
): Promise<Uint8Array>;
```

### Implementation Strategy

#### File Reading Utilities

The utility functions use the existing `collect()` from `@statewalker/vcs-utils/streams`:

```typescript
// packages/utils/src/files/file-utils.ts
import { collect } from "../streams/index.js";
import type { FilesApi } from "./files-api.js";

/**
 * Read entire file content as Uint8Array.
 */
export async function readFile(files: FilesApi, path: string): Promise<Uint8Array> {
  return collect(files.read(path));
}

/**
 * Read entire file content as UTF-8 text.
 */
export async function readText(files: FilesApi, path: string): Promise<string> {
  const bytes = await collect(files.read(path));
  return new TextDecoder().decode(bytes);
}

/**
 * Read file or return undefined if not found.
 */
export async function tryReadFile(
  files: FilesApi,
  path: string
): Promise<Uint8Array | undefined> {
  try {
    return await collect(files.read(path));
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Read text file or return undefined if not found.
 */
export async function tryReadText(
  files: FilesApi,
  path: string
): Promise<string | undefined> {
  const bytes = await tryReadFile(files, path);
  return bytes ? new TextDecoder().decode(bytes) : undefined;
}

/**
 * Check if error is a "not found" error.
 */
export function isNotFoundError(error: unknown): boolean {
  if (error && typeof error === "object" && "code" in error) {
    return (error as { code: string }).code === "ENOENT";
  }
  return false;
}
```

#### Factory Functions

The factory functions wrap `@statewalker/webrun-files` classes:

```typescript
// packages/utils/src/files/mem-files-api.ts
import { FilesApi as WebrunFilesApi, MemFilesApi } from "@statewalker/webrun-files";
import type { FilesApi } from "./files-api.js";

export function createInMemoryFilesApi(
  initialFiles?: Record<string, string | Uint8Array>
): FilesApi {
  const memApi = new MemFilesApi();
  const files = new WebrunFilesApi(memApi);

  // Populate initial files if provided
  if (initialFiles) {
    for (const [path, content] of Object.entries(initialFiles)) {
      const data = typeof content === "string"
        ? new TextEncoder().encode(content)
        : content;
      // Use sync-style initialization or async IIFE
    }
  }

  return files;
}
```

```typescript
// packages/utils/src/files/node-files-api.ts
import { FilesApi as WebrunFilesApi, NodeFilesApi } from "@statewalker/webrun-files";
import type { FilesApi } from "./files-api.js";

export function createNodeFilesApi(options: {
  fs: typeof import("node:fs/promises");
  rootDir: string;
}): FilesApi {
  const nodeApi = new NodeFilesApi(options);
  return new WebrunFilesApi(nodeApi);
}
```

## Migration Plan

### Phase 1: Create files/ module in vcs-utils

1. Create `packages/utils/src/files/` directory structure
2. Define `FilesApi` interface in `files-api.ts`
3. Move `FileMode` from vcs-core to `file-mode.ts`
4. Implement path utilities (wrap webrun-files functions)
5. Implement factory functions
6. Export from `packages/utils/src/index.ts`

### Phase 2: Update vcs-core dependencies

1. Add `@statewalker/vcs-utils` dependency (already exists)
2. Update `packages/core/src/files/index.ts` to re-export from vcs-utils:

```typescript
// packages/core/src/files/index.ts
// Re-export everything from vcs-utils for backwards compatibility
export {
  type FilesApi,
  type FileInfo,
  type FileStats,
  FileMode,
  type FileModeValue,
  createInMemoryFilesApi,
  createNodeFilesApi,
  joinPath,
  basename,
  dirname,
} from "@statewalker/vcs-utils/files";
```

3. Update all imports in vcs-core to use `../files/index.js` or `@statewalker/vcs-utils/files`

### Phase 3: Update vcs-core source files

Files to update (change import from `@statewalker/webrun-files`):

| File | New Import |
|------|------------|
| `stores/create-repository.ts` | `import { type FilesApi, createInMemoryFilesApi, joinPath } from "@statewalker/vcs-utils/files"` |
| `binary/volatile-store.files.ts` | `import { type FilesApi, joinPath } from "@statewalker/vcs-utils/files"` |
| `binary/raw-store.files.ts` | `import { type FilesApi, dirname, joinPath } from "@statewalker/vcs-utils/files"` |
| `worktree/working-tree-iterator.impl.ts` | `import { type FileInfo, ... } from "../files/index.js"` |
| All refs/*.ts files | Already use `../files/index.js` - will work via re-export |

### Phase 3b: Replace `.readFile()` method calls with utility functions

All usages of `files.readFile(path)` must be replaced with `readFile(files, path)`.

**Files requiring updates:**

| File | Current Usage | New Usage |
|------|---------------|-----------|
| `staging/staging-store.files.ts:214` | `this.files.readFile(this.indexPath)` | `readFile(this.files, this.indexPath)` |
| `worktree/working-tree-iterator.impl.ts:290` | `this.files.readFile(fullPath)` | `readFile(this.files, fullPath)` |
| `worktree/working-tree-iterator.impl.ts:315` | `this.files.readFile(fullPath)` | `readFile(this.files, fullPath)` |
| `worktree/working-tree-iterator.impl.ts:327` | `this.files.readFile(gitignorePath)` | `readText(this.files, gitignorePath)` |
| `worktree/working-tree-iterator.impl.ts:377` | `this.files.readFile(excludePath)` | `readText(this.files, excludePath)` |
| `worktree/working-tree-iterator.impl.ts:397` | `this.files.readFile(excludesFilePath)` | `readText(this.files, excludesFilePath)` |
| `refs/packed-refs-reader.ts:51` | `files.readFile(packedRefsPath)` | `readFile(files, packedRefsPath)` |
| `refs/ref-reader.ts:70` | `files.readFile(refPath)` | `readFile(files, refPath)` |
| `refs/ref-writer.ts:183` | `files.readFile(refPath)` | `readFile(files, refPath)` |
| `pack/pack-directory.ts:432` | `this.files.readFile(idxPath)` | `readFile(this.files, idxPath)` |
| `pack/pack-consolidator.ts:209` | `this.files.readFile(packPath)` | `readFile(this.files, packPath)` |
| `utils/file-utils.ts:63` | `files.readFile(path)` | `readFile(files, path)` (or remove, now redundant) |

**Migration pattern:**

```typescript
// Before
const data = await this.files.readFile(path);
const text = new TextDecoder().decode(await this.files.readFile(path));

// After
import { readFile, readText } from "@statewalker/vcs-utils/files";

const data = await readFile(this.files, path);
const text = await readText(this.files, path);
```

**Note:** The `tryReadFile` in `packages/core/src/utils/file-utils.ts` becomes redundant and should be removed - use the one from `@statewalker/vcs-utils/files` instead.

### Phase 3c: Replace `FilesApi#open()` with `read()` + options

The `open()` method and `FileHandle` type are **removed** from the API. Random access is now provided by `read(path, { start, len })`.

**Current usage in `pack-reader.ts`:**

```typescript
// Current implementation with FileHandle
private handle: FileHandle | null = null;
private length = 0;

async open(): Promise<void> {
  this.handle = await this.files.open(this.packPath);
  this.length = this.handle.size;
  // ... validate header
}

async close(): Promise<void> {
  if (this.handle) {
    await this.handle.close();
    this.handle = null;
  }
}

private async read(buffer: Uint8Array, bufferOffset: number, length: number, position: number): Promise<number> {
  return this.handle.read(buffer, bufferOffset, length, position);
}
```

**New implementation using `read()` with options:**

```typescript
// New implementation - no FileHandle needed
private length = 0;
private initialized = false;

async open(): Promise<void> {
  if (this.initialized) return;

  // Get file size via stats()
  const stats = await this.files.stats(this.packPath);
  if (!stats) throw new Error(`Pack file not found: ${this.packPath}`);
  this.length = stats.size ?? 0;
  this.initialized = true;

  // ... validate header
}

async close(): Promise<void> {
  // No-op - no handle to close
  this.initialized = false;
}

private async read(buffer: Uint8Array, bufferOffset: number, length: number, position: number): Promise<number> {
  // Use read() with start/len options
  const stream = this.files.read(this.packPath, { start: position, len: length });

  let bytesRead = 0;
  for await (const chunk of stream) {
    buffer.set(chunk, bufferOffset + bytesRead);
    bytesRead += chunk.length;
  }
  return bytesRead;
}
```

**Benefits of this approach:**

1. **Simpler API** - No `open()` method or `FileHandle` type needed
2. **Stateless** - Each read is independent, no file handle to manage
3. **Consistent** - Same `read()` method for both sequential and random access
4. **Resource-safe** - No file handles to leak if `close()` is forgotten

**Utility functions for random access reads:**

The `@statewalker/vcs-utils/streams` module already has `readBlock()` which reads a fixed-length block from a stream:

```typescript
// Already exists in packages/utils/src/streams/read-header.ts
/**
 * Reads a fixed-length block from an async iterable stream.
 * @param input The input async iterable stream
 * @param len Number of bytes to read
 * @returns A Uint8Array containing exactly len bytes
 */
export async function readBlock(
  input: AsyncIterable<Uint8Array>,
  len: number,
): Promise<Uint8Array>;
```

Add to `@statewalker/vcs-utils/files`:

```typescript
// packages/utils/src/files/file-utils.ts
import { readBlock } from "../streams/index.js";
import type { FilesApi } from "./files-api.js";

/**
 * Read bytes at specific position into buffer.
 * Replaces FileHandle.read() pattern.
 *
 * Uses readBlock() from streams internally.
 */
export async function readAt(
  files: FilesApi,
  path: string,
  buffer: Uint8Array,
  bufferOffset: number,
  length: number,
  position: number
): Promise<number> {
  // Use read() with position, then readBlock() to get exact bytes
  const data = await readBlock(files.read(path, { start: position, len: length }), length);
  buffer.set(data, bufferOffset);
  return data.length;
}

/**
 * Read bytes at specific position, returning new Uint8Array.
 * Simpler alternative when you don't need to write into existing buffer.
 *
 * Uses readBlock() from streams internally.
 */
export async function readRange(
  files: FilesApi,
  path: string,
  position: number,
  length: number
): Promise<Uint8Array> {
  return readBlock(files.read(path, { start: position, len: length }), length);
}
```

**Note:** Reuses existing `readBlock()` from `@statewalker/vcs-utils/streams` which handles chunked stream reading into a fixed-size buffer.

**Existing stream utilities in `@statewalker/vcs-utils/streams`:**
| Function | Purpose |
|----------|---------|
| `readBlock(input, len)` | Read exactly `len` bytes from stream into new buffer |
| `readHeader(input, getHeaderEnd, maxLength)` | Read variable-length header with delimiter |
| `readAhead(input, getHeaderEnd, maxLength)` | Read header and return combined stream |
| `collect(input)` | Collect entire stream into single Uint8Array |

**Files requiring `.open()` → `read()` migration:**

| File | Change |
|------|--------|
| `pack/pack-reader.ts` | Remove `FileHandle`, use `stats()` for size, use `readAt()` for random reads |

### Phase 4: Update Tests

Update test imports:

```typescript
// Before
import { FilesApi, MemFilesApi } from "@statewalker/webrun-files";
const files = new FilesApi(new MemFilesApi());

// After
import { createInMemoryFilesApi } from "@statewalker/vcs-utils/files";
const files = createInMemoryFilesApi();

// Or with initial files
const files = createInMemoryFilesApi({
  "/test/file.txt": "content",
  "/test/binary.bin": new Uint8Array([1, 2, 3]),
});
```

### Phase 5: Update Apps

Update app imports:

```typescript
// Before
import { FilesApi, NodeFilesApi } from "@statewalker/webrun-files";
const files = new FilesApi(new NodeFilesApi({ fs, rootDir }));

// After
import { createNodeFilesApi } from "@statewalker/vcs-utils/files";
const files = createNodeFilesApi({ fs, rootDir });
```

### Phase 6: Remove webrun-files from vcs-core

1. Remove `@statewalker/webrun-files` from `packages/core/package.json` dependencies
2. Verify all tests pass
3. Verify all apps work

## Files Requiring Updates

### vcs-utils (new files)

- `packages/utils/src/files/index.ts` - Main exports
- `packages/utils/src/files/files-api.ts` - FilesApi interface, ReadOptions
- `packages/utils/src/files/file-info.ts` - FileInfo, FileStats types
- `packages/utils/src/files/file-mode.ts` - FileMode constants
- `packages/utils/src/files/path-utils.ts` - joinPath, basename, dirname
- `packages/utils/src/files/file-utils.ts` - readFile, readText, tryReadFile, tryReadText, readAt, readRange, isNotFoundError
- `packages/utils/src/files/mem-files-api.ts` - createInMemoryFilesApi factory
- `packages/utils/src/files/node-files-api.ts` - createNodeFilesApi factory
- `packages/utils/src/index.ts` - Add files export
- `packages/utils/package.json` - Add webrun-files dependency

### vcs-core (updates)

**Files to modify:**
- `packages/core/src/files/index.ts` - Re-export from vcs-utils
- `packages/core/src/files/file-mode.ts` - Delete (moved to vcs-utils)
- `packages/core/src/stores/create-repository.ts` - Update imports
- `packages/core/src/binary/volatile-store.files.ts` - Update imports
- `packages/core/src/binary/raw-store.files.ts` - Update imports
- `packages/core/package.json` - Remove webrun-files dependency

**Files requiring `.readFile()` → `readFile()` migration:**
- `packages/core/src/staging/staging-store.files.ts` - Add import, replace method call
- `packages/core/src/worktree/working-tree-iterator.impl.ts` - Add imports, replace 5 method calls
- `packages/core/src/refs/packed-refs-reader.ts` - Add import, replace method call
- `packages/core/src/refs/ref-reader.ts` - Add import, replace method call
- `packages/core/src/refs/ref-writer.ts` - Add import, replace method call
- `packages/core/src/pack/pack-directory.ts` - Add import, replace method call
- `packages/core/src/pack/pack-consolidator.ts` - Add import, replace method call
- `packages/core/src/utils/file-utils.ts` - Remove redundant `tryReadFile`, re-export from vcs-utils

**Files requiring `.open()` → `read()` migration:**
- `packages/core/src/pack/pack-reader.ts` - Remove `FileHandle` import, use `stats()` + `readAt()`

### Tests (import updates)

All test files in `packages/core/tests/` that import from `@statewalker/webrun-files`

### Apps (import updates)

All apps that import from `@statewalker/webrun-files`

## Benefits

1. **Single source of truth** - All external interfaces in vcs-utils
2. **Clean abstraction** - Factory functions hide implementation details
3. **Testability** - `createInMemoryFilesApi({ files })` makes test setup trivial
4. **Consistency** - Same pattern as compression (`setCompression`, `createNodeCompression`)
5. **Encapsulation** - `@statewalker/webrun-files` becomes an implementation detail
6. **Future flexibility** - Easy to swap implementations without API changes

## Verification Checklist

After implementation:

- [ ] `pnpm build` succeeds for all packages
- [ ] `pnpm test` passes for all packages
- [ ] No imports from `@statewalker/webrun-files` in vcs-core source
- [ ] No imports from `@statewalker/webrun-files` in tests (use vcs-utils)
- [ ] No `.readFile()` method calls in library code (use `readFile(files, path)` utility)
- [ ] No `.open()` method calls or `FileHandle` usage (use `readAt()` utility)
- [ ] All apps use `createNodeFilesApi` from vcs-utils
- [ ] TypeScript types are correctly exported
- [ ] JSDoc comments on all public API

## Summary

Moving Files API to `@statewalker/vcs-utils` aligns with the package's purpose as the interface layer with the external world. The factory pattern (`createInMemoryFilesApi`, `createNodeFilesApi`) provides a cleaner API than direct class instantiation and better encapsulates the `@statewalker/webrun-files` dependency.

Key changes:
1. **New module**: `@statewalker/vcs-utils/files`
2. **Factory functions** instead of class exports
3. **Interface-based** - all code depends on `FilesApi` interface
4. **webrun-files becomes internal** - only vcs-utils depends on it
5. **`readFile()` removed from interface** - replaced with utility functions:
   - `readFile(files, path)` - read entire file as Uint8Array
   - `readText(files, path)` - read entire file as string
   - `tryReadFile(files, path)` - read or return undefined
   - `tryReadText(files, path)` - read text or return undefined
6. **Enhanced `read()` method** - supports `{ start, len, signal }` options for partial reads
7. **`open()` and `FileHandle` removed** - random access via `read()` with options:
   - `readAt(files, path, buffer, bufferOffset, length, position)` - read into buffer at position
   - File size obtained via `stats(path).size`
