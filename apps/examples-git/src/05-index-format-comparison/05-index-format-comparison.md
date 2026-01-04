# Example 5: Index Format Comparison (V1 vs V2)

## Overview

Demonstrates the differences between Git pack index format versions,
including structure, size, and feature comparisons.

## What it does

1. Reads an existing pack index file
2. Extracts all entries with their metadata
3. Writes both V1 and V2 format indexes
4. Compares sizes and structure
5. Verifies both formats round-trip correctly

## Usage

```bash
pnpm example:05 ./test-data/test.idx
# Or with pack file (will use corresponding .idx)
pnpm example:05 ./test-data/test.pack
```

## Key Concepts

### Index Format History

**V1 (Original, pre-2006)**
- Simple format without magic header
- No CRC32 checksums
- 32-bit offsets only (max 4GB packs)

**V2 (Current, 2006+)**
- Magic header: `0xFF 't' 'O' 'c'`
- CRC32 per object for integrity
- 64-bit offset support for large packs
- Separate tables for efficient access

### V1 Format Structure

```
┌────────────────────────────────────────┐
│ Fanout Table (1024 bytes)              │
│   256 × 4-byte cumulative counts       │
├────────────────────────────────────────┤
│ Entries (N × 24 bytes each)            │
│   For each object:                     │
│   - 4-byte offset                      │
│   - 20-byte object ID (SHA-1)          │
├────────────────────────────────────────┤
│ Pack Checksum (20 bytes)               │
│ Index Checksum (20 bytes)              │
└────────────────────────────────────────┘
```

Size formula: `256×4 + N×24 + 40 = 1064 + N×24 bytes`

### V2 Format Structure

```
┌────────────────────────────────────────┐
│ Header (8 bytes)                       │
│   - Magic: 0xFF744F63                  │
│   - Version: 0x00000002                │
├────────────────────────────────────────┤
│ Fanout Table (1024 bytes)              │
│   256 × 4-byte cumulative counts       │
├────────────────────────────────────────┤
│ Object IDs (N × 20 bytes)              │
│   Sorted SHA-1 hashes                  │
├────────────────────────────────────────┤
│ CRC32 Values (N × 4 bytes)             │
│   Per-object checksums                 │
├────────────────────────────────────────┤
│ 32-bit Offsets (N × 4 bytes)           │
│   Pack offsets (or 64-bit indices)     │
├────────────────────────────────────────┤
│ 64-bit Offsets (M × 8 bytes)           │
│   For offsets > 2GB                    │
├────────────────────────────────────────┤
│ Pack Checksum (20 bytes)               │
│ Index Checksum (20 bytes)              │
└────────────────────────────────────────┘
```

Size formula: `8 + 256×4 + N×20 + N×4 + N×4 + M×8 + 40`
            = `1072 + N×28 + M×8 bytes`

### Size Comparison

For a pack with 1000 objects (no 64-bit offsets):

| Format | Size    | Per Object |
|--------|---------|------------|
| V1     | 25,064 B| 24 bytes   |
| V2     | 29,072 B| 28 bytes   |

V2 is ~16% larger due to CRC32 values.

## APIs Demonstrated

### Reading Index

```typescript
import { readPackIndex } from "@statewalker/vcs-core";

const idxData = await files.read(indexPath);
const index = readPackIndex(idxData);

// Auto-detects version from content
console.log(index.version);      // 1 or 2
console.log(index.objectCount);
console.log(index.hasCRC32Support()); // V2 only
```

### Writing V1 Index

```typescript
import { writePackIndexV1 } from "@statewalker/vcs-core";

const entries: PackIndexWriterEntry[] = [
  { id: "abc123...", offset: 12, crc32: 0 },
  // ... sorted by id
];

const v1Data = await writePackIndexV1(entries, packChecksum);
```

### Writing V2 Index

```typescript
import { writePackIndexV2 } from "@statewalker/vcs-core";

const entries: PackIndexWriterEntry[] = [
  { id: "abc123...", offset: 12, crc32: 0x1a2b3c4d },
  // ... sorted by id
];

const v2Data = await writePackIndexV2(entries, packChecksum);
```

### Choosing Format Automatically

```typescript
import { writePackIndex, oldestPossibleFormat } from "@statewalker/vcs-core";

// Returns 1 if all offsets fit in 32-bit, else 2
const version = oldestPossibleFormat(entries);

// Or let the function decide
const idxData = await writePackIndex(entries, checksum);
```

## Expected Output

```
=== Git Pack Index: Format Comparison ===

  Input index: ./test-data/test.idx

--- Reading Original Index ---
  File size: 1.1 KB
  Version: 2
  Object count: 15
  CRC32 support: true
  64-bit offsets: 0

--- Extracting Entries ---
  Entries extracted: 15
  Max offset: 1234

  Sample entries (first 5):
    abc1234 offset=12 crc32=1a2b3c4d
    def5678 offset=156 crc32=2b3c4d5e
    ...

--- Writing V1 Index ---
  Actual size: 1.4 KB
  Expected size: 1.4 KB

  V1 Structure:
    Fanout table:    1024 bytes
    Entries:         360 bytes (15 × 24)
    Pack checksum:   20 bytes
    Index checksum:  20 bytes
    Total:           1424 bytes

--- Writing V2 Index ---
  Actual size: 1.5 KB

  V2 Structure:
    Magic + version: 8 bytes
    Fanout table:    1024 bytes
    Object IDs:      300 bytes (15 × 20)
    CRC32 values:    60 bytes (15 × 4)
    32-bit offsets:  60 bytes (15 × 4)
    Pack checksum:   20 bytes
    Index checksum:  20 bytes
    Total:           1492 bytes

--- Size Comparison ---

  Format | Size     | Per Object
  -------|----------|------------
  V1     |   1.4 KB | 24.0 bytes
  V2     |   1.5 KB | 28.0 bytes
  Diff   | +68 bytes| +4.8%

--- Feature Comparison ---

  Feature              | V1    | V2
  ---------------------|-------|-------
  CRC32 per object     | No    | Yes
  64-bit offset support| No    | Yes
  Max pack size        | 4 GB  | >4 GB

Done!
```

## When to Use Each Format

### V1 Format
- Maximum compatibility with ancient Git
- Slightly smaller files
- Simple tooling that doesn't need CRC32

### V2 Format (Recommended)
- Default for all modern Git operations
- Enables CRC32 verification
- Supports packs larger than 2GB
- Used by Git since 2006
