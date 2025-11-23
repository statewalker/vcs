# Text Diff Module

The text-diff module implements the Myers diff algorithm for computing differences between sequences, based on JGit's diff implementation.

## Overview

This module is based on [JGit's diff algorithm implementation](https://github.com/eclipse-jgit/jgit), drawing from `org.eclipse.jgit.diff.MyersDiff`, `Edit`, `EditList`, `Sequence`, `SequenceComparator`, `RawText`, and `HashedSequence`. When you compare two files, this module finds the shortest sequence of changes that transforms one into the other.

## Myers Diff Algorithm

Eugene W. Myers' O(ND) difference algorithm finds the minimal edit distance between two sequences. JGit's bidirectional search approach brings space complexity down to O(N) instead of O(N²).

Imagine a grid where one file's lines form the columns and the other file's lines form the rows. Edit paths travel from the upper left to the lower right corner. When lines match, you move diagonally for free. Horizontal and vertical moves cost you—they represent insertions and deletions. A D-path contains exactly D differences, and the algorithm finds the furthest reaching D-path on each diagonal k.

The implementation follows the paper "An O(ND) Difference Algorithm and its Variations" by Eugene W. Myers and JGit's [MyersDiff.java](https://github.com/eclipse-jgit/jgit/blob/master/org.eclipse.jgit/src/org/eclipse/jgit/diff/MyersDiff.java).

### Sequence Abstraction

The algorithm works on any sequence—not just text. Based on JGit's `Sequence.java` and `SequenceComparator.java`, you can compare anything that has a size and where elements can be compared:

```typescript
abstract class Sequence {
  abstract size(): number;
}

interface SequenceComparator<S extends Sequence> {
  equals(a: S, ai: number, b: S, bi: number): boolean;
  hash(seq: S, index: number): number;
}
```

This abstraction lets you diff text lines, binary data, or even custom structures.

### Edit Operations

Based on JGit's `Edit.java`, each change becomes an Edit that describes what happened. The type tells you whether elements were inserted, deleted, replaced, or left empty (no change). The begin and end positions mark where changes occurred in both sequences:

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

## Key Components

### MyersDiff

Based on JGit's `MyersDiff.java`, this is where the diff computation happens. You give it two sequences and a comparator, and it returns a list of edits. The bidirectional search optimizes performance, edit normalization ensures consistent output, and you can plug in custom comparators:

```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';

const a = new RawText(Buffer.from('line1\nline2\nline3\n'));
const b = new RawText(Buffer.from('line1\nmodified\nline3\n'));

const edits = MyersDiff.diff(RawTextComparator.DEFAULT, a, b);

for (const edit of edits) {
  console.log(`${edit.getType()}: A[${edit.beginA}:${edit.endA}] -> B[${edit.beginB}:${edit.endB}]`);
}
```

### RawText

Based on JGit's `RawText.java`, this class wraps text for line-based comparison. You get the number of lines, extract line content, and check whether the file ends with a newline:

```typescript
import { RawText } from '@webrun-vcs/diff';

const text = new RawText(Buffer.from('line1\nline2\nline3\n'));

console.log(text.size());              // Number of lines
console.log(text.getString(0, 1));     // Get line content
console.log(text.isMissingNewlineAtEnd()); // Check for missing newline
```

### RawTextComparator

When comparing text, you often want to handle whitespace differently depending on the situation. Based on JGit's `RawTextComparator.java`, you can compare lines exactly with `DEFAULT`, ignore whitespace changes using `WS_IGNORE_CHANGE`, strip all whitespace with `WS_IGNORE_ALL`, or focus on just leading or trailing whitespace with `WS_IGNORE_LEADING` and `WS_IGNORE_TRAILING`:

```typescript
import { RawTextComparator } from '@webrun-vcs/diff';

RawTextComparator.DEFAULT            // Compare lines exactly
RawTextComparator.WS_IGNORE_CHANGE   // Ignore whitespace changes
RawTextComparator.WS_IGNORE_ALL      // Ignore all whitespace
RawTextComparator.WS_IGNORE_LEADING  // Ignore leading whitespace
RawTextComparator.WS_IGNORE_TRAILING // Ignore trailing whitespace
```

### HashedSequence

Based on JGit's `HashedSequence.java`, this optimization reduces redundant element comparisons by caching hash values for frequently compared elements. MyersDiff automatically uses it for better performance:

```typescript
import { HashedSequence, HashedSequencePair } from '@webrun-vcs/diff';

// Automatically used by MyersDiff for better performance
const pair = new HashedSequencePair(comparator, a, b);
const ha = pair.getA();  // Hashed version of sequence A
const hb = pair.getB();  // Hashed version of sequence B
```

You don't usually work with HashedSequence directly—MyersDiff handles it behind the scenes.

### BinarySequence

When you need to diff binary data instead of text, BinarySequence gives you two comparison strategies. `BinaryComparator` compares entire sequences, while `ByteLevelComparator` goes byte-by-byte:

```typescript
import { BinarySequence, BinaryComparator } from '@webrun-vcs/diff';

const a = new BinarySequence(new Uint8Array([0x01, 0x02, 0x03]));
const b = new BinarySequence(new Uint8Array([0x01, 0xFF, 0x03]));

const edits = MyersDiff.diff(BinaryComparator.INSTANCE, a, b);
```

### Edit List Utilities

These utilities bridge the text-diff and delta modules by converting between edit lists and delta ranges:

```typescript
import { deltaRangesToEditList, editListToDeltaRanges } from '@webrun-vcs/diff';

// Convert delta ranges to edit list
const edits = deltaRangesToEditList(deltaRanges);

// Convert edit list to delta ranges
const ranges = editListToDeltaRanges(editList);
```

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

JGit optimizes the algorithm by searching forward from the start and backward from the end, meeting in the middle. This brings memory usage down from O(N²) to O(N), making it practical for large files.

### Edit Normalization

Edit normalization ensures consistent edit placement. The algorithm shifts edit regions to standard positions, handles ambiguous cases deterministically, and produces output compatible with Git's diff format.

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

This TypeScript version brings full type safety with generics and modern JavaScript features like ES modules, Uint8Array, and Buffer. The API removes Java-specific patterns while keeping the core algorithms intact. Native JavaScript optimizations improve performance, and you get extras like BinarySequence, ByteLevelComparator, and utilities to convert between Edit and DeltaRange.

## Performance Considerations

### Time Complexity

In the best case when sequences are identical, the algorithm runs in O(N). The worst case is O(N * D) where D equals the edit distance. For typical text files, expect O(N + D²).

### Space Complexity

Bidirectional search (JGit's optimization) keeps space at O(N). The edit path frontier uses O(D). HashedSequence adds O(N) for hash caching, but the performance gain usually outweighs the memory cost.

### Optimization Tips

MyersDiff automatically uses HashedSequence, so you get that optimization without extra work. Choose your comparator carefully—whitespace handling affects performance. For very large files, consider chunking. When diffing binary data with small changes, ByteLevelComparator works well.

## References

- [Myers' Paper](http://www.xmailserver.org/diff2.pdf) - "An O(ND) Difference Algorithm and its Variations"
- [JGit Diff Package](https://github.com/eclipse-jgit/jgit/tree/master/org.eclipse.jgit/src/org/eclipse/jgit/diff)
- [Git Diff Documentation](https://git-scm.com/docs/git-diff)
