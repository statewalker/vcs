# Example 1: Simple Pack File Roundtrip

## Overview

Demonstrates the basic workflow of reading a Git pack file and writing it back.
This example shows how to use `PackReader` and `writePack()` for fundamental pack file operations.

## What it does

1. Reads a `.pack` file using `PackReader` with its `.idx` index
2. Extracts all objects (commits, trees, blobs, tags)
3. Writes objects back using `writePack()`
4. Creates a new index using `writePackIndexV2()`
5. Compares original and repacked files

## Usage

```bash
# From the examples-git directory
pnpm example:01 ./test-data/test.pack

# Or with an index file
pnpm example:01 ./test-data/test.idx
```

## Key Concepts

### Pack Files
Pack files store Git objects efficiently using compression and delta encoding.
They consist of:
- **Header**: "PACK" signature, version, object count
- **Objects**: Compressed object data
- **Checksum**: SHA-1 of the pack content

### Index Files
Index files (`.idx`) provide random access to objects within pack files:
- **Fanout table**: Quick lookup by first byte of object ID
- **Object IDs**: Sorted list of all objects
- **Offsets**: Byte positions in the pack file

### Delta Resolution
The `PackReader` automatically resolves delta objects:
- `OFS_DELTA`: References base by offset
- `REF_DELTA`: References base by object ID

Both are resolved to their full content when reading.

## APIs Demonstrated

### Reading
```typescript
// Parse index file
const index = readPackIndex(indexData);

// Create reader with index
const reader = new PackReader(files, packPath, index);
await reader.open();

// Get object by ID
const obj = await reader.get(objectId);
// Returns: { type, content, size, offset }
```

### Writing
```typescript
// Prepare objects
const objects: PackWriterObject[] = [
  { id: "abc123...", type: PackObjectType.BLOB, content: new Uint8Array([...]) },
  // ...
];

// Write pack
const result = await writePack(objects);
// Returns: { packData, packChecksum, indexEntries }

// Write index
const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
```

## Expected Output

```
=== Git Pack Roundtrip: Simple ===

  Input pack: ./test-data/test.pack
  Input index: ./test-data/test.idx

--- Reading Index ---
  Index version: 2
  Object count: 15
  CRC32 support: true
  64-bit offsets: 0

--- Reading Objects ---
  [1/15] abc123... blob (42 bytes)
  [2/15] def456... commit (185 bytes)
  ...
  Total: 15 objects collected

--- Writing Pack ---
  Added objects: 15
  Pack size: 1.2 KB

--- Verification ---
  Original pack size: 1234 bytes
  Repacked size: 1245 bytes
  Packs identical: NO

  Note: Repacked files may differ due to:
    - Different compression levels
    - Delta objects resolved to base types
    - Object ordering differences

--- Object Verification ---
  Objects matched: 15/15
  All objects present: YES

Done!
```

## Why Files May Differ

The repacked file may not be byte-identical to the original because:

1. **Compression**: Different zlib compression settings
2. **Delta resolution**: Original may use deltas, repacked uses full objects
3. **Ordering**: Object order may differ
4. **Version**: Pack version differences

However, the **logical content** (all objects and their IDs) remains identical.
