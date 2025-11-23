# Text Diff Module

The text-diff module implements the Myers diff algorithm for computing differences between sequences, based on JGit's diff implementation.

## Overview

This module is based on [JGit's diff algorithm implementation](https://github.com/eclipse-jgit/jgit), specifically:
- `org.eclipse.jgit.diff.MyersDiff`
- `org.eclipse.jgit.diff.Edit`
- `org.eclipse.jgit.diff.EditList`
- `org.eclipse.jgit.diff.Sequence`
- `org.eclipse.jgit.diff.SequenceComparator`
- `org.eclipse.jgit.diff.RawText`
- `org.eclipse.jgit.diff.HashedSequence`

## Features

### Myers Diff Algorithm

Implementation of Eugene W. Myers' O(ND) difference algorithm with JGit's bidirectional search approach for O(N) space complexity.

**Key concepts**:
- Edit paths from upper left to lower right corner
- Diagonal moves represent matching elements
- Horizontal/vertical moves represent changes
- D-paths contain exactly D differences
- Furthest reaching D-path on diagonal k

**Based on**:
- Paper: "An O(ND) Difference Algorithm and its Variations" by Eugene W. Myers
- JGit's [MyersDiff.java](https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit/src/org/eclipse/jgit/diff/MyersDiff.java)

### Sequence Abstraction

Generic abstraction for comparing sequences of elements:

```typescript
abstract class Sequence {
  abstract size(): number;
}

interface SequenceComparator<S extends Sequence> {
  equals(a: S, ai: number, b: S, bi: number): boolean;
  hash(seq: S, index: number): number;
}
```

**Based on**: JGit's `Sequence.java` and `SequenceComparator.java`

### Edit Operations

Represents changes between sequences:

```typescript
enum EditType {
  INSERT,   // B inserted elements
  DELETE,   // B deleted elements from A
  REPLACE,  // B replaced elements from A
  EMPTY     // No change
}

class Edit {
  beginA: number;  // Start in sequence A
  endA: number;    // End in sequence A
  beginB: number;  // Start in sequence B
  endB: number;    // End in sequence B
}
```

**Based on**: JGit's `Edit.java`

## Key Components

### MyersDiff

Computes differences between two sequences:

```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';

const a = new RawText(Buffer.from('line1\nline2\nline3\n'));
const b = new RawText(Buffer.from('line1\nmodified\nline3\n'));

const edits = MyersDiff.diff(RawTextComparator.DEFAULT, a, b);

for (const edit of edits) {
  console.log(`${edit.getType()}: A[${edit.beginA}:${edit.endA}] -> B[${edit.beginB}:${edit.endB}]`);
}
```

**Features**:
- Bidirectional search for optimal performance
- Edit normalization for consistent output
- Support for custom comparators

**Based on**: JGit's `MyersDiff.java`

### RawText

Text sequence implementation for line-based comparison:

```typescript
import { RawText } from '@webrun-vcs/diff';

const text = new RawText(Buffer.from('line1\nline2\nline3\n'));

console.log(text.size());              // Number of lines
console.log(text.getString(0, 1));     // Get line content
console.log(text.isMissingNewlineAtEnd()); // Check for missing newline
```

**Based on**: JGit's `RawText.java`

### RawTextComparator

Comparator for text sequences with various strategies:

```typescript
import { RawTextComparator } from '@webrun-vcs/diff';

// Default: compare lines exactly
RawTextComparator.DEFAULT

// Ignore whitespace changes
RawTextComparator.WS_IGNORE_CHANGE

// Ignore all whitespace
RawTextComparator.WS_IGNORE_ALL

// Ignore leading whitespace
RawTextComparator.WS_IGNORE_LEADING

// Ignore trailing whitespace
RawTextComparator.WS_IGNORE_TRAILING
```

**Based on**: JGit's `RawTextComparator.java`

### HashedSequence

Performance optimization using hash-based comparison:

```typescript
import { HashedSequence, HashedSequencePair } from '@webrun-vcs/diff';

// Automatically used by MyersDiff for better performance
const pair = new HashedSequencePair(comparator, a, b);
const ha = pair.getA();  // Hashed version of sequence A
const hb = pair.getB();  // Hashed version of sequence B
```

**Features**:
- Reduces redundant element comparisons
- Caches hash values for frequently compared elements
- Automatically used by Myers diff

**Based on**: JGit's `HashedSequence.java`

### BinarySequence

Binary data comparison:

```typescript
import { BinarySequence, BinaryComparator } from '@webrun-vcs/diff';

const a = new BinarySequence(new Uint8Array([0x01, 0x02, 0x03]));
const b = new BinarySequence(new Uint8Array([0x01, 0xFF, 0x03]));

const edits = MyersDiff.diff(BinaryComparator.INSTANCE, a, b);
```

**Comparators**:
- `BinaryComparator` - Compare entire sequences
- `ByteLevelComparator` - Compare byte-by-byte

### Edit List Utilities

Convert between edit lists and delta ranges:

```typescript
import { deltaRangesToEditList, editListToDeltaRanges } from '@webrun-vcs/diff';

// Convert delta ranges to edit list
const edits = deltaRangesToEditList(deltaRanges);

// Convert edit list to delta ranges
const ranges = editListToDeltaRanges(editList);
```

**Note**: These utilities bridge the text-diff and delta modules.

## Algorithm Details

### Myers Diff Algorithm

The algorithm works by:

1. **Grid representation**: Lines of text A as columns (x), lines of text B as rows (y)
2. **Edit path**: Find shortest path from (0,0) to (size A, size B)
3. **Diagonal moves**: Free when lines match (x,y) → (x+1,y+1)
4. **Horizontal/vertical**: Insert/delete operations

**Example**:

```
Text A: "line1\nline2\nline3"
Text B: "line1\nmodified\nline3"

Grid:
      line1  line2  line3
line1   ╲
modified       X
line3              ╲

Edit path: diagonal (match) → horizontal (delete/insert) → diagonal (match)
Result: REPLACE edit at position 1
```

### Bidirectional Search

JGit's optimization:
- Search forward from start
- Search backward from end
- Meet in the middle
- Reduces memory usage from O(N²) to O(N)

### Edit Normalization

Ensures consistent edit placement:
- Shifts edit regions to standard positions
- Handles ambiguous cases deterministically
- Compatible with Git's diff output

## Usage Examples

### Basic Text Diff

```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';

const oldText = new RawText(Buffer.from(`
function hello() {
  console.log("Hello");
}
`));

const newText = new RawText(Buffer.from(`
function hello() {
  console.log("Hello, World!");
}
`));

const edits = MyersDiff.diff(RawTextComparator.DEFAULT, oldText, newText);

for (const edit of edits) {
  const type = edit.getType();
  const lengthA = edit.getLengthA();
  const lengthB = edit.getLengthB();
  console.log(`${type}: ${lengthA} lines → ${lengthB} lines`);
}
```

### Whitespace Handling

```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';

const a = new RawText(Buffer.from('line1\n  line2\nline3\n'));
const b = new RawText(Buffer.from('line1\nline2\nline3\n'));

// With default comparator (whitespace matters)
const editsDefault = MyersDiff.diff(RawTextComparator.DEFAULT, a, b);
console.log('Default:', editsDefault.length); // 1 edit

// Ignoring whitespace changes
const editsIgnoreWS = MyersDiff.diff(RawTextComparator.WS_IGNORE_ALL, a, b);
console.log('Ignore WS:', editsIgnoreWS.length); // 0 edits
```

### Binary Diff

```typescript
import { MyersDiff, BinarySequence, ByteLevelComparator } from '@webrun-vcs/diff';

const oldData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
const newData = new Uint8Array([0x00, 0xFF, 0x02, 0x03]);

const a = new BinarySequence(oldData);
const b = new BinarySequence(newData);

const edits = MyersDiff.diff(ByteLevelComparator.INSTANCE, a, b);
console.log(`Changed ${edits.length} bytes`);
```

## Differences from JGit

1. **TypeScript types** - Full type safety with generics
2. **Modern JavaScript** - ES modules, Uint8Array, Buffer
3. **Simplified API** - Removed Java-specific patterns
4. **Performance** - Native JavaScript optimizations
5. **Binary support** - Added BinarySequence and ByteLevelComparator
6. **Delta integration** - Utilities to convert between Edit and DeltaRange

## Performance Considerations

### Time Complexity

- **Best case**: O(N) when sequences are identical
- **Worst case**: O(N * D) where D is the edit distance
- **Average**: O(N + D²) for typical text files

### Space Complexity

- **O(N)** with bidirectional search (JGit optimization)
- **O(D)** for the edit path frontier
- HashedSequence adds O(N) for hash caching

### Optimization Tips

1. **Use HashedSequence** - Automatically used by MyersDiff
2. **Appropriate comparator** - Choose whitespace handling carefully
3. **Chunking** - For very large files, consider splitting
4. **Binary data** - Use ByteLevelComparator for small changes

## References

- [Myers' Paper](http://www.xmailserver.org/diff2.pdf) - "An O(ND) Difference Algorithm and its Variations"
- [JGit Diff Package](https://github.com/eclipse-jgit/jgit/tree/master/org.eclipse.jgit/src/org/eclipse/jgit/diff)
- [Git Diff Documentation](https://git-scm.com/docs/git-diff)
