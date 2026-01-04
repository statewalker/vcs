# Example 4: Full Roundtrip with Verification

## Overview

Demonstrates complete pack file roundtrip with detailed logging,
content display, and comprehensive byte-level verification.

## What it does

1. Parses and displays pack file header
2. Parses and displays index file header
3. Reads and shows object content (commits, trees, blobs, tags)
4. Writes new pack and index files
5. Performs byte-level comparison
6. Verifies all object content matches

## Usage

```bash
pnpm example:04 ./test-data/test.pack
```

## Key Concepts

### Pack File Structure

```
Pack File Layout:
┌────────────────────────────────────────┐
│ Header (12 bytes)                      │
│   - Magic: "PACK" (4 bytes)            │
│   - Version: 2 or 3 (4 bytes)          │
│   - Object count (4 bytes)             │
├────────────────────────────────────────┤
│ Objects (variable)                     │
│   For each object:                     │
│   - Type+size header (varint)          │
│   - [Delta base ref] (for deltas)      │
│   - Compressed content (zlib)          │
├────────────────────────────────────────┤
│ Checksum (20 bytes)                    │
│   - SHA-1 of all previous bytes        │
└────────────────────────────────────────┘
```

### Index File Structure (V2)

```
Index V2 Layout:
┌────────────────────────────────────────┐
│ Header (8 bytes)                       │
│   - Magic: 0xFF744F63 (4 bytes)        │
│   - Version: 2 (4 bytes)               │
├────────────────────────────────────────┤
│ Fanout Table (1024 bytes)              │
│   - 256 × 4-byte cumulative counts     │
├────────────────────────────────────────┤
│ Object IDs (N × 20 bytes)              │
│   - Sorted SHA-1 hashes                │
├────────────────────────────────────────┤
│ CRC32 Checksums (N × 4 bytes)          │
│   - Per-object CRC32 values            │
├────────────────────────────────────────┤
│ 32-bit Offsets (N × 4 bytes)           │
│   - Pack offsets (or 64-bit indices)   │
├────────────────────────────────────────┤
│ 64-bit Offsets (M × 8 bytes)           │
│   - For large packs (>2GB)             │
├────────────────────────────────────────┤
│ Pack Checksum (20 bytes)               │
│ Index Checksum (20 bytes)              │
└────────────────────────────────────────┘
```

### Object Display

Different object types are formatted appropriately:

**Commits**
```
tree: abc1234...
parent: def5678...
author: John Doe
---
Initial commit message
```

**Trees**
```
100644 blob abc1234 README.md
040000 tree def5678 src
```

**Blobs**
- Text: First 100 characters
- Binary: Size only

**Tags**
- First 6 lines

## APIs Demonstrated

### Low-level Pack Parsing

```typescript
// Read raw pack header
const packData = await files.read(packPath);

const magic = decodeText(packData.subarray(0, 4)); // "PACK"
const version = readUInt32BE(packData, 4);         // 2
const objectCount = readUInt32BE(packData, 8);     // N
const checksum = packData.subarray(-20);           // SHA-1
```

### Object Header Reading

```typescript
const header = await reader.readObjectHeader(offset);
// header.type - Object type (1-4, 6-7)
// header.size - Uncompressed size
// header.baseOffset - For OFS_DELTA
// header.baseId - For REF_DELTA
// header.headerLength - Bytes consumed
```

### Content Formatting

```typescript
import { parseTree } from "@statewalker/vcs-core";

// Parse tree content
const entries = parseTree(content);
for (const entry of entries) {
  console.log(`${entry.mode} ${entry.id} ${entry.name}`);
}
```

## Expected Output

```
=== Git Pack Roundtrip: Full Verification ===

  Input pack: ./test-data/test.pack

--- Pack File Header ---
  File size: 1.2 KB
  Magic: PACK
  Version: 2
  Object count: 15
  Stored checksum: 9a8b7c6d5e4f...

--- Index File Header ---
  Index version: 2
  Object count: 15
  CRC32 support: true

--- Objects ---

  Object 1: abc1234...
    Type: commit (stored as commit)
    Size: 185 bytes
    Offset: 12
    CRC32: 1a2b3c4d
    Content:
      tree: def5678...
      parent: ghi9012...
      author: John Doe
      ---
      Initial commit

  Object 2: def5678...
    Type: tree (stored as tree)
    Size: 42 bytes
    Content:
      100644 blob jkl3456 README.md
      040000 tree mno7890 src

  ... and 13 more objects

--- Object Summary ---
  commit       3 objects
  tree         4 objects
  blob         8 objects
  Total objects: 15
  Total content size: 2.3 KB

--- Byte-Level Comparison ---

  Pack file:
    Original size: 1234 bytes
    New size: 1567 bytes
    Identical: NO
    First mismatch at: 15
    Mismatch count: 342

  Index file:
    Original size: 1156 bytes
    New size: 1156 bytes
    Identical: NO

--- Logical Verification ---
  Objects verified: 15
  All content matches: YES

--- Summary ---
  Verification:
    Pack identical: NO
    Index identical: NO
    Content matches: YES

Done!
```

## Why Byte-Level Differences Occur

Files may differ at byte level while being logically equivalent:

1. **Compression**: Different zlib settings
2. **Object order**: May be reordered
3. **Delta encoding**: May use different deltas
4. **Offset differences**: Due to compression/order

The key verification is **logical equivalence**:
- Same object IDs
- Same content for each object
- Same total object count
