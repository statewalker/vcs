# Action Plan: Apps Migration to High-Level APIs

Date: 2025-12-23
Related: [notes/src/2025-12-23/01-[apps-verification]-diagnostics.md](../../notes/src/2025-12-23/01-[apps-verification]-diagnostics.md)

## Overview

This plan outlines the migration of all apps in the `apps/` folder to use exclusively high-level APIs from the webrun-vcs library stack. The goal is to ensure all example applications demonstrate best practices using:

1. **Porcelaine API** (`@webrun-vcs/commands`) - High-level Git commands
2. **Transport API** (`@webrun-vcs/transport`) - Network operations
3. **High-level Stores** (`@webrun-vcs/core`) - Repository, CommitStore, TreeStore, BlobStore, TagStore, RefStore

## Target Architecture

```
Apps should use ONLY:
┌─────────────────────────────────────────────────────┐
│  PORCELAIN (@webrun-vcs/commands)                  │
│  Git.wrap(store).add().commit().push()             │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│  TRANSPORT (@webrun-vcs/transport)                 │
│  clone(), fetch(), push(), createGitHttpServer()   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│  TYPED STORES (@webrun-vcs/core Repository)        │
│  repository.commits, .trees, .blobs, .tags, .refs  │
└─────────────────────────────────────────────────────┘
```

## Phase 1: Fix Critical Issues

### 1.1 Unicode Path Handling (example-git-perf)

**Problem:** Checkout fails to extract files with non-ASCII paths (Japanese characters).

**Root Cause Investigation:**
- Check `WorkTreeStore` or checkout logic in `@webrun-vcs/worktree`
- Verify file path encoding during extraction
- Check if the issue is in the storage layer or file API

**Fix Steps:**
1. Create a minimal reproduction test case with Unicode paths
2. Trace the checkout path from Transport/Porcelaine down to file creation
3. Fix encoding handling in the path processing layer
4. Add unit tests for Unicode paths

**Affected Packages:**
- `@webrun-vcs/worktree` - WorkTree iteration
- `@webrun-vcs/storage-git` - File system operations
- Potentially `@statewalker/webrun-files` - File API

### 1.2 FileHandle Leak (example-vcs-http-roundtrip)

**Problem:** FileHandle objects not explicitly closed, causing deprecation warnings.

**Fix Steps:**
1. Audit file operations in `@webrun-vcs/storage-git`
2. Ensure all FileHandle uses follow try/finally or using patterns
3. Add explicit close() calls in all file reading operations
4. Consider using `using` statement for automatic cleanup (if available)

**Affected Packages:**
- `@webrun-vcs/storage-git` - GitRepository, pack file handling
- `@statewalker/webrun-files` - Low-level file operations

## Phase 2: App-by-App Migration

### 2.1 example-git-cycle

**Current State:** Uses mix of high-level and mid-level APIs.

**Current Dependencies:**
- `@webrun-vcs/vcs`
- `@webrun-vcs/storage-git`
- `@webrun-vcs/utils`

**Migration Tasks:**
1. Replace direct `storage.objects.store()` with `repository.blobs.store()`
2. Replace direct tree manipulation with `repository.trees.storeTree()`
3. Replace direct commit creation with `repository.commits.storeCommit()`
4. Consider using Porcelaine `Git.wrap().commit()` for commit workflow
5. Update refs via `repository.refs.set()` instead of lower-level calls

**Target Dependencies:**
- `@webrun-vcs/commands` (Git Porcelaine)
- `@webrun-vcs/storage-git` (or `@webrun-vcs/core` Repository)

**Migration Difficulty:** Low - mostly rename/restructure

### 2.2 example-git-perf

**Current State:** Uses VCS and storage-git for performance benchmarks.

**Current Dependencies:**
- `@webrun-vcs/vcs`
- `@webrun-vcs/storage-git`
- `@webrun-vcs/utils`

**Migration Tasks:**
1. Use `createRepository()` factory instead of direct GitStorage
2. Replace object loading with typed store methods
3. Use `repository.commits.walkAncestry()` for history traversal
4. Replace checkout logic with WorkTree API from `@webrun-vcs/worktree`
5. Fix Unicode path issue as part of migration

**Target Dependencies:**
- `@webrun-vcs/core` (Repository)
- `@webrun-vcs/storage-git`
- `@webrun-vcs/worktree`

**Migration Difficulty:** Medium - needs checkout logic rewrite

### 2.3 example-git-push

**Current State:** Already uses Transport API correctly.

**Current Dependencies:**
- `@webrun-vcs/vcs`
- `@webrun-vcs/storage-git`
- `@webrun-vcs/transport`
- `@webrun-vcs/utils`

**Migration Tasks:**
1. Replace VCS imports with Repository from core
2. Use Porcelaine `Git.wrap().push()` instead of direct transport calls (optional)
3. Ensure typed stores for blob/tree/commit creation

**Target Dependencies:**
- `@webrun-vcs/commands` (optional, for higher-level abstraction)
- `@webrun-vcs/transport`
- `@webrun-vcs/storage-git`

**Migration Difficulty:** Low - already well-structured

### 2.4 example-pack-gc

**Current State:** Uses VCS for repository creation and pack operations.

**Current Dependencies:**
- `@webrun-vcs/vcs`
- `@webrun-vcs/storage-git`
- `@webrun-vcs/utils`

**Migration Tasks:**
1. Use `createRepository()` factory
2. Replace direct object stores with typed stores
3. Document that pack/gc operations are storage-implementation specific
4. Consider if pack operations should be exposed via Repository interface

**Target Dependencies:**
- `@webrun-vcs/core` (Repository)
- `@webrun-vcs/storage-git` (for pack-specific operations)

**Migration Difficulty:** Low - straightforward mapping

### 2.5 examples-git

**Current State:** Low-level pack file manipulation examples.

**Current Dependencies:**
- `@webrun-vcs/storage-git`
- `@webrun-vcs/utils`

**Special Consideration:** This app demonstrates pack file internals, which is inherently low-level. May need to be kept as-is for educational purposes.

**Options:**
1. **Keep as-is** - Document as "internal/advanced" examples
2. **Add high-level alternatives** - Show same operations via Repository API
3. **Split** - Separate internal examples from high-level examples

**Recommendation:** Keep existing examples but add a new high-level example file showing how to achieve common pack operations via Repository API.

**Migration Difficulty:** N/A or Low (additive only)

### 2.6 example-vcs-http-roundtrip

**Current State:** Uses Transport API for HTTP operations.

**Current Dependencies:**
- `@webrun-vcs/vcs`
- `@webrun-vcs/storage-git`
- `@webrun-vcs/transport`
- `@webrun-vcs/utils`

**Migration Tasks:**
1. Replace VCS imports with Repository from core
2. Use `createGitHttpServer()` from transport (already doing this)
3. Use `clone()`, `fetch()`, `push()` operations (already doing this)
4. Fix FileHandle leak issue
5. Ensure typed stores for object creation

**Target Dependencies:**
- `@webrun-vcs/core` (Repository)
- `@webrun-vcs/transport`
- `@webrun-vcs/storage-git`

**Migration Difficulty:** Low - mostly import cleanup + bugfix

### 2.7 perf-bench

**Current State:** Uses only utils package for benchmarking.

**Current Dependencies:**
- `@webrun-vcs/utils`

**Migration Tasks:** None needed - this is a standalone benchmarking tool.

**Migration Difficulty:** N/A - already minimal

## Phase 3: Documentation and Consistency

### 3.1 Update App READMEs

Each app should have a README explaining:
1. What the example demonstrates
2. Which high-level APIs are used
3. Prerequisites and how to run
4. Key patterns shown

### 3.2 Add TypeScript Types

Ensure all apps:
1. Use proper TypeScript types from `@webrun-vcs/core`
2. Avoid `any` types
3. Use Repository and store interfaces

### 3.3 Consistent Code Style

Apply across all apps:
1. Consistent import ordering
2. Async/await patterns
3. Error handling patterns
4. Resource cleanup patterns (FileHandle issue)

## Phase 4: Testing

### 4.1 Add Automated Tests

Create test scripts that can run all apps automatically:
```bash
pnpm --filter "@webrun-vcs/example-*" test
```

### 4.2 CI Integration

Ensure GitHub Actions runs all example apps as part of CI.

## Implementation Order

1. **Phase 1.2** - Fix FileHandle leak (quick win)
2. **Phase 1.1** - Fix Unicode path handling (required for verification)
3. **Phase 2.1** - Migrate example-git-cycle (foundational example)
4. **Phase 2.3** - Migrate example-git-push (already close)
5. **Phase 2.6** - Migrate example-vcs-http-roundtrip (includes bugfix)
6. **Phase 2.4** - Migrate example-pack-gc
7. **Phase 2.2** - Migrate example-git-perf (includes bugfix)
8. **Phase 2.5** - Enhance examples-git (additive)
9. **Phase 3** - Documentation
10. **Phase 4** - Testing

## Beads Issues to Create

### Bug Fixes
1. Fix Unicode path handling in checkout/extraction
2. Fix FileHandle leak in storage-git

### App Migrations
3. Migrate example-git-cycle to high-level APIs
4. Migrate example-git-push to high-level APIs
5. Migrate example-vcs-http-roundtrip to high-level APIs
6. Migrate example-pack-gc to high-level APIs
7. Migrate example-git-perf to high-level APIs
8. Add high-level examples to examples-git

### Documentation & Testing
9. Add README to each example app
10. Add automated test scripts for examples
11. Add CI job for example apps

## Success Criteria

Each migrated app should:
1. Use only imports from: `@webrun-vcs/commands`, `@webrun-vcs/transport`, `@webrun-vcs/core`, `@webrun-vcs/storage-*`
2. NOT use direct imports from `@webrun-vcs/vcs` internals
3. Use typed store interfaces (BlobStore, TreeStore, etc.) not raw ObjectStore
4. Handle resources properly (no FileHandle leaks)
5. Include a README with usage instructions
6. Pass automated testing
