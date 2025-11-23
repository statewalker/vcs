# Patch Module

The patch module provides comprehensive support for parsing and applying Git patches, including both text and binary patches.

## Overview

This module is based on [JGit's patch handling implementation](https://github.com/eclipse-jgit/jgit), specifically `org.eclipse.jgit.patch.Patch`, `FileHeader`, `BinaryHunk`, and `Base85`. When you run `git diff` and save the output, this module reads that file and understands what changed.

## Patch Parsing

Think of a patch as a recipe for transforming one file into another. When you save a `git diff` output, Git creates either a unified diff (`diff -u`), an extended Git diff (`diff --git`), a binary patch (`GIT binary patch`), or a combined diff (`diff --cc`). This module reads all these formats.

### Binary Patch Formats

Git supports two ways to encode binary changes. Delta patches store changes as copy and insert operations, similar to how rsync works:

```
GIT binary patch
delta 14
<base85-encoded delta instructions>

delta 12
<base85-encoded old size>
```

Each operation either copies N bytes from the source at offset X, or inserts N literal bytes. This works well when files have small changes.

Literal patches take a different approach—they store the complete file content, compressed with zlib and encoded in base85:

```
GIT binary patch
literal 5389
<base85-encoded compressed data>

literal 1629
<base85-encoded old compressed data>
```

This format makes sense when the delta would be larger than just storing the new file.

### Base85 Encoding

Git uses a modified base85 encoding (RFC 1924 variant) for binary patches. The character set spans `0-9A-Za-z!#$%&()*+-;<=>?@^_`{|}~`, giving you 85 possible values per character instead of base64's 64.

Each line starts with a length character where `A` means 1 byte, `B` means 2 bytes, and so on. Then come groups of 5 encoded characters representing 4 bytes of data. Lines end with newlines. This encoding packs data more efficiently than base64 while staying readable in text files.

The implementation follows Git's [base85.c](https://github.com/git/git/blob/master/base85.c) and JGit's [Base85.java](https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit/src/org/eclipse/jgit/util/Base85.java).

## Key Components

### Patch

The Patch class is your entry point for reading Git patch files. Based on JGit's `Patch.java`, it parses the patch content and gives you access to file changes and any parsing errors:

```typescript
import { Patch } from '@webrun-vcs/diff';

const patch = new Patch();
const buffer = new TextEncoder().encode(patchContent);
patch.parse(buffer);

const files = patch.getFiles();
const errors = patch.getErrors();
```

### FileHeader

Each file change in a patch becomes a FileHeader. Based on JGit's `FileHeader.java`, it captures the old and new file paths, file modes, the change type (ADD, DELETE, MODIFY, RENAME, or COPY), object IDs as SHA hashes, and all the hunks that describe the actual changes.

### BinaryHunk

When a patch includes binary data, BinaryHunk represents those chunks. Based on JGit's `BinaryHunk.java`, it handles both delta format (using delta compression) and literal format (storing full content).

### PatchApplier

Once you've parsed a patch, PatchApplier takes care of applying it to your files. You provide functions to read and write files, and it handles the rest:

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

Behind the scenes, the module uses low-level utilities based on JGit's `RawParseUtils.java` for parsing patch files. These handle pattern matching with `match()`, finding line feeds with `nextLF()` and `prevLF()`, parsing decimal numbers via `parseBase10()`, and converting between UTF-8 and ASCII.

### Cryptographic Operations

Git identifies objects by their hash. This module computes SHA-1 and SHA-256 hashes, and can generate Git object IDs:

```typescript
import { sha1, sha256, gitObjectHash } from '@webrun-vcs/diff';

// Compute SHA-1 hash
const hash = await sha1(data);

// Compute Git object ID
const oid = await gitObjectHash('blob', data);
```

The implementation works across environments using Node.js's `crypto` module (`NodeCryptoProvider`) or the Web's `SubtleCrypto` API (`WebCryptoProvider`).

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

While closely following JGit's implementation, this TypeScript version brings modern JavaScript async patterns with async/await support. Compression and crypto operations work through pluggable providers, letting you run the same code in Node.js and Web environments.

TypeScript types provide full type safety throughout. Instead of Java exceptions, the module uses Result types for simplified error handling. Modern JavaScript features like ES modules and Uint8Array replace Java's byte arrays.

## Testing

The module is tested against [JGit's test data](https://github.com/eclipse-jgit/jgit/tree/master/org.eclipse.jgit.test/tst-rsrc/org/eclipse/jgit/diff) to ensure compatibility with Git's binary patch format. Tests cover file loading and validation, patch parsing for both delta and literal formats, base85 encoding and decoding, delta application to binary data, data integrity verification, and format compliance.

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
