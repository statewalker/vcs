# Example 2: Roundtrip with Delta Preservation

## Overview

Demonstrates analyzing delta relationships in Git pack files and understanding
how delta compression works. Shows the structure of delta chains and the
size impact of delta compression.

## What it does

1. Reads pack file and analyzes object headers
2. Identifies delta objects (OFS_DELTA and REF_DELTA)
3. Builds a dependency graph of base/delta relationships
4. Sorts objects topologically (bases before deltas)
5. Writes a new pack without deltas for comparison
6. Shows size impact of delta compression

## Usage

```bash
pnpm example:02 ./test-data/test.pack
```

## Key Concepts

### Delta Types

Git pack files support two types of delta encoding:

**OFS_DELTA (type 6)**
- References base object by negative byte offset
- More efficient (no ID lookup required)
- Base must be earlier in the same pack file

**REF_DELTA (type 7)**
- References base object by SHA-1 ID
- More flexible (base can be anywhere)
- Used in thin packs sent over the network

### Delta Chain

Objects can form chains:
```
blob A (base)
  └── blob B (delta of A)
        └── blob C (delta of B)
```

Git limits chain depth (default: 50) to prevent excessive recursion.

### Object Header

Each object in a pack has a header:
```typescript
interface PackObjectHeader {
  type: PackObjectType;     // 1-4 for base types, 6-7 for deltas
  size: number;             // Uncompressed size (delta size for deltas)
  baseOffset?: number;      // For OFS_DELTA
  baseId?: string;          // For REF_DELTA
  headerLength: number;     // Bytes consumed by header
}
```

## APIs Demonstrated

### Reading Object Headers
```typescript
// Get header without resolving delta
const header = await reader.readObjectHeader(offset);

if (header.type === PackObjectType.OFS_DELTA) {
  const baseOffset = offset - header.baseOffset!;
  console.log(`Delta based on object at offset ${baseOffset}`);
}

if (header.type === PackObjectType.REF_DELTA) {
  console.log(`Delta based on object ${header.baseId}`);
}
```

### Writing with REF_DELTA
```typescript
// To preserve delta structure, use deltaBaseId and deltaData
const deltaObject: PackWriterObject = {
  id: objectId,
  type: PackObjectType.REF_DELTA,
  content: new Uint8Array(0),  // Not used for deltas
  deltaBaseId: baseObjectId,
  deltaData: rawDeltaBytes,
};
```

## Expected Output

```
=== Git Pack Roundtrip: Delta Preservation ===

  Input pack: ./test-data/test.pack
  Input index: ./test-data/test.idx

--- Reading Index ---
  Index version: 2
  Object count: 15

--- Analyzing Objects ---
  Whole objects: 10
  OFS_DELTA objects: 5
  REF_DELTA objects: 0
  Total delta objects: 5

--- Delta Chains ---
  Found 3 base objects with deltas:
    abc1234 <- 2 delta(s)
      def5678
      ghi9012
    ...

--- Size Comparison ---
  Original pack: 1234 bytes
  Repacked (no deltas): 2567 bytes
  Size change: +1333 bytes (+108.0%)

  Note: Pack grew because delta objects were expanded to full objects.
  Git uses deltas to reduce pack size by storing differences.

--- Verification ---
  All objects present: YES

Done!
```

## Why Size Increases Without Deltas

When we write a pack without delta encoding:
1. Each object is stored in full
2. Similar objects (e.g., versions of same file) take full space
3. Compression helps but can't match delta efficiency

Git's delta compression is particularly effective for:
- Text files with small changes between versions
- Files that share content
- Tree objects with similar directory structures

## Real Delta Preservation

To truly preserve deltas, you would need to:
1. Read raw compressed delta bytes from pack
2. Pass them through to the writer unchanged
3. Ensure base objects are written first

This requires lower-level access to the pack file than the current API provides.
