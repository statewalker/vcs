# 06-internal-storage

Low-level object and pack operations for application integration. This example walks through how Git stores data internally -- from individual loose objects and pack files to delta compression -- and shows how to use these primitives directly in your own applications.

## Quick Start

```bash
# From the monorepo root
pnpm install
pnpm --filter @statewalker/vcs-example-06-internal-storage start
```

## Running Individual Steps

Each step can be run independently:

```bash
pnpm --filter @statewalker/vcs-example-06-internal-storage step:01  # Loose objects
pnpm --filter @statewalker/vcs-example-06-internal-storage step:02  # Pack files
pnpm --filter @statewalker/vcs-example-06-internal-storage step:03  # Garbage collection
pnpm --filter @statewalker/vcs-example-06-internal-storage step:04  # Direct storage
pnpm --filter @statewalker/vcs-example-06-internal-storage step:05  # Delta internals
```

## What You'll Learn

- How Git stores individual objects as compressed loose files
- How pack files bundle objects for efficient storage
- How garbage collection removes redundant data
- How to bypass the Git workflow for content-addressable storage
- How delta compression represents changes between similar content

## Prerequisites

- Node.js 18+
- pnpm
- Completed [01-quick-start](../01-quick-start/)

---

## Step-by-Step Guide

### Step 1: Loose Objects

**File:** [src/steps/01-loose-objects.ts](src/steps/01-loose-objects.ts)

Every Git object starts life as a loose file, stored individually in `.git/objects`. The filename is derived from the SHA-1 hash of its content: the first two characters form the directory, and the remaining 38 become the filename.

```typescript
import { FileMode } from "@statewalker/vcs-core";

// Initialize a file-based history
const files = createFilesApi();
const history = await createFileHistory({
  files,
  gitDir: ".git",
  create: true,
  defaultBranch: "main",
});

// Store a blob -- this creates a loose object under .git/objects/
const content = "# Internal Storage Example\n\nDemonstrating low-level Git storage.";
const blobId = await storeBlob(history, content);
// Stored at .git/objects/<first-2-chars>/<remaining-38-chars>

// Create a tree referencing the blob
const treeId = await history.trees.store([
  { mode: FileMode.REGULAR_FILE, name: "README.md", id: blobId },
]);
```

**Key APIs:**
- `history.blobs.store()` - Store content as a blob, returns its SHA-1 ObjectId
- `history.trees.store()` - Create a tree entry from file mode, name, and blob ID
- `history.commits.store()` - Create a commit referencing a tree
- `decompressBlock()` - Decompress raw loose object data for inspection

---

### Step 2: Pack Files

**File:** [src/steps/02-pack-files.ts](src/steps/02-pack-files.ts)

Once a repository accumulates many loose objects, pack files bundle them together for compact storage. A pack file contains compressed object data, and its companion `.idx` file enables fast lookups by object ID.

```typescript
import { ObjectType, PackWriterStream, writePackIndexV2 } from "@statewalker/vcs-core";
import { bytesToHex } from "@statewalker/vcs-utils";

// Create a pack writer and add objects
const packWriter = new PackWriterStream();
await packWriter.addObject(objectId, ObjectType.BLOB, content);

// Finalize and write to disk
const result = await packWriter.finalize();
const packName = `pack-${bytesToHex(result.packChecksum)}`;

await fs.writeFile(`${packName}.pack`, result.packData);

// Generate the index for fast lookups
const indexData = await writePackIndexV2(result.indexEntries, result.packChecksum);
await fs.writeFile(`${packName}.idx`, indexData);
```

**Key APIs:**
- `PackWriterStream` - Incrementally build a pack file from objects
- `PackWriterStream.addObject()` - Add an object by ID, type, and content
- `PackWriterStream.finalize()` - Produce pack data, index entries, and checksum
- `writePackIndexV2()` - Generate a v2 pack index from finalized entries

---

### Step 3: Garbage Collection

**File:** [src/steps/03-garbage-collection.ts](src/steps/03-garbage-collection.ts)

After packing, loose objects that already exist in pack files become redundant. Garbage collection identifies and removes these duplicates, reclaiming disk space.

```typescript
import { countLooseObjects, listPackFiles } from "../shared/index.js";

// Before GC: loose objects + pack files (duplicates)
const { count: looseBefore, objects: looseObjectIds } = await countLooseObjects();
const packs = await listPackFiles();

// Remove loose objects that are now in the pack
for (const objectId of looseObjectIds) {
  const prefix = objectId.substring(0, 2);
  const suffix = objectId.substring(2);
  await fs.unlink(path.join(OBJECTS_DIR, prefix, suffix));
}

// After GC: only pack files remain (no duplicates)
const { count: looseAfter } = await countLooseObjects();
```

**Key APIs:**
- `countLooseObjects()` - Count and list loose objects on disk
- `listPackFiles()` - Enumerate existing pack files
- `getPackFileStats()` - Get size information for each pack

---

### Step 4: Direct Storage

**File:** [src/steps/04-direct-storage.ts](src/steps/04-direct-storage.ts)

The blob store can be used as a standalone content-addressable storage layer, without going through the Git index-stage-commit workflow. Identical content is automatically deduplicated because the object ID is derived from the content hash.

```typescript
// Store content directly (no git add, no commit)
const version1 = new TextEncoder().encode("Version 1 content");
const version2 = new TextEncoder().encode("Version 2 content with changes");

const id1 = await history.blobs.store([version1]);
const id2 = await history.blobs.store([version2]);

// Automatic deduplication -- same content yields the same ID
const id3 = await history.blobs.store([version1]);
console.log(id1 === id3); // true

// Load content back
const chunks: Uint8Array[] = [];
const stream = await history.blobs.load(id1);
for await (const chunk of stream) {
  chunks.push(chunk);
}
```

**Key APIs:**
- `history.blobs.store()` - Store arbitrary bytes, returns content-addressed ObjectId
- `history.blobs.load()` - Load content as an async iterable of chunks
- `history.objects.getHeader()` - Retrieve object type and size without loading content

---

### Step 5: Delta Internals

**File:** [src/steps/05-delta-internals.ts](src/steps/05-delta-internals.ts)

Delta compression stores only the differences between a base and a target. The algorithm produces copy instructions (reuse bytes from the base) and insert instructions (add new bytes). This is how pack files avoid storing full copies of similar content.

```typescript
import { applyDelta, createDelta, createDeltaRanges } from "@statewalker/vcs-utils/diff";

const base = new TextEncoder().encode("Hello World! This is the original content.");
const target = new TextEncoder().encode("Hello World! This is the modified content.");

// Compute delta ranges (what to copy vs insert)
const ranges = [...createDeltaRanges(base, target)];
// e.g. [COPY 33 bytes from offset 0, INSERT 9 bytes "modified."]

// Build binary delta instructions
const delta = [...createDelta(base, target, ranges)];

// Reconstruct the target from base + delta
const chunks = [...applyDelta(base, delta)];
```

**Key APIs:**
- `createDeltaRanges()` - Identify matching and differing regions between base and target
- `createDelta()` - Generate binary delta instructions from ranges
- `applyDelta()` - Reconstruct target content by applying delta to a base

---

## Key Concepts

### Loose vs Packed Storage

Git stores objects in two forms. Loose objects are individual zlib-compressed files under `.git/objects/`, named by their SHA-1 hash. This is simple but inefficient when the repository grows large. Pack files solve this by bundling many objects together with delta compression, dramatically reducing storage requirements.

### Content-Addressable Deduplication

Because every object's ID is the SHA-1 hash of its content, storing the same bytes twice always yields the same ID. This makes deduplication automatic and zero-cost. You can use `blobs.store()` as a general-purpose content-addressable store for any application, not just Git workflows.

### When to Use Low-Level APIs

Low-level APIs are the right choice when you need content-addressable storage without the full Git workflow, when you are integrating versioning directly into an application, or when you need to understand or debug Git internals. For standard Git operations like committing, pushing, and branching, the high-level Commands API in [02-porcelain-commands](../02-porcelain-commands/) is more appropriate.

### Delta Format

Git deltas consist of two instruction types: **copy** (reuse a range of bytes from the base object) and **insert** (include literal new bytes). A rolling hash identifies matching blocks between base and target. The delta header records the source and target sizes, followed by a sequence of these instructions. This format is most effective for text files with incremental changes and least effective for encrypted or heavily compressed binary content.

---

## Project Structure

```
apps/examples/06-internal-storage/
├── package.json
├── tsconfig.json
├── README.md
└── src/
    ├── main.ts                          # Entry point (runs all steps)
    ├── shared/
    │   └── index.ts                     # Shared utilities and configuration
    └── steps/
        ├── 01-loose-objects.ts          # Loose object storage
        ├── 02-pack-files.ts             # Pack file creation
        ├── 03-garbage-collection.ts     # Removing redundant objects
        ├── 04-direct-storage.ts         # Content-addressable storage
        └── 05-delta-internals.ts        # Delta compression
```

---

## Output Example

```
============================================================
          Internal Storage Example
          Low-Level Object & Pack Operations
============================================================

Running all steps...

======================================================================
  Step 01: Understanding Loose Objects
======================================================================
[12:00:01] Creating content to demonstrate loose object storage...

[12:00:01] Created blobs:
  README.md: a1b2c3d
  config.txt: e4f5a6b

[12:00:01] Created tree:
  Tree ID: 9c8d7e6

[12:00:01] Created commit:
  Commit ID: f0e1d2c

  Total loose objects: 4

  Loose object locations:
  .git/objects/a1/b2c3d4e5f6...
  .git/objects/e4/f5a6b7c8d9...

  Object a1b2c3d structure:
  Compressed size: 58 bytes
  Decompressed size: 82 bytes
  Header: blob 65
  Content preview: "# Internal Storage Example..."

  [OK] Loose object demonstration complete!

======================================================================
  Step 02: Understanding Pack Files
======================================================================
  Loose objects: 4
  Pack files: 0

  Added blob: a1b2c3d (65 bytes)
  Added blob: e4f5a6b (30 bytes)
  Added tree: 9c8d7e6 (72 bytes)
  Added commit: f0e1d2c (198 bytes)

  Pack created with 4 objects
  Pack data size: 312 bytes

  Written: pack-abc123.pack
  Written: pack-abc123.idx

  [OK] Pack file demonstration complete!

======================================================================
  Step 03: Garbage Collection
======================================================================
  Loose objects: 4
  Pack files: 1

  Removed loose: a1b2c3d...
  Removed loose: e4f5a6b...
  Removed loose: 9c8d7e6...
  Removed loose: f0e1d2c...

  Deleted 4 loose objects
  Reduced loose objects by 100%

  [OK] Garbage collection complete!

======================================================================
  Step 04: Direct Storage (Bypassing Git Index)
======================================================================
  Version 1: a1b2c3d
  Version 2: d4e5f6a
  Version 3: a1b2c3d

  Same content = Same ID: true

  [OK] Direct storage demonstration complete!

======================================================================
  Step 05: Delta Compression Internals
======================================================================
  Base: "Hello World! This is the original content." (43 bytes)
  Target: "Hello World! This is the modified content." (43 bytes)

  COPY 33 bytes from base at offset 0
  INSERT 9 bytes: "modified."

  Reconstructed matches original: true

  [OK] Delta compression demonstration complete!

Example completed successfully!
```

---

## API Reference Links

### Core Package (packages/core)

| Interface/Class | Location | Purpose |
|-----------------|----------|---------|
| `History` | [history/create-history.ts](../../../packages/core/src/history/create-history.ts) | Repository history interface |
| `GitObjectStore` | [history/objects/](../../../packages/core/src/history/objects/) | Low-level object storage |
| `PackWriterStream` | [backend/git/pack/pack-writer.ts](../../../packages/core/src/backend/git/pack/pack-writer.ts) | Create pack files |
| `writePackIndexV2` | [backend/git/pack/pack-index-writer.ts](../../../packages/core/src/backend/git/pack/pack-index-writer.ts) | Generate pack index |
| `FileRawStorage` | [storage/raw/file-raw-storage.ts](../../../packages/core/src/storage/raw/file-raw-storage.ts) | File-based raw storage |
| `CompressedRawStorage` | [storage/raw/compressed-raw-storage.ts](../../../packages/core/src/storage/raw/compressed-raw-storage.ts) | Compressed storage wrapper |
| `createFileRefStore` | [history/refs/ref-store.files.ts](../../../packages/core/src/history/refs/ref-store.files.ts) | File-based ref storage |

### Utils Package (packages/utils)

| Function | Location | Purpose |
|----------|----------|---------|
| `createDeltaRanges` | [diff/delta/create-delta-ranges.ts](../../../packages/utils/src/diff/delta/create-delta-ranges.ts) | Compute matching regions |
| `createDelta` | [diff/delta/create-delta.ts](../../../packages/utils/src/diff/delta/create-delta.ts) | Generate delta instructions |
| `applyDelta` | [diff/delta/apply-delta.ts](../../../packages/utils/src/diff/delta/apply-delta.ts) | Reconstruct from delta |
| `decompressBlock` | [compression/](../../../packages/utils/src/) | Decompress zlib data |

---

## Next Steps

- [03-object-model](../03-object-model/) - Understanding Git's four object types (blobs, trees, commits, tags)
- [11-delta-strategies](../11-delta-strategies/) - Advanced delta compression strategies and tuning
