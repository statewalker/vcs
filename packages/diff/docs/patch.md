# Patch Module

The patch module provides comprehensive support for parsing and applying Git patches, including both text and binary patches.

## Overview

This module is based on [JGit's patch handling implementation](https://github.com/eclipse-jgit/jgit), specifically:
- `org.eclipse.jgit.patch.Patch`
- `org.eclipse.jgit.patch.FileHeader`
- `org.eclipse.jgit.patch.BinaryHunk`
- `org.eclipse.jgit.util.Base85`

## Features

### Patch Parsing

Supports multiple patch formats:
- **Unified diff** (`diff -u`)
- **Git extended diff** (`diff --git`)
- **Binary patches** (`GIT binary patch`)
- **Combined diff** (`diff --cc`)

### Binary Patch Formats

Git supports two binary patch formats, both implemented in this module:

#### 1. Delta Format

Delta patches encode changes as copy/insert operations, similar to rsync:

```
GIT binary patch
delta 14
<base85-encoded delta instructions>

delta 12
<base85-encoded old size>
```

**Operations:**
- **Copy**: Copy N bytes from source at offset X
- **Insert**: Insert N literal bytes

#### 2. Literal Format

Literal patches contain the complete file content, zlib-compressed and base85-encoded:

```
GIT binary patch
literal 5389
<base85-encoded compressed data>

literal 1629
<base85-encoded old compressed data>
```

### Base85 Encoding

Git uses a modified base85 encoding (RFC 1924 variant) for binary patches:

**Character set**: `0-9A-Za-z!#$%&()*+-;<=>?@^_`{|}~`

**Format**:
- Each line starts with a length character: `A` = 1 byte, `B` = 2 bytes, etc.
- 5 encoded characters represent 4 bytes of data
- Lines are newline terminated

**Implementation based on**:
- Git's [base85.c](https://github.com/git/git/blob/master/base85.c)
- JGit's [Base85.java](https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit/src/org/eclipse/jgit/util/Base85.java)

## Key Components

### Patch

Entry point for parsing Git patch files.

```typescript
import { Patch } from '@webrun-vcs/diff';

const patch = new Patch();
const buffer = new TextEncoder().encode(patchContent);
patch.parse(buffer);

const files = patch.getFiles();
const errors = patch.getErrors();
```

**Based on**: JGit's `Patch.java`

### FileHeader

Represents a single file change in a patch, containing:
- Old and new file paths
- File modes
- Change type (ADD, DELETE, MODIFY, RENAME, COPY)
- Object IDs (SHA hashes)
- Hunks (text or binary)

**Based on**: JGit's `FileHeader.java`

### BinaryHunk

Represents a binary hunk in a patch, supporting:
- Delta format (delta compression)
- Literal format (full content)

**Based on**: JGit's `BinaryHunk.java`

### PatchApplier

Applies patches to files:

```typescript
import { PatchApplier } from '@webrun-vcs/diff';

const applier = new PatchApplier();
const result = await applier.applyPatch(
  patch,
  async (path) => readFile(path),
  async (path, content) => writeFile(path, content)
);
```

### Buffer Utilities

Low-level utilities for parsing patch files:
- `match()` - Pattern matching
- `nextLF()` - Find next line feed
- `prevLF()` - Find previous line feed
- `parseBase10()` - Parse decimal numbers
- `decode()` - UTF-8 decoding
- `encodeASCII()` - ASCII encoding

**Based on**: JGit's `RawParseUtils.java`

### Cryptographic Operations

Git object hashing and checksums:

```typescript
import { sha1, sha256, gitObjectHash } from '@webrun-vcs/diff';

// Compute SHA-1 hash
const hash = await sha1(data);

// Compute Git object ID
const oid = await gitObjectHash('blob', data);
```

Supports multiple backends:
- **Node.js**: `crypto` module (`NodeCryptoProvider`)
- **Web**: `SubtleCrypto` API (`WebCryptoProvider`)

## Types

### ChangeType

```typescript
enum ChangeType {
  ADD,      // New file added
  DELETE,   // File deleted
  MODIFY,   // File modified
  RENAME,   // File renamed
  COPY      // File copied
}
```

### PatchType

```typescript
enum PatchType {
  UNIFIED,   // Unified diff format
  BINARY,    // Binary patch
  GIT_BINARY // Git binary patch (delta or literal)
}
```

### BinaryHunkType

```typescript
enum BinaryHunkType {
  LITERAL_DEFLATED,  // Literal format with zlib compression
  DELTA_DEFLATED     // Delta format with zlib compression
}
```

## Differences from JGit

While closely following JGit's implementation, this TypeScript version includes:

1. **Async/await support** - Modern JavaScript async patterns
2. **Pluggable compression** - Support for both Node.js and Web environments
3. **Pluggable crypto** - Support for both Node.js crypto and Web Crypto API
4. **TypeScript types** - Full type safety
5. **Simplified error handling** - Using Result types instead of exceptions
6. **Modern JavaScript** - ES modules, Uint8Array instead of byte arrays

## Testing

The module is tested against [JGit's test data](https://github.com/eclipse-jgit/jgit/tree/master/org.eclipse.jgit.test/tst-rsrc/org/eclipse/jgit/diff) to ensure compatibility with Git's binary patch format.

Test coverage includes:
- File loading and validation
- Patch parsing (delta and literal formats)
- Base85 encoding/decoding
- Delta application to binary data
- Data integrity verification
- Format compliance

## Usage Example

```typescript
import { Patch, PatchApplier } from '@webrun-vcs/diff';

// Parse a patch file
const patchContent = await readFile('changes.patch', 'utf-8');
const patch = new Patch();
patch.parse(new TextEncoder().encode(patchContent));

// Check for errors
if (patch.getErrors().length > 0) {
  console.error('Parse errors:', patch.getErrors());
}

// Apply the patch
const applier = new PatchApplier();
const result = await applier.applyPatch(
  patch,
  async (path) => readFile(path),
  async (path, content) => writeFile(path, content)
);

console.log(`Applied ${result.filesChanged} file changes`);
```

## References

- [JGit Patch Package](https://github.com/eclipse-jgit/jgit/tree/master/org.eclipse.jgit/src/org/eclipse/jgit/patch)
- [Git Binary Patch Format](https://git-scm.com/docs/git-apply#_options)
- [Git Base85 Implementation](https://github.com/git/git/blob/master/base85.c)
- [RFC 1924 - Base85 Encoding](https://tools.ietf.org/html/rfc1924)
