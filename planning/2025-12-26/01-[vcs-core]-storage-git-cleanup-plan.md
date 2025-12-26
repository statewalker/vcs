# Storage-Git to Core Migration Plan

This plan migrates useful code from `packages/storage-git` to `packages/core` before removing storage-git entirely.

## Implementation Status

**Completed**: Phase 1 and Phase 2 binary storage migration
- [x] Renamed `MemoryRawStore` and `MemoryVolatileStore` to follow naming convention
- [x] Migrated `FileRawStore` to `core/src/binary/raw-store.files.ts`
- [x] Migrated `FileVolatileStore` to `core/src/binary/volatile-store.files.ts`
- [x] Created `CompressedRawStore` at `core/src/binary/raw-store.compressed.ts`
- [x] Added comprehensive tests for all storage implementations
- [x] Updated `storage-git` to re-export from core (backwards compatible)

**Note**: The `storage-git` package cannot be fully removed yet because:
- `@webrun-vcs/commands` depends on `GitRepository`, `createGitStorage`, `serializeCommit/Tree`
- `@webrun-vcs/storage-tests` depends on `createFileObjectStores`

These are higher-level abstractions that remain in storage-git. The binary storage layer has been successfully migrated to core.

## Overview

The `packages/storage-git` package will be **reduced in scope**. After careful analysis, most functionality already exists in core. The binary storage implementations have been migrated.

---

## Analysis Summary: Already in Core (NO MIGRATION NEEDED)

| Category | storage-git | Core Equivalent |
|----------|-------------|-----------------|
| Pack files | `src/pack/*` | `core/src/pack/*` (complete) |
| Refs | `src/refs/*` | `core/src/refs/*` (complete) |
| Working tree | `src/worktree/file-tree-iterator.ts` | `core/src/worktree/working-tree-iterator.impl.ts` |
| Checkout | `src/worktree/checkout-command.ts` | `core/src/commands/checkout.command.impl.ts` |
| Staging | `src/staging/*` | `core/src/staging/*` (complete) |
| File utils | `src/utils/file-utils.ts` | `core/src/utils/file-utils.ts` |
| Varint | `src/utils/varint.ts` | `core/src/utils/varint.ts` |
| Format | `src/format/*` | Deprecated, all in `core/src/objects/*` |
| Delta storage | `src/delta/*` | `core/src/delta/*` |
| GC | `src/gc/*` | `core/src/delta/gc-controller.ts` |
| Typed storage | `src/git-*-storage.ts` | `core/src/*-store.impl.ts` |
| Loose objects | `src/loose/*` | Replaced by `GitObjectStoreImpl` + `CompressedRawStore` + `FileRawStore` |

---

## Phase 1: File-Based Binary Storage

Core only has memory implementations (`MemoryRawStore`, `MemoryVolatileStore`). File-based implementations need migration.

### Files to Migrate

| Source | Target | Description |
|--------|--------|-------------|
| `src/binary-storage/file-raw-store.ts` | `core/src/binary/raw-store.files.ts` | `FileRawStore implements RawStore` |
| `src/binary-storage/file-volatile-store.ts` | `core/src/binary/volatile-store.files.ts` | `FileVolatileStore implements VolatileStore` |

### Tasks

1. Copy files to `packages/core/src/binary/`
2. Update imports to use `@webrun-vcs/core` internal paths
3. Export from `packages/core/src/binary/index.ts`
4. Add tests from `packages/storage-git/tests/binary-storage/`

---

## Phase 2: Create CompressedRawStore

Instead of migrating loose object code, create a new `CompressedRawStore` that wraps any `RawStore` with zlib deflate/inflate.

### New File to Create

| Target | Description |
|--------|-------------|
| `core/src/binary/raw-store.compressed.ts` | `CompressedRawStore implements RawStore` - wraps RawStore with zlib compression |

### Architecture

```
GitObjectStoreImpl (typed objects with headers)
  └── RawStoreWithDelta (optional delta compression)
        └── CompressedRawStore (zlib deflate/inflate)
              └── FileRawStore (file storage in .git/objects/XX/YYY...)
```

### Tasks

1. Create `CompressedRawStore` class that wraps `RawStore`
2. Implement `store()` - deflate content before delegating
3. Implement `load()` - inflate content after loading
4. Export from `packages/core/src/binary/index.ts`
5. Add tests for compression/decompression

---

## Phase 3: Cleanup and Verification

### Tasks

1. **Run core tests**: `pnpm --filter @webrun-vcs/core test`
2. **Run type check**: `pnpm --filter @webrun-vcs/core exec tsc --noEmit`
3. **Update core exports**: Add new modules to `src/binary/index.ts`
4. **Run full build**: `pnpm build`
5. **Remove storage-git**: Delete `packages/storage-git/` directory
6. **Update workspace**: Remove from `pnpm-workspace.yaml` if listed
7. **Update dependencies**: Remove `@webrun-vcs/storage-git` from dependents

---

## Migration Summary

| Category | Files | Description |
|----------|-------|-------------|
| File binary storage | 2 files (migrate) | `FileRawStore`, `FileVolatileStore` |
| Compressed storage | 1 file (create) | `CompressedRawStore` - zlib wrapper |
| **Total** | **3 files** | |

---

## Execution Order

1. **Phase 1** (File binary storage) - Migrate `FileRawStore`, `FileVolatileStore`
2. **Phase 2** (CompressedRawStore) - Create new zlib wrapper
3. **Phase 3** (Cleanup) - Verification and removal

---

## Post-Migration

After removing storage-git, update packages that depend on it:

```bash
# Find dependents
grep -r "@webrun-vcs/storage-git" packages/*/package.json
```

Update each dependent to import from `@webrun-vcs/core` instead.
