# Diff Package Analysis: JGit Alignment and API Overview

## Executive Summary

The `@webrun-vcs/diff` package implements three complementary diff/patch systems, with significant portions ported from JGit (Java Git implementation). This analysis examines the architecture, APIs, data types, and opportunities for alignment.

## Architecture Overview

### Three Main Subsystems

```
packages/diff/src/
├── text-diff/     # Text line-based diff (Myers algorithm from JGit)
├── patch/         # Git patch parsing & application (from JGit)
└── delta/         # Binary delta compression (Fossil-style)
```

### 1. Text Diff Module (`text-diff/`)

**Purpose**: Line-based text diffing using Myers' O(ND) algorithm

**JGit Source**: Ported from `org.eclipse.jgit.diff`

**Key Components**:
- `MyersDiff<S>` - Main diff algorithm implementation
- `Sequence` - Abstract base for diffable sequences
- `RawText` - Text file sequence (line-based)
- `Edit` - Represents a change region (INSERT/DELETE/REPLACE)
- `HashedSequence` - Performance optimization via hash caching

**Core API**:
```typescript
// Main diff function
MyersDiff.diff<S>(
  cmp: SequenceComparator<S>,
  a: S,      // Old sequence
  b: S       // New sequence
): EditList

// Example usage
const a = new RawText("old content");
const b = new RawText("new content");
const cmp = new RawTextComparator();
const edits = MyersDiff.diff(cmp, a, b);
```

**Data Types**:
```typescript
class Edit {
  beginA: number;  // Start in sequence A (0-based)
  endA: number;    // End in sequence A
  beginB: number;  // Start in sequence B
  endB: number;    // End in sequence B

  getType(): EditType; // INSERT | DELETE | REPLACE | EMPTY
}

type EditList = Edit[];

abstract class Sequence {
  abstract size(): number;
}

interface SequenceComparator<S> {
  equals(a: S, ai: number, b: S, bi: number): boolean;
  hash(seq: S, index: number): number;
}
```

### 2. Patch Module (`patch/`)

**Purpose**: Parse and apply Git unified diff patches

**JGit Source**: Ported from `org.eclipse.jgit.patch`

**Key References**:
- `types.ts`: `@see https://github.com/eclipse-jgit/jgit/.../patch`
- `base85.ts`: `@see https://github.com/eclipse-jgit/jgit/.../Base85.java`

**Key Components**:
- `Patch` - Top-level patch parser
- `FileHeader` - Per-file patch metadata and hunks
- `HunkHeader` - Individual change hunk
- `BinaryHunk` - Binary patch data (literal/delta)
- `PatchApplier` - Applies patches to content

**Core API**:
```typescript
// Parsing patches
const patch = new Patch();
patch.parse(patchBytes);
const files = patch.getFiles();

// Applying patches
const applier = new PatchApplier({ allowConflicts: false });
const result = applier.apply(fileHeader, oldContent);
```

**Data Types**:
```typescript
enum PatchType {
  UNIFIED = "UNIFIED",           // Standard unified diff
  BINARY = "BINARY",             // "Binary files differ"
  GIT_BINARY = "GIT_BINARY"      // Git binary patch
}

enum ChangeType {
  ADD = "ADD",
  DELETE = "DELETE",
  MODIFY = "MODIFY",
  RENAME = "RENAME",
  COPY = "COPY"
}

enum BinaryHunkType {
  LITERAL_DEFLATED = "LITERAL_DEFLATED",  // Full file content
  DELTA_DEFLATED = "DELTA_DEFLATED"       // Delta from old
}

interface FileMode {
  mode: number;           // Unix permissions (e.g., 0o100644)
  isExecutable: boolean;
  isSymlink: boolean;
  isRegular: boolean;
  isDirectory: boolean;
}

interface ObjectId {
  hash: string;           // Git SHA-1 (hex)
  abbreviated: boolean;   // Partial hash?
}

class FileHeader {
  oldPath: string | null;
  newPath: string | null;
  oldMode: number | null;
  newMode: number | null;
  oldId: string | null;   // SHA-1
  newId: string | null;
  changeType: ChangeType;
  patchType: PatchType;
  score: number;          // Similarity for rename/copy (0-100)
  hunks: HunkHeader[];
  forwardBinaryHunk: BinaryHunk | null;
  reverseBinaryHunk: BinaryHunk | null;
}
```

### 3. Delta Module (`delta/`)

**Purpose**: Binary delta compression (Fossil-style, NOT from JGit)

**Key Components**:
- `createDelta()` - Generate delta from ranges
- `createDeltaRanges()` - Compute optimal ranges
- `createFossilLikeRanges()` - Rolling hash algorithm
- `applyDelta()` - Apply delta to source

**Core API**:
```typescript
// Create delta
function* createDelta(
  source: Uint8Array,
  target: Uint8Array,
  ranges: Iterable<DeltaRange>
): Generator<Delta>

// Create ranges (finds differences)
function* createDeltaRanges(
  source: Uint8Array,
  target: Uint8Array,
  options?: { blockSize?: number }
): Generator<DeltaRange>

// Apply delta
function* applyDelta(
  source: Uint8Array,
  deltas: Iterable<Delta>
): Generator<Uint8Array>
```

**Data Types**:
```typescript
type DeltaRange =
  | { from: "source"; start: number; len: number }  // Copy from source
  | { from: "target"; start: number; len: number }; // Insert from target

type Delta =
  | { type: "start"; targetLen: number }
  | { type: "copy"; start: number; len: number }
  | { type: "insert"; data: Uint8Array }
  | { type: "finish"; checksum: number };
```

## Key API Patterns and Alignment

### Common Pattern: Sequence-Based Abstraction

Both **text-diff** (from JGit) and **delta** use sequence abstractions:

**Text Diff (JGit pattern)**:
```typescript
abstract class Sequence {
  abstract size(): number;
}

class RawText extends Sequence {
  // Lines as elements
  size(): number { return lineCount; }
}
```

**Delta (Custom pattern)**:
```typescript
// Operates directly on Uint8Array
// Uses rolling checksum for byte-level matching
```

**Alignment Opportunity**: Create a unified `BinarySequence` that fits the JGit `Sequence` pattern for consistency.

### Common Pattern: Edit/Range Description

Both systems describe changes, but with different structures:

**Text Diff (JGit)**:
```typescript
class Edit {
  beginA, endA: number;  // Range in sequence A
  beginB, endB: number;  // Range in sequence B

  getType(): EditType;   // INSERT | DELETE | REPLACE
}
```

**Delta (Custom)**:
```typescript
type DeltaRange =
  | { from: "source"; start, len }
  | { from: "target"; start, len };
```

**Alignment Opportunity**:
1. DeltaRange could be modeled as Edit instances
2. Or Edit could support a similar discriminated union pattern

### Common Pattern: Comparator Abstraction

**Text Diff (JGit pattern)**:
```typescript
interface SequenceComparator<S> {
  equals(a: S, ai: number, b: S, bi: number): boolean;
  hash(seq: S, index: number): number;
}

class RawTextComparator implements SequenceComparator<RawText> {
  // Line-by-line comparison
}
```

**Delta (Custom)**:
```typescript
// Uses rolling checksum directly
interface SourceBlock {
  offset: number;
  weak: number;    // Rolling hash
  strong: string;  // SHA-1 hash
}
```

**Alignment Opportunity**: Wrap rolling checksum in a `SequenceComparator` for binary sequences.

## JGit Integration Points

### What's Ported from JGit

1. **Myers Diff Algorithm** (`text-diff/myers-diff.ts`)
   - Bidirectional search optimization
   - Hash-based comparisons via `HashedSequence`
   - Edit normalization (shifting edits to consistent positions)

2. **Sequence Framework** (`text-diff/sequence.ts`, `edit.ts`)
   - `Sequence` abstraction
   - `SequenceComparator` interface
   - `Edit` class with full JGit API

3. **Patch Parsing** (`patch/*.ts`)
   - Git extended header parsing
   - Unified diff format
   - Binary patch format (literal/delta)
   - Base85 encoding

4. **Text Representation** (`text-diff/raw-text.ts`)
   - Line-based text sequences
   - Line map building
   - Binary detection

### What's NOT from JGit

1. **Delta Compression** (`delta/`)
   - Uses Fossil-style rolling hash
   - Different encoding format
   - Not compatible with Git binary delta

2. **Patch Application** (`patch/patch-applier.ts`)
   - Partial JGit port (structure ported, implementation simplified)
   - Binary patch application incomplete (needs inflate/deflate)

## Data Type Alignment Analysis

### Well-Aligned Types

These types follow consistent patterns across modules:

1. **Sequence/Edit Pattern**:
   - `Sequence` → abstract base
   - `RawText` → concrete implementation
   - `Edit` → change descriptor
   - `SequenceComparator` → comparison logic

2. **File Metadata**:
   - `FileMode` → Unix permissions
   - `ObjectId` → Git hashes
   - `ChangeType` → operation type

### Misaligned Types (Opportunities)

1. **Binary Diff Representation**:
   - `DeltaRange` (delta module) vs `Edit` (text-diff module)
   - Could unify under common "change region" abstraction

2. **Binary Sequence**:
   - Delta operates on raw `Uint8Array`
   - Could wrap in `BinarySequence extends Sequence`

3. **Hash/Checksum**:
   - `HashedSequence` uses `SequenceComparator.hash()`
   - Delta uses `RollingChecksum` and `strongChecksum()` separately
   - Could unify under `SequenceComparator<BinarySequence>`

## Common Use Cases and API Surface

### Use Case 1: Text Diff

**Current API**:
```typescript
import { MyersDiff, RawText, RawTextComparator } from '@webrun-vcs/diff';

const a = new RawText("line1\nline2\nline3");
const b = new RawText("line1\nline2-modified\nline3");
const edits = MyersDiff.diff(new RawTextComparator(), a, b);

edits.forEach(edit => {
  console.log(edit.toString()); // "REPLACE(1-2,1-2)"
});
```

**Alignment**: ✅ Clean, follows JGit pattern

### Use Case 2: Parse Git Patch

**Current API**:
```typescript
import { Patch, FileHeader } from '@webrun-vcs/diff';

const patch = new Patch();
patch.parse(patchBytes);

for (const file of patch.getFiles()) {
  console.log(file.oldPath, '→', file.newPath);
  console.log('Change type:', file.changeType);
  console.log('Hunks:', file.hunks.length);
}
```

**Alignment**: ✅ Clean, follows JGit pattern

### Use Case 3: Binary Delta

**Current API**:
```typescript
import { createDeltaRanges, createDelta, applyDelta } from '@webrun-vcs/diff';

const source = new Uint8Array([...]);
const target = new Uint8Array([...]);

// Create delta
const ranges = createDeltaRanges(source, target);
const delta = createDelta(source, target, ranges);

// Apply delta
const result = applyDelta(source, delta);
const reconstructed = new Uint8Array([...result].flat());
```

**Alignment**: ⚠️ Different pattern from text-diff
- Generator-based vs class-based
- No `Sequence` abstraction
- No `Comparator` pattern

### Use Case 4: Apply Patch

**Current API**:
```typescript
import { Patch, PatchApplier } from '@webrun-vcs/diff';

const patch = new Patch();
patch.parse(patchBytes);

const applier = new PatchApplier({ allowConflicts: false });

for (const file of patch.getFiles()) {
  const result = applier.apply(file, oldContent);
  if (result.success) {
    console.log('Applied:', file.newPath);
  } else {
    console.error('Errors:', result.errors);
  }
}
```

**Alignment**: ✅ Clean API, but binary patch support incomplete

## Recommendations for Alignment

### High Priority

1. **Complete Binary Patch Support**:
   - Add inflate/deflate to `PatchApplier`
   - Support both literal and delta binary hunks
   - Test against JGit test fixtures

2. **Unify Binary Delta with JGit Pattern**:
   ```typescript
   class BinarySequence extends Sequence {
     constructor(private data: Uint8Array) { super(); }
     size(): number { return this.data.length; }
   }

   class BinaryComparator implements SequenceComparator<BinarySequence> {
     // Uses rolling checksum + strong hash
   }
   ```

3. **Bridge DeltaRange and Edit**:
   ```typescript
   // Option A: Convert DeltaRange to Edit
   function deltaRangeToEdit(range: DeltaRange): Edit { ... }

   // Option B: Make Edit support both patterns
   class Edit {
     static fromDeltaRange(range: DeltaRange): Edit { ... }
   }
   ```

### Medium Priority

4. **Add Git Binary Delta Format**:
   - Current delta uses Fossil format
   - Git uses different encoding (see `BinaryHunk`)
   - Could support both formats

5. **Consistent Error Handling**:
   - Text-diff: throws errors
   - Patch: collects errors in arrays
   - Delta: throws errors
   - Unify under consistent pattern

6. **TypeScript Generics Alignment**:
   - Text-diff uses `<S extends Sequence>`
   - Delta could adopt same pattern
   - Benefits: type safety, reusability

### Low Priority

7. **Performance Optimizations**:
   - Share `HashedSequence` optimization across modules
   - Cache checksums in binary sequences
   - Reuse memory allocations

8. **Documentation**:
   - Add JGit equivalence table
   - Document which APIs are JGit-compatible
   - Example migrations from JGit

## Conclusion

The diff package has excellent JGit alignment in **text-diff** and **patch** modules, with clean, well-designed APIs. The **delta** module uses different patterns that could be unified with the JGit approach for consistency.

**Key Strengths**:
- Clean separation of concerns
- Well-typed APIs
- Good JGit fidelity in ported code

**Key Opportunities**:
- Unify binary diff under `Sequence` pattern
- Complete binary patch application
- Bridge `DeltaRange` and `Edit` concepts
- Support Git binary delta format

The codebase is well-structured and ready for incremental improvements to increase alignment and completeness.
