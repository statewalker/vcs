# 03-object-model

**Goal:** Understand Git's internal object model (blobs, trees, commits, tags).

## What You'll Learn

- How Git stores file content (blobs)
- How Git represents directories (trees)
- The anatomy of a commit object
- Difference between lightweight and annotated tags
- Content-addressable storage and deduplication

## Prerequisites

- Node.js 18+
- pnpm
- Completed [01-quick-start](../01-quick-start/)

## Running

Run all steps:
```bash
pnpm start
```

Run individual steps:
```bash
pnpm step:01  # Blob storage
pnpm step:02  # Tree structure
pnpm step:03  # Commit anatomy
pnpm step:04  # Tags
pnpm step:05  # Deduplication
```

## Steps Overview

### Step 1: Blob Storage
Content-addressable storage using SHA-1 hashes.

### Step 2: Tree Structure
Directory snapshots with file modes and object references.

### Step 3: Commit Anatomy
Commit objects linking trees to history.

### Step 4: Tags
Lightweight refs vs annotated tag objects.

### Step 5: Deduplication
Same content = same hash = automatic deduplication.

## Key Concepts

### Content-Addressable Storage

Git uses SHA-1 hashes to identify objects. The hash is computed from the content, so:
- Identical content always produces the same hash
- The hash serves as both identifier and integrity check

### Object Types

| Type | Description | Contains |
|------|-------------|----------|
| blob | File content | Raw bytes |
| tree | Directory | List of (mode, name, id) entries |
| commit | Snapshot | tree, parents, author, message |
| tag | Annotated tag | object, type, tagger, message |

### File Modes

| Mode | Octal | Description |
|------|-------|-------------|
| TREE | 040000 | Directory |
| REGULAR_FILE | 100644 | Normal file |
| EXECUTABLE_FILE | 100755 | Executable file |
| SYMLINK | 120000 | Symbolic link |
| GITLINK | 160000 | Submodule reference |

## Next Steps

- [04-branching-merging](../04-branching-merging/) - Advanced branching and merging
- [06-internal-storage](../06-internal-storage/) - Storage internals (loose objects, pack files)
