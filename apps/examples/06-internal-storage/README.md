# Internal Storage Operations

Low-level object and pack operations for application integration.

## What This Demonstrates

This example shows how to work with Git's internal storage directly:

- **Loose Objects**: Individual compressed object files
- **Pack Files**: Bundled objects for efficient storage
- **Garbage Collection**: Cleaning up redundant data
- **Direct Storage**: Bypassing Git workflow for content-addressable storage
- **Delta Compression**: Understanding how similar content is stored efficiently

## Running the Example

```bash
# Run all steps
pnpm start

# Run specific step
pnpm step:01   # Loose objects
pnpm step:02   # Pack files
pnpm step:03   # Garbage collection
pnpm step:04   # Direct storage
pnpm step:05   # Delta compression
```

## Steps Overview

### Step 1: Loose Objects

Demonstrates how Git stores individual objects:

```typescript
// Each object is stored as a compressed file
// .git/objects/ab/cdef1234...

const blobId = await repository.blobs.store([content]);
// Creates loose object at .git/objects/<first-2-chars>/<rest-of-hash>
```

Key concepts:
- Objects are zlib-compressed
- Filename is SHA-1 hash of content
- Format: `"type size\0content"`

### Step 2: Pack Files

Shows how to create pack files for efficient storage:

```typescript
import { PackWriterStream, writePackIndexV2 } from "@statewalker/vcs-core";

const packWriter = new PackWriterStream();

// Add objects to pack
await packWriter.addObject(objectId, ObjectType.BLOB, content);

// Finalize and get pack data
const result = await packWriter.finalize();

// Write pack and index files
await fs.writeFile("pack-xxx.pack", result.packData);
const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
await fs.writeFile("pack-xxx.idx", indexData);
```

Pack structure:
- Header: `PACK` + version + object count
- Entries: compressed object data
- Checksum: SHA-1 of pack content

### Step 3: Garbage Collection

Explains how GC optimizes storage:

```typescript
// Before GC: Loose objects + pack files (duplicates)
// After GC: Only pack files (no duplicates)

// GC removes loose objects that are already packed
for (const objectId of looseObjectIds) {
  await deleteLooseObject(objectId);
}
```

GC strategies:
- Auto GC: Runs when thresholds exceeded
- Aggressive: Recomputes all deltas
- Pruning: Removes unreachable objects

### Step 4: Direct Storage

Using VCS storage without Git workflow:

```typescript
// Store content directly (no git add, commit needed)
const id = await repository.blobs.store([content]);

// Load content back
const chunks = [];
for await (const chunk of repository.blobs.load(id)) {
  chunks.push(chunk);
}

// Automatic deduplication
const id1 = await repository.blobs.store([content]);
const id2 = await repository.blobs.store([content]);
// id1 === id2 (same content = same hash)
```

Use cases:
- Content management systems
- Configuration versioning
- Asset pipelines
- Data versioning for ML

### Step 5: Delta Compression

Understanding how similar content is compressed:

```typescript
import { createDeltaRanges, createDelta, applyDelta } from "@statewalker/vcs-utils/diff";

const base = encode("Hello World! This is the original.");
const target = encode("Hello World! This is the modified.");

// Create delta ranges
const ranges = [...createDeltaRanges(base, target)];
// [COPY 13 bytes from 0, INSERT 8 bytes "modified"]

// Create delta instructions
const delta = [...createDelta(base, target, ranges)];

// Apply delta to reconstruct
const chunks = [...applyDelta(base, delta)];
```

Delta format:
- Copy instruction: offset + size (from base)
- Insert instruction: literal bytes

## When to Use Low-Level APIs

**Use low-level APIs when:**
- Building content-addressable storage
- Need deduplication without Git workflow
- Integrating versioning into applications
- Understanding/debugging Git internals
- Custom pack file manipulation

**Use high-level APIs when:**
- Standard Git operations (commit, push, pull)
- Working with branches and refs
- Need full Git compatibility

## Key APIs

| API | Purpose |
|-----|---------|
| `repository.blobs.store()` | Store blob directly |
| `repository.blobs.load()` | Load blob content |
| `repository.objects.getHeader()` | Get object metadata |
| `PackWriterStream` | Create pack files |
| `writePackIndexV2()` | Create pack index |
| `createDeltaRanges()` | Compute delta ranges |
| `createDelta()` | Create delta instructions |
| `applyDelta()` | Reconstruct from delta |
