# Example 3: Streaming Pack Writer with OFS_DELTA

## Overview

Demonstrates using `PackWriterStream` to build pack files incrementally
with offset-based delta (OFS_DELTA) encoding. Shows how to create deltas
between similar objects to reduce pack size.

## What it does

1. Reads objects from an existing pack file
2. Creates a `PackWriterStream` instance
3. Writes objects incrementally, creating deltas when beneficial
4. Uses `OFS_DELTA` encoding (offset-based references)
5. Finalizes and saves the new pack file

## Usage

```bash
pnpm example:03 ./test-data/test.pack
```

## Key Concepts

### PackWriterStream

The streaming writer allows building packs incrementally:

```typescript
const writer = new PackWriterStream();

// Add whole objects
await writer.addObject(id, type, content);

// Add delta object (OFS_DELTA)
await writer.addOfsDelta(id, baseId, deltaData);

// Add delta object (REF_DELTA)
await writer.addRefDelta(id, baseId, deltaData);

// Get current offset (for tracking)
const offset = writer.getCurrentOffset();

// Finalize and get result
const result = await writer.finalize();
```

### OFS_DELTA vs REF_DELTA

**OFS_DELTA (Offset Delta)**
- References base by negative byte offset
- More compact encoding
- Requires base to be earlier in same pack
- Faster to resolve (no hash lookup)

**REF_DELTA (Reference Delta)**
- References base by object ID (SHA-1)
- More flexible (base can be anywhere)
- Larger header (20 extra bytes for ID)
- Used in thin packs over network

### Delta Format

Git deltas consist of:

1. **Header**: Variable-length encoded sizes
   - Base object size
   - Result object size

2. **Commands**: Mix of COPY and INSERT
   - `COPY`: Copy bytes from base (0x80+ byte)
   - `INSERT`: Add new bytes (0x01-0x7F byte)

```
Delta structure:
  [base_size varint] [result_size varint] [command] [command] ...

COPY command (0x80 | flags):
  - Offset bytes (0-4, indicated by flags 0x01-0x08)
  - Size bytes (0-3, indicated by flags 0x10-0x40)

INSERT command (length byte, 1-127):
  - Literal bytes to insert
```

## APIs Demonstrated

### Streaming Writer

```typescript
import { PackWriterStream, PackObjectType } from "@statewalker/vcs-core";

const writer = new PackWriterStream();

// Write base object first
await writer.addObject(
  "abc123...",
  PackObjectType.BLOB,
  new Uint8Array([/* content */])
);

// Write delta referencing the base
await writer.addOfsDelta(
  "def456...",
  "abc123...",  // Base ID (must be written earlier)
  deltaBytes
);

const result = await writer.finalize();
// result.packData - complete pack file bytes
// result.packChecksum - SHA-1 of pack
// result.indexEntries - entries with offsets and CRC32
```

### Creating Deltas

```typescript
// Simple delta for similar objects
function createDelta(base: Uint8Array, target: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];

  // Header: base size and result size
  chunks.push(encodeVarint(base.length));
  chunks.push(encodeVarint(target.length));

  // Find matching prefix
  let prefixLen = findMatchingPrefix(base, target);
  if (prefixLen > 0) {
    chunks.push(createCopyCommand(0, prefixLen));
  }

  // Insert different middle section
  const middle = target.slice(prefixLen, -suffixLen);
  if (middle.length > 0) {
    chunks.push(createInsertCommand(middle));
  }

  // Copy matching suffix
  if (suffixLen > 0) {
    chunks.push(createCopyCommand(base.length - suffixLen, suffixLen));
  }

  return concat(chunks);
}
```

## Expected Output

```
=== Git Pack Writer: Streaming with OFS_DELTA ===

  Input pack: ./test-data/test.pack
  Input index: ./test-data/test.idx

--- Reading Source Pack ---
  Object count: 15

--- Objects by Type ---
  blob: 8 objects
  tree: 4 objects
  commit: 3 objects

--- Creating Pack with PackWriterStream ---

  Processing blob objects...
  Processing tree objects...
  Processing commit objects...

--- Finalizing Pack ---
  Whole objects: 12
  Delta objects: 3
  Delta savings: 456 bytes
  Pack size: 1.1 KB

--- Size Comparison ---
  Original pack: 1234 bytes
  New pack: 1145 bytes
  Size change: -89 bytes (-7.2%)

--- Verification ---
  All objects in index: YES
  Index entry count: 15

Done!
```

## When to Use Streaming Writer

Use `PackWriterStream` when:

1. **Building incrementally**: Objects arrive one at a time
2. **Using OFS_DELTA**: Need offset-based deltas
3. **Custom ordering**: Control exact object layout
4. **Progress tracking**: Monitor offset during writing

Use `writePack()` when:
1. **Batch writing**: All objects available upfront
2. **Simpler API**: Don't need streaming control
3. **REF_DELTA only**: Using ID-based deltas

## Delta Optimization Tips

1. **Write bases first**: Smaller/older versions before larger/newer
2. **Group by type**: Deltas work best between same-type objects
3. **Size threshold**: Skip delta if savings < 10%
4. **Chain depth**: Limit delta chains (Git default: 50)
