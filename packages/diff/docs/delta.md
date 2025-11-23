# Delta Module

The delta module provides binary delta compression for efficient storage and transmission of binary data changes.

## Overview

This module implements delta compression inspired by [Fossil SCM](https://fossil-scm.org/home/doc/trunk/www/delta_format.wiki) and rsync, with features compatible with Git's binary delta format.

**Key inspirations**:
- Fossil's delta format
- rsync's rolling checksum algorithm
- Git's binary delta encoding (from JGit)

## Features

### Delta Compression

Creates compact binary deltas representing changes between two files:

```typescript
import { createDelta } from '@webrun-vcs/diff';

const source = new Uint8Array([...]); // Old version
const target = new Uint8Array([...]); // New version

const delta = createDelta(source, target);
console.log(`Compressed ${target.length} bytes to ${delta.length} bytes`);
```

### Delta Application

Applies a delta to reconstruct the target:

```typescript
import { applyDelta } from '@webrun-vcs/diff';

const source = new Uint8Array([...]); // Original
const delta = new Uint8Array([...]);  // Delta

const result = applyDelta(source, delta);
// result now contains the reconstructed target
```

### Multiple Delta Algorithms

Two algorithms for generating delta ranges:

1. **`createDeltaRanges`** - Optimized for typical binary files
2. **`createFossilLikeRanges`** - Fossil-style with configurable block size

## Key Concepts

### Delta Ranges

A delta is encoded as a sequence of operations:

```typescript
interface DeltaRange {
  kind: 'copy' | 'insert';
  // For 'copy': copy from source
  sourceOffset?: number;
  length: number;
  // For 'insert': insert new data
  data?: Uint8Array;
}
```

**Operations**:
- **Copy**: Copy `length` bytes from `source[sourceOffset]`
- **Insert**: Insert `length` bytes of new data

### Rolling Checksum

Fast weak checksum for finding matching blocks:

```typescript
import { rollingInit, rollingSlide, rollingValue } from '@webrun-vcs/diff';

// Initialize for a window
const rc = rollingInit(buffer, offset, length);
console.log(rollingValue(rc)); // Get checksum

// Slide window by one byte
rollingSlide(rc, oldByte, newByte);
console.log(rollingValue(rc)); // Updated checksum
```

**Algorithm**: Rabin-Karp style rolling hash (rsync/Fossil pattern)
- Constant time window sliding: O(1)
- 32-bit checksum (16-bit s1 + 16-bit s2)

### Strong Checksum

Cryptographic-quality hash to confirm matches:

```typescript
import { strongChecksum } from '@webrun-vcs/diff';

const hash = strongChecksum(buffer, offset, length);
```

**Algorithm**: FNV-1a 32-bit hash
- Fast and good distribution
- Used to avoid false positives from weak checksum

## Key Components

### createDelta

High-level API for delta creation:

```typescript
import { createDelta } from '@webrun-vcs/diff';

const delta = createDelta(
  source,           // Source buffer
  target,           // Target buffer
  { blockSize: 16 } // Optional config
);
```

**Options**:
- `blockSize` - Block size for rolling checksum (default: 16)
- `algorithm` - Delta algorithm to use

### createDeltaRanges

Generates delta ranges using optimized algorithm:

```typescript
import { createDeltaRanges } from '@webrun-vcs/diff';

const ranges = createDeltaRanges(source, target);

for (const range of ranges) {
  if (range.kind === 'copy') {
    console.log(`Copy ${range.length} bytes from offset ${range.sourceOffset}`);
  } else {
    console.log(`Insert ${range.length} bytes of new data`);
  }
}
```

**Features**:
- Merges adjacent operations
- Optimizes small copy/insert sequences
- Good balance of compression and speed

### createFossilLikeRanges

Generates delta ranges using Fossil-style algorithm:

```typescript
import { createFossilLikeRanges, buildSourceIndex, DEFAULT_BLOCK_SIZE } from '@webrun-vcs/diff';

// Build index of source blocks
const index = buildSourceIndex(source, DEFAULT_BLOCK_SIZE);

// Generate delta ranges
const ranges = createFossilLikeRanges(index, target);
```

**Features**:
- Rolling checksum for fast block matching
- Strong checksum to confirm matches
- Configurable block size (default: 16 bytes)
- Inspired by Fossil SCM's delta format

### buildSourceIndex

Creates an index for efficient block lookup:

```typescript
import { buildSourceIndex } from '@webrun-vcs/diff';

const index = buildSourceIndex(source, blockSize);
```

**Structure**:
- Maps weak checksum → array of source blocks
- Each block has weak + strong checksums
- Enables fast O(1) lookups during delta generation

### Fossil Delta Format

Encoding and decoding of Fossil-style delta format:

```typescript
import { encodeDeltaBlocks, decodeDeltaBlocks } from '@webrun-vcs/diff';

// Encode delta ranges to Fossil format
const encoded = encodeDeltaBlocks(ranges, targetLength, sourceLength);

// Decode Fossil format to delta ranges
const { ranges: decoded, targetLength, sourceLength } = decodeDeltaBlocks(encoded);
```

**Format**:
- Variable-length integer encoding
- Efficient representation of copy/insert operations
- Compatible with Fossil SCM

### Checksum Utilities

Working with checksums:

```typescript
import { Checksum } from '@webrun-vcs/diff';

const checksum = new Checksum();
checksum.update(data);
const value = checksum.getValue();

// Or direct computation
import { weakChecksum, strongChecksum } from '@webrun-vcs/diff';
const weak = weakChecksum(buffer, offset, length);
const strong = strongChecksum(buffer, offset, length);
```

### mergeChunks

Optimizes delta ranges by merging adjacent operations:

```typescript
import { mergeChunks } from '@webrun-vcs/diff';

const optimized = mergeChunks(ranges);
```

**Optimizations**:
- Merges consecutive copy operations
- Merges consecutive insert operations
- Removes redundant operations
- Can significantly reduce delta size

## Algorithm Details

### Delta Generation Process

1. **Index source**:
   - Divide source into fixed-size blocks
   - Compute weak + strong checksums for each block
   - Build hash map: weak checksum → blocks

2. **Scan target**:
   - Slide rolling checksum window through target
   - For each position, check if weak checksum matches any source block
   - Confirm matches with strong checksum
   - Generate copy operation for matches
   - Generate insert operation for non-matches

3. **Optimize**:
   - Merge adjacent operations
   - Remove redundant operations
   - Balance compression vs. overhead

### Rolling Checksum Algorithm

Based on rsync/Fossil pattern:

```
s1 = sum of all bytes in window
s2 = sum of s1 at each position

checksum = (s1 & 0xFFFF) | ((s2 & 0xFFFF) << 16)
```

**Sliding update**:
```
s1' = s1 - old_byte + new_byte
s2' = s2 - (n * old_byte) + s1'
```

**Time complexity**: O(1) per slide

### Block Size Considerations

**Small blocks** (e.g., 4-8 bytes):
- Better compression (find more matches)
- Higher overhead (more operations)
- More false positives from weak checksum

**Large blocks** (e.g., 32-64 bytes):
- Lower compression (fewer matches)
- Lower overhead (fewer operations)
- Fewer false positives

**Default (16 bytes)**:
- Good balance for most use cases
- Compatible with Git's typical block sizes

## Usage Examples

### Basic Delta Creation

```typescript
import { createDelta, applyDelta } from '@webrun-vcs/diff';

// Original file
const source = new Uint8Array([0, 1, 2, 3, 4, 5]);

// Modified file
const target = new Uint8Array([0, 1, 99, 4, 5]);

// Create delta
const delta = createDelta(source, target);
console.log(`Delta size: ${delta.length} bytes`);

// Apply delta
const reconstructed = applyDelta(source, delta);
console.log(reconstructed); // [0, 1, 99, 4, 5]
```

### Custom Block Size

```typescript
import { createFossilLikeRanges, buildSourceIndex } from '@webrun-vcs/diff';

const BLOCK_SIZE = 32; // Larger blocks for better performance

const index = buildSourceIndex(source, BLOCK_SIZE);
const ranges = createFossilLikeRanges(index, target);
```

### Delta Range Inspection

```typescript
import { createDeltaRanges } from '@webrun-vcs/diff';

const ranges = createDeltaRanges(source, target);

let totalCopied = 0;
let totalInserted = 0;

for (const range of ranges) {
  if (range.kind === 'copy') {
    totalCopied += range.length;
    console.log(`Copy ${range.length} bytes from offset ${range.sourceOffset}`);
  } else {
    totalInserted += range.length;
    console.log(`Insert ${range.length} new bytes`);
  }
}

console.log(`Compression ratio: ${totalCopied / (totalCopied + totalInserted)}`);
```

### Fossil Format Encoding

```typescript
import { createDeltaRanges, encodeDeltaBlocks, decodeDeltaBlocks } from '@webrun-vcs/diff';

const ranges = createDeltaRanges(source, target);

// Encode to Fossil format
const encoded = encodeDeltaBlocks(ranges, target.length, source.length);

// Save or transmit encoded delta...

// Later, decode and apply
const { ranges: decoded } = decodeDeltaBlocks(encoded);
// Use decoded ranges to reconstruct target
```

### Integration with Text Diff

```typescript
import { MyersDiff, BinarySequence, ByteLevelComparator, editListToDeltaRanges } from '@webrun-vcs/diff';

// Compute text diff at byte level
const a = new BinarySequence(source);
const b = new BinarySequence(target);
const edits = MyersDiff.diff(ByteLevelComparator.INSTANCE, a, b);

// Convert to delta ranges
const ranges = editListToDeltaRanges(edits, target);

// Now can encode or process as delta
```

## Performance Characteristics

### Time Complexity

- **Index building**: O(N) where N = source size
- **Delta generation**: O(M) where M = target size
- **Rolling checksum**: O(1) per position
- **Overall**: O(N + M) expected

### Space Complexity

- **Source index**: O(N / blockSize) for blocks
- **Delta ranges**: O(number of operations)
- **Fossil encoding**: Variable, depends on operations

### Compression Ratio

Depends on similarity between source and target:
- **High similarity**: 90%+ compression possible
- **Low similarity**: May be larger than literal encoding
- **Optimal use**: Incremental changes to large files

## Git Binary Delta Compatibility

This module's delta format can be encoded/decoded for Git binary patches:

```typescript
import { encodeGitBinaryDelta, decodeGitBinaryDelta } from '@webrun-vcs/diff';

// Encode delta for Git
const gitDelta = await encodeGitBinaryDelta(source, target);

// Decode Git delta
const result = await decodeGitBinaryDelta(source, gitDelta);
```

**Based on**: JGit's binary delta implementation

## Differences from Fossil

While inspired by Fossil's delta format, this implementation includes:

1. **Multiple algorithms** - Both optimized and Fossil-like
2. **Git compatibility** - Can encode/decode Git binary deltas
3. **TypeScript** - Full type safety
4. **Modern JavaScript** - ES modules, Uint8Array
5. **Configurable** - Flexible block sizes and algorithms
6. **Integration** - Works with text-diff edit lists

## References

- [Fossil Delta Format](https://fossil-scm.org/home/doc/trunk/www/delta_format.wiki)
- [rsync Algorithm](https://rsync.samba.org/tech_report/)
- [JGit DeltaEncoder](https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/pack/DeltaEncoder.java)
- [Git Pack Format](https://git-scm.com/docs/pack-format)
