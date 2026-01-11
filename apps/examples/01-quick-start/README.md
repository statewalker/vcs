# 01-quick-start

**Goal:** Get running in 5 minutes. Create a repository, make commits, view history.

## What You'll Learn

- Initialize an in-memory Git repository
- Store file content as blobs
- Create directory snapshots (trees)
- Make commits
- Update branch references
- View commit history

## Prerequisites

- Node.js 18+
- pnpm

## Running

```bash
pnpm start
```

## Key Concepts

### Content-Addressable Storage

Git stores content using SHA-1 hashes. Identical content always produces the same hash, enabling automatic deduplication.

### Object Types

1. **Blob** - File content
2. **Tree** - Directory snapshot (list of entries with mode, name, and object ID)
3. **Commit** - Links a tree to history with author, message, and parent references

### References

Branches are simply pointers to commits:
- `refs/heads/main` - The main branch
- `HEAD` - Points to the current branch

## Next Steps

- [02-porcelain-commands](../02-porcelain-commands/) - Learn the high-level Git Commands API
- [03-object-model](../03-object-model/) - Deep dive into Git's object model
