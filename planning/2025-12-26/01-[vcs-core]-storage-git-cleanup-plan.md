# Storage-Git to Core Migration Plan

This plan migrates useful code from `packages/storage-git` to `packages/core` before removing storage-git entirely.

## Overview

The `packages/storage-git` package will be **completely removed**. After careful analysis, most functionality already exists in core. Only file-based storage implementations need migration.

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

---

## Phase 1: File-Based Binary Storage

Core only has memory implementations (`MemoryRawStore`, `MemoryVolatileStore`). File-based implementations need migration.

### Files to Migrate

| Source | Target | Description |
|--------|--------|-------------|
| `src/binary-storage/file-raw-store.ts` | `core/src/binary/impl/file-raw-store.ts` | `FileRawStore implements RawStore` |
| `src/binary-storage/file-volatile-store.ts` | `core/src/binary/impl/file-volatile-store.ts` | `FileVolatileStore implements VolatileStore` |
| `src/binary-storage/file-delta-store.ts` | `core/src/binary/impl/file-delta-store.ts` | `FileDeltaStore implements DeltaStore` |
| `src/binary-storage/file-bin-store.ts` | `core/src/binary/impl/file-bin-store.ts` | `FileBinStore implements BinStore` |

### Tasks

1. Copy files to `packages/core/src/binary/impl/`
2. Update imports to use `@webrun-vcs/core` internal paths
3. Export from `packages/core/src/binary/impl/index.ts`
4. Add tests from `packages/storage-git/tests/binary-storage/`

---

## Phase 2: Loose Object Storage

Loose object functions for reading/writing compressed Git objects in `.git/objects/XX/YYY...` format.

### Files to Migrate

| Source | Target | Description |
|--------|--------|-------------|
| `src/loose/loose-object-reader.ts` | `core/src/binary/impl/loose-object-reader.ts` | `hasLooseObject`, `readLooseObject`, `readRawLooseObject` |
| `src/loose/loose-object-writer.ts` | `core/src/binary/impl/loose-object-writer.ts` | `writeLooseObject`, `writeRawLooseObject` |
| `src/loose/file-loose-object-storage.ts` | `core/src/binary/impl/file-loose-object-storage.ts` | `FileLooseObjectStorage` class |

### Tasks

1. Copy files to `packages/core/src/binary/impl/`
2. Update imports (use core's `getLooseObjectPath` from `utils/file-utils.ts`)
3. Export from `packages/core/src/binary/impl/index.ts`
4. Add tests from `packages/storage-git/tests/loose/`

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
| File binary storage | 4 files | `FileRawStore`, `FileVolatileStore`, `FileDeltaStore`, `FileBinStore` |
| Loose objects | 3 files | Reader, writer, and storage class |
| **Total** | **7 files** | File-based implementations of core interfaces |

---

## Execution Order

1. **Phase 1** (File binary storage) - Core interface implementations
2. **Phase 2** (Loose objects) - Depends on file-utils already in core
3. **Phase 3** (Cleanup) - Verification and removal

---

## Post-Migration

After removing storage-git, update packages that depend on it:

```bash
# Find dependents
grep -r "@webrun-vcs/storage-git" packages/*/package.json
```

Update each dependent to import from `@webrun-vcs/core` instead.
