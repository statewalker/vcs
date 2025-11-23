# Delta Module

The delta module provides binary delta compression for efficient storage and transmission of binary data changes.

## Overview

This module implements delta compression inspired by [Fossil SCM](https://fossil-scm.org/home/doc/trunk/www/delta_format.wiki) and rsync, with features compatible with Git's binary delta format. When you store multiple versions of a binary file, delta compression lets you save just the differences instead of complete copies. The approach draws from Fossil's delta format, rsync's rolling checksum algorithm, and Git's binary delta encoding from JGit.

## Delta Compression

Creating compact binary deltas is straightforward. You provide the old version (source) and new version (target), and the module finds matching blocks between them:

```typescript
import { createDelta } from '@webrun-vcs/diff';

const source = new Uint8Array([...]); // Old version
const target = new Uint8Array([...]); // New version

const delta = createDelta(source, target);
console.log(`Compressed ${target.length} bytes to ${delta.length} bytes`);
```

Applying a delta reconstructs the target from the source and delta:

```typescript
import { applyDelta } from '@webrun-vcs/diff';

const source = new Uint8Array([...]); // Original
const delta = new Uint8Array([...]);  // Delta

const result = applyDelta(source, delta);
// result now contains the reconstructed target
```

### Delta Algorithms

You can choose between two algorithms for generating delta ranges. `createDeltaRanges` optimizes for typical binary files with a balance of speed and compression. `createFossilLikeRanges` follows Fossil's approach with configurable block sizes for more control.

## Key Concepts

### Delta Ranges

A delta encodes changes as a sequence of operations. Each operation either copies bytes from the source or inserts new bytes:

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

Copy operations reference `length` bytes from `source[sourceOffset]`. Insert operations provide `length` bytes of new data.

### Rolling Checksum

Finding matching blocks quickly requires a fast weak checksum that updates in constant time. The rolling checksum uses a Rabin-Karp style rolling hash following the rsync and Fossil pattern:

```typescript
import { rollingInit, rollingSlide, rollingValue } from '@webrun-vcs/diff';

// Initialize for a window
const rc = rollingInit(buffer, offset, length);
console.log(rollingValue(rc)); // Get checksum

// Slide window by one byte
rollingSlide(rc, oldByte, newByte);
console.log(rollingValue(rc)); // Updated checksum
```

The 32-bit checksum combines a 16-bit s1 and 16-bit s2, and sliding the window takes O(1) time regardless of window size.

### Strong Checksum

When the rolling checksum finds a potential match, a strong checksum confirms it. This uses FNV-1a 32-bit hash for fast computation with good distribution:

```typescript
import { strongChecksum } from '@webrun-vcs/diff';

const hash = strongChecksum(buffer, offset, length);
```

The strong checksum prevents false positives from the weak checksum.

## Key Components

### createDelta

This high-level API handles delta creation with sensible defaults. You provide source and target buffers, optionally configure the block size and algorithm, and get back an encoded delta:

```typescript
import { createDelta } from '@webrun-vcs/diff';

const delta = createDelta(
  source,           // Source buffer
  target,           // Target buffer
  { blockSize: 16 } // Optional config
);
```

The block size controls the rolling checksum window (default: 16 bytes). You can also specify which delta algorithm to use.

### createDeltaRanges

When you need more control, `createDeltaRanges` generates delta ranges using an optimized algorithm. It merges adjacent operations, optimizes small copy and insert sequences, and balances compression with speed:

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

### createFossilLikeRanges

This Fossil-style algorithm uses rolling and strong checksums to find matches. You first build an index of source blocks, then generate ranges:

```typescript
import { createFossilLikeRanges, buildSourceIndex, DEFAULT_BLOCK_SIZE } from '@webrun-vcs/diff';

// Build index of source blocks
const index = buildSourceIndex(source, DEFAULT_BLOCK_SIZE);

// Generate delta ranges
const ranges = createFossilLikeRanges(index, target);
```

The rolling checksum enables fast block matching, while the strong checksum confirms matches. You can configure the block size (default: 16 bytes). This approach follows Fossil SCM's delta format.

### buildSourceIndex

Before generating a delta, you build an index for efficient block lookup. The index maps weak checksums to arrays of source blocks, where each block stores both weak and strong checksums:

```typescript
import { buildSourceIndex } from '@webrun-vcs/diff';

const index = buildSourceIndex(source, blockSize);
```

This structure enables O(1) lookups during delta generation.

### Fossil Delta Format

When you need to store or transmit deltas, the Fossil format provides compact encoding using variable-length integers:

```typescript
import { encodeDeltaBlocks, decodeDeltaBlocks } from '@webrun-vcs/diff';

// Encode delta ranges to Fossil format
const encoded = encodeDeltaBlocks(ranges, targetLength, sourceLength);

// Decode Fossil format to delta ranges
const { ranges: decoded, targetLength, sourceLength } = decodeDeltaBlocks(encoded);
```

This format efficiently represents copy and insert operations while maintaining compatibility with Fossil SCM.

### Checksum Utilities

You can work with checksums incrementally or compute them directly:

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

After generating delta ranges, merging adjacent operations reduces delta size. This optimization combines consecutive copy operations, merges consecutive inserts, and removes redundant operations:

```typescript
import { mergeChunks } from '@webrun-vcs/diff';

const optimized = mergeChunks(ranges);
```

The reduction can be significant, especially when the algorithm generates many small operations.

## Algorithm Details

### Delta Generation Process

The algorithm works in three phases. First, it indexes the source by dividing it into fixed-size blocks, computing weak and strong checksums for each block, and building a hash map from weak checksums to blocks.

Next, it scans the target by sliding a rolling checksum window through it. At each position, it checks whether the weak checksum matches any source block. When it finds a match, it confirms with the strong checksum. Matches become copy operations, while non-matches become insert operations.

Finally, it optimizes the result by merging adjacent operations, removing redundant ones, and balancing compression against overhead.

### Rolling Checksum Algorithm

Following the rsync and Fossil pattern, the checksum maintains two sums. `s1` equals the sum of all bytes in the window, while `s2` equals the sum of `s1` at each position. The final checksum combines them: `(s1 & 0xFFFF) | ((s2 & 0xFFFF) << 16)`.

Sliding the window updates in O(1):
```
s1' = s1 - old_byte + new_byte
s2' = s2 - (n * old_byte) + s1'
```

### Block Size Considerations

Small blocks (4-8 bytes) find more matches, giving better compression, but generate more operations and increase overhead. They also produce more false positives from the weak checksum.

Large blocks (32-64 bytes) find fewer matches, reducing compression, but generate fewer operations and lower overhead. False positives decrease.

The default (16 bytes) strikes a good balance for most use cases and stays compatible with Git's typical block sizes.

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

Building the index takes O(N) where N equals the source size. Delta generation runs in O(M) where M equals the target size. Each rolling checksum position updates in O(1). Overall, expect O(N + M) performance.

### Space Complexity

The source index uses O(N / blockSize) space for blocks. Delta ranges consume O(number of operations). Fossil encoding varies depending on the operations.

### Compression Ratio

Compression depends on how similar the source and target are. High similarity can achieve 90%+ compression. Low similarity might produce deltas larger than literal encoding. The sweet spot is incremental changes to large files.

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

While inspired by Fossil's delta format, this implementation offers multiple algorithms (both optimized and Fossil-like) and Git compatibility for encoding and decoding Git binary deltas. TypeScript provides full type safety, and modern JavaScript features like ES modules and Uint8Array replace older patterns. You get flexible configuration for block sizes and algorithms, plus integration with text-diff edit lists.

## References

- [Fossil Delta Format](https://fossil-scm.org/home/doc/trunk/www/delta_format.wiki)
- [rsync Algorithm](https://rsync.samba.org/tech_report/)
- [JGit DeltaEncoder](https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/pack/DeltaEncoder.java)
- [Git Pack Format](https://git-scm.com/docs/pack-format)
