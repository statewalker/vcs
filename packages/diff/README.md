# @webrun-vcs/diff

A comprehensive TypeScript library for text and binary diff operations, Git patch parsing/application, and delta compression.

## Features

- **Text Diff** - Myers diff algorithm for line-by-line comparison
- **Binary Delta** - Efficient delta compression for binary files
- **Git Patches** - Parse and apply Git unified and binary patches
- **Cross-Platform** - Works in Node.js and browsers
- **Type-Safe** - Full TypeScript support
- **JGit Compatible** - Based on battle-tested [JGit](https://github.com/eclipse-jgit/jgit) implementations

## Installation

```bash
npm install @webrun-vcs/diff
```

## Quick Start

### Text Diff

```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';

const oldText = new RawText(Buffer.from('line1\nline2\nline3\n'));
const newText = new RawText(Buffer.from('line1\nmodified\nline3\n'));

const edits = MyersDiff.diff(RawTextComparator.DEFAULT, oldText, newText);

for (const edit of edits) {
  console.log(`${edit.getType()}: A[${edit.beginA}:${edit.endA}] -> B[${edit.beginB}:${edit.endB}]`);
}
```

### Binary Delta

```typescript
import { createDelta, applyDelta } from '@webrun-vcs/diff';

const source = new Uint8Array([0, 1, 2, 3, 4, 5]);
const target = new Uint8Array([0, 1, 99, 4, 5]);

// Create delta
const delta = createDelta(source, target);
console.log(`Compressed ${target.length} bytes to ${delta.length} bytes`);

// Apply delta
const reconstructed = applyDelta(source, delta);
```

### Git Patch

```typescript
import { Patch, PatchApplier } from '@webrun-vcs/diff';

// Parse patch
const patch = new Patch();
patch.parse(new TextEncoder().encode(patchContent));

// Apply patch
const applier = new PatchApplier();
const result = await applier.applyPatch(
  patch,
  async (path) => readFile(path),
  async (path, content) => writeFile(path, content)
);
```

## Documentation

Detailed documentation for each module:

- **[Text Diff](docs/text-diff.md)** - Myers diff algorithm, Edit operations, Sequence comparison
- **[Patch](docs/patch.md)** - Git patch parsing, Binary patches, Base85 encoding
- **[Delta](docs/delta.md)** - Binary delta compression, Rolling checksums, Fossil format
- **[Compression](docs/compression.md)** - Cross-platform compression abstraction

## Architecture

This library consists of four main modules:

### 1. Text Diff Module

Implements the Myers diff algorithm for computing differences between sequences.

**Based on JGit**:
- `org.eclipse.jgit.diff.MyersDiff` - O(ND) diff algorithm
- `org.eclipse.jgit.diff.Edit` - Edit operations
- `org.eclipse.jgit.diff.Sequence` - Sequence abstraction
- `org.eclipse.jgit.diff.RawText` - Text line sequences

**Key features**:
- Line-by-line or byte-by-byte comparison
- Whitespace handling options
- Bidirectional search for O(N) space complexity
- Edit normalization

See [Text Diff Documentation](docs/text-diff.md) for details.

### 2. Patch Module

Parses and applies Git patches, including binary patches.

**Based on JGit**:
- `org.eclipse.jgit.patch.Patch` - Patch parser
- `org.eclipse.jgit.patch.FileHeader` - File metadata
- `org.eclipse.jgit.patch.BinaryHunk` - Binary hunks
- `org.eclipse.jgit.util.Base85` - Base85 encoding

**Key features**:
- Unified diff format
- Git extended diff format
- Binary patches (delta and literal)
- Base85 encoding/decoding
- Patch application with conflict detection

See [Patch Documentation](docs/patch.md) for details.

### 3. Delta Module

Binary delta compression for efficient storage and transmission.

**Inspired by**:
- [Fossil SCM](https://fossil-scm.org/) delta format
- rsync rolling checksum algorithm
- JGit's delta encoding (for Git compatibility)

**Key features**:
- Rolling checksum for fast block matching
- Multiple delta algorithms
- Fossil delta format encoding/decoding
- Git binary delta compatibility
- Configurable block sizes

See [Delta Documentation](docs/delta.md) for details.

### 4. Compression Module

Cross-platform compression abstraction.

**Custom implementation** (not based on JGit):
- Node.js `zlib` support
- Web Compression Streams API support
- Pluggable provider interface
- Auto-detection

See [Compression Documentation](docs/compression.md) for details.

## JGit Attribution

This library is based on several components from the [Eclipse JGit project](https://github.com/eclipse-jgit/jgit):

### Used JGit Modules

- **`org.eclipse.jgit.diff`** - Diff algorithm implementation
  - `MyersDiff.java` - Myers O(ND) algorithm
  - `Edit.java`, `EditList.java` - Edit operations
  - `Sequence.java`, `SequenceComparator.java` - Sequence abstraction
  - `RawText.java`, `RawTextComparator.java` - Text sequences
  - `HashedSequence.java` - Performance optimization

- **`org.eclipse.jgit.patch`** - Patch parsing and application
  - `Patch.java` - Main patch parser
  - `FileHeader.java` - File metadata
  - `HunkHeader.java` - Hunk metadata
  - `BinaryHunk.java` - Binary patch hunks

- **`org.eclipse.jgit.util`** - Utilities
  - `Base85.java` - Git's base85 encoding
  - `RawParseUtils.java` - Buffer parsing utilities

### JGit License

JGit is licensed under the Eclipse Distribution License v1.0 (BSD-3-Clause).

Copyright (C) 2008-2023, Eclipse Foundation, Inc. and its contributors.

### Differences from JGit

While closely following JGit's algorithms and structure, this TypeScript implementation includes:

1. **Modern JavaScript/TypeScript** - ES modules, Uint8Array, async/await
2. **Cross-platform** - Works in both Node.js and browsers
3. **Pluggable backends** - Compression and crypto providers
4. **Type safety** - Full TypeScript type system
5. **Result types** - Functional error handling instead of exceptions
6. **Additional features** - Binary sequence comparison, delta utilities

## Compatibility

### Git Compatibility

This library is compatible with Git's patch and delta formats:
- Git unified diff format
- Git binary patch format (delta and literal)
- Git base85 encoding
- Git object hashing (SHA-1, SHA-256)

Validated against [JGit's test suite](https://github.com/eclipse-jgit/jgit/tree/master/org.eclipse.jgit.test/tst-rsrc/org/eclipse/jgit/diff).

### Environment Support

- **Node.js**: 16.x or higher
- **Browsers**: Modern browsers with ES2020 support
  - Compression Streams API required for WebCompressionProvider
  - Alternative: Use custom provider with polyfill (e.g., pako, fflate)

### TypeScript

- TypeScript 4.5 or higher
- Full type definitions included

## API Reference

### Main Exports

```typescript
// Text diff
export {
  MyersDiff,
  Edit, EditList, EditType,
  Sequence, SequenceComparator,
  RawText, RawTextComparator,
  BinarySequence, ByteLevelComparator,
  HashedSequence
} from '@webrun-vcs/diff';

// Patch
export {
  Patch, PatchApplier,
  FileHeader, HunkHeader, BinaryHunk,
  ChangeType, PatchType, BinaryHunkType,
  encodeGitBase85, decodeGitBase85,
  encodeGitBinaryDelta, decodeGitBinaryDelta
} from '@webrun-vcs/diff';

// Delta
export {
  createDelta, applyDelta,
  createDeltaRanges, createFossilLikeRanges,
  buildSourceIndex,
  encodeDeltaBlocks, decodeDeltaBlocks
} from '@webrun-vcs/diff';

// Compression
export {
  getDefaultCompressionProvider,
  setDefaultCompressionProvider,
  NodeCompressionProvider,
  WebCompressionProvider,
  CompressionAlgorithm
} from '@webrun-vcs/diff';

// Common utilities
export {
  Result, ok, err,
  isOk, isErr,
  unwrap, unwrapOr
} from '@webrun-vcs/diff';
```

## Examples

### Compare Two Files

```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';
import { readFile } from 'fs/promises';

const oldContent = await readFile('old.txt');
const newContent = await readFile('new.txt');

const oldText = new RawText(oldContent);
const newText = new RawText(newContent);

const edits = MyersDiff.diff(RawTextComparator.DEFAULT, oldText, newText);

console.log(`Found ${edits.length} changes`);
```

### Parse and Apply Patch

```typescript
import { Patch, PatchApplier } from '@webrun-vcs/diff';
import { readFile, writeFile } from 'fs/promises';

const patchContent = await readFile('changes.patch', 'utf-8');

const patch = new Patch();
patch.parse(new TextEncoder().encode(patchContent));

if (patch.getErrors().length > 0) {
  console.error('Parse errors:', patch.getErrors());
  process.exit(1);
}

const applier = new PatchApplier();
const result = await applier.applyPatch(
  patch,
  async (path) => readFile(path),
  async (path, content) => writeFile(path, content)
);

console.log(`Applied ${result.filesChanged} changes`);
```

### Create Binary Delta

```typescript
import { createDelta, applyDelta } from '@webrun-vcs/diff';
import { readFile, writeFile } from 'fs/promises';

const source = await readFile('image-v1.png');
const target = await readFile('image-v2.png');

const delta = createDelta(source, target);

console.log(`Original: ${target.length} bytes`);
console.log(`Delta: ${delta.length} bytes`);
console.log(`Compression: ${((1 - delta.length / target.length) * 100).toFixed(1)}%`);

// Save delta
await writeFile('image.delta', delta);

// Later, reconstruct target
const savedDelta = await readFile('image.delta');
const reconstructed = applyDelta(source, savedDelta);
```

### Whitespace Handling

```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';

const a = new RawText(Buffer.from('  line1\n  line2\n'));
const b = new RawText(Buffer.from('line1\nline2\n'));

// Default: whitespace matters
const editsDefault = MyersDiff.diff(RawTextComparator.DEFAULT, a, b);
console.log(`Default: ${editsDefault.length} changes`);

// Ignore all whitespace
const editsIgnoreWS = MyersDiff.diff(RawTextComparator.WS_IGNORE_ALL, a, b);
console.log(`Ignore WS: ${editsIgnoreWS.length} changes`);
```

## Performance

### Benchmarks

Typical performance on a modern system:

- **Text diff**: ~100 MB/s for typical source files
- **Binary delta creation**: ~50-100 MB/s depending on similarity
- **Delta application**: ~200-300 MB/s
- **Patch parsing**: ~50-100 MB/s

### Optimization Tips

1. **Use appropriate comparators** - Choose whitespace handling carefully
2. **Configure block size** - Larger blocks for better performance, smaller for better compression
3. **Leverage HashedSequence** - Automatically used by MyersDiff for performance
4. **Stream large files** - For files >100MB, consider chunking
5. **Compression level** - Balance speed vs. compression ratio

## Testing

This library includes comprehensive tests validated against JGit's test data:

```bash
# Run all tests
pnpm test

# Run specific test suite
pnpm test text-diff
pnpm test patch
pnpm test delta

# Run JGit compatibility tests
pnpm test jgit
```

Test coverage includes:
- JGit binary patch test data
- Git compatibility validation
- Edge cases and error handling
- Performance benchmarks

## Contributing

Contributions are welcome! Please ensure:

1. Tests pass: `pnpm test`
2. Code is formatted: `pnpm format`
3. Types are correct: `pnpm build`
4. JGit compatibility is maintained

## License

This project is licensed under the [Eclipse Distribution License v1.0](LICENSE) (BSD-3-Clause), the same license as JGit.

## References

### JGit

- [JGit Repository](https://github.com/eclipse-jgit/jgit)
- [JGit Documentation](https://wiki.eclipse.org/JGit)
- [Eclipse Distribution License](https://www.eclipse.org/org/documents/edl-v10.php)

### Algorithms

- [Myers' Diff Algorithm Paper](http://www.xmailserver.org/diff2.pdf)
- [Fossil Delta Format](https://fossil-scm.org/home/doc/trunk/www/delta_format.wiki)
- [rsync Algorithm](https://rsync.samba.org/tech_report/)

### Git

- [Git Documentation](https://git-scm.com/docs)
- [Git Binary Patch Format](https://git-scm.com/docs/git-apply#_options)
- [Git Pack Format](https://git-scm.com/docs/pack-format)
- [Git Base85 Implementation](https://github.com/git/git/blob/master/base85.c)

### Compression

- [Deflate (RFC 1951)](https://tools.ietf.org/html/rfc1951)
- [Compression Streams API](https://developer.mozilla.org/en-US/docs/Web/API/Compression_Streams_API)
