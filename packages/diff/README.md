# @webrun-vcs/diff

A comprehensive TypeScript library for text and binary diff operations, Git patch parsing/application, and delta compression.

## Features

When you need to track changes between file versions, this library gives you the tools to compare text line-by-line using the Myers diff algorithm, compress binary files with efficient delta encoding, and parse Git patches in both unified and binary formats. The implementation works across Node.js and browser environments with full TypeScript support, building on battle-tested algorithms from [JGit](https://github.com/eclipse-jgit/jgit).

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

This library consists of four main modules that work together to handle file differences and compression.

### Text Diff Module

The Text Diff module implements the Myers diff algorithm for computing differences between sequences. Based on JGit's `org.eclipse.jgit.diff` package, it handles O(ND) diff operations through `MyersDiff`, edit operations via `Edit`, sequence abstractions with `Sequence`, and text line sequences using `RawText`.

You can compare files line-by-line or byte-by-byte with various whitespace handling options. The bidirectional search approach keeps memory usage at O(N) instead of O(N²), while edit normalization ensures consistent output. Read more in the [Text Diff Documentation](docs/text-diff.md).

### Patch Module

When you run `git diff` and get a patch file, this module parses and applies it. Building on JGit's patch handling (`org.eclipse.jgit.patch.Patch`, `FileHeader`, `BinaryHunk`, and `Base85`), it understands unified diff format, Git's extended diff format, and both delta and literal binary patches.

The module handles Base85 encoding and decoding, applies patches with conflict detection, and works with the same formats Git uses. See the [Patch Documentation](docs/patch.md) to learn how patch parsing works.

### Delta Module

Binary delta compression minimizes storage by encoding only what changed between file versions. Drawing inspiration from [Fossil SCM](https://fossil-scm.org/)'s delta format, rsync's rolling checksum algorithm, and JGit's delta encoding, this module gives you Git-compatible binary deltas.

You can configure block sizes, choose between multiple delta algorithms, and use rolling checksums for fast block matching. The module encodes and decodes Fossil delta format while maintaining compatibility with Git's binary delta format. The [Delta Documentation](docs/delta.md) explains how delta compression works.

### Compression Module

The Compression module provides a unified interface across JavaScript environments. Unlike the other modules, this one doesn't come from JGit—it's a custom abstraction layer.

In Node.js, it uses the `zlib` module. In browsers, it leverages the Compression Streams API. You can also plug in custom providers. The module auto-detects your environment and picks the right implementation. Check the [Compression Documentation](docs/compression.md) for environment-specific setup.

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

While closely following JGit's algorithms and structure, this TypeScript implementation brings modern JavaScript features like ES modules, Uint8Array, and async/await. You can run it in both Node.js and browsers thanks to pluggable compression and crypto providers.

The TypeScript type system gives you full type safety throughout. Instead of Java exceptions, the library uses Result types for functional error handling. Beyond the core JGit features, you'll find extras like binary sequence comparison and delta utilities.

## Compatibility

### Git Compatibility

This library speaks Git's native formats. When you generate patches, they match Git's unified diff format. Binary patches work with both delta and literal encodings, base85 follows Git's spec, and object hashing supports SHA-1 and SHA-256.

Testing against [JGit's test suite](https://github.com/eclipse-jgit/jgit/tree/master/org.eclipse.jgit.test/tst-rsrc/org/eclipse/jgit/diff) ensures compatibility with real Git operations.

### Environment Support

You'll need Node.js 16.x or higher for server-side use. In browsers, ES2020 support is required. The WebCompressionProvider relies on the Compression Streams API—if your target browsers lack it, you can plug in a custom provider using pako or fflate.

TypeScript users need version 4.5 or higher. Full type definitions ship with the package.

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

On a modern system, you can expect text diffs to process around 100 MB/s for typical source files. Binary delta creation runs at 50-100 MB/s depending on how similar the files are, while applying deltas reaches 200-300 MB/s. Patch parsing handles 50-100 MB/s.

### Optimization Tips

Choose your comparators carefully—different whitespace handling modes affect both accuracy and speed. For delta operations, larger blocks give you better performance while smaller blocks improve compression ratios. The MyersDiff algorithm automatically uses HashedSequence for better performance, so you get this optimization without extra work.

When dealing with files over 100MB, consider chunking your input. Balance compression level against speed—higher levels compress better but take longer.

## Testing

This library includes comprehensive tests validated against JGit's test data. Run all tests with `pnpm test`, or target specific suites using `pnpm test text-diff`, `pnpm test patch`, or `pnpm test delta`. JGit compatibility tests run via `pnpm test jgit`.

The test suite covers JGit's binary patch test data, validates Git compatibility, handles edge cases and errors, and includes performance benchmarks.

## Contributing

Contributions are welcome! Before submitting, make sure tests pass with `pnpm test`, code is formatted using `pnpm format`, types compile via `pnpm build`, and JGit compatibility remains intact.

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
