# Example Applications Analysis and Restructuring Plan

**Date:** 2026-01-11
**Purpose:** Analyze all example applications, document issues, and propose a progressive learning structure.

## Current Example Applications Inventory

### 1. example-git-cycle
**Package:** `@statewalker/vcs-example-git-cycle`
**Purpose:** Demonstrates the complete Git workflow using high-level Repository API.
**Status:** Working

**What it covers:**
- Repository initialization (`createGitRepository()`)
- Blob storage (file content)
- Tree creation (directory structure)
- Commit creation
- File updates (add/modify/remove)
- History traversal
- Version restoration
- Branches and tags

**Strengths:**
- Well-documented with step-by-step README
- Each step can run independently
- Uses in-memory storage (simple, no filesystem setup)
- Good code comments referencing API locations

**Issues:**
- Some API reference links in README may be outdated after reorganization
- Uses `GitRepository` type cast which could be cleaner

---

### 2. example-git-lifecycle
**Package:** `@statewalker/vcs-example-git-lifecycle`
**Purpose:** Full Git lifecycle on real filesystem with native git verification.
**Status:** Partially Working

**What it covers:**
- Repository creation on real filesystem
- Multiple commits with progressive changes
- Loose object storage verification
- Garbage collection (repacking)
- Pack file verification
- Native git compatibility verification
- Checkout functionality

**Issues:**
- **Fixed:** Import path for `createNodeCompression` was incorrect
- **Fixed:** Import path for `createNodeFilesApi` was incorrect
- **Pre-existing:** Native git verification step may fail depending on git version
- Missing README.md file
- Overlaps significantly with `example-pack-gc`

---

### 3. example-git-perf
**Package:** `@statewalker/vcs-example-git-perf`
**Purpose:** Performance benchmarking against real git repository (git/git).
**Status:** Requires External Setup

**What it covers:**
- Cloning real repositories
- Running garbage collection
- Loading pack files
- Commit history traversal
- Object access performance measurement
- Checkout verification

**Strengths:**
- Comprehensive performance metrics
- Real-world repository testing

**Issues:**
- **Fixed:** Import paths for compression utilities
- Requires internet connection and ~500MB disk space
- Takes several minutes to complete
- Not suitable as a learning example

---

### 4. example-git-push
**Package:** `@statewalker/vcs-example-git-push`
**Purpose:** Demonstrates branch/commit/push workflow with native git HTTP server.
**Status:** Requires External Setup

**What it covers:**
- Opening existing repositories
- Branch creation
- Commit creation workflow
- Push to remote using VCS transport
- Integration with native git HTTP server

**Strengths:**
- Good documentation of high-level APIs
- Shows transport layer usage

**Issues:**
- **Fixed:** Import path for `createNodeCompression`
- Requires native git HTTP server setup
- Complex setup makes it hard to use as introduction

---

### 5. example-vcs-http-roundtrip
**Package:** `@statewalker/vcs-example-vcs-http-roundtrip`
**Purpose:** Complete Git HTTP workflow using VCS exclusively (no native git for operations).
**Status:** Requires External Setup

**What it covers:**
- Custom HTTP server implementing Git smart protocol
- VCS-based repository serving
- Clone and push using VCS transport
- Sideband protocol handling
- Pack file generation and parsing

**Strengths:**
- Demonstrates full protocol implementation
- Shows VCS can replace native git entirely
- Good architecture documentation

**Issues:**
- **Fixed:** Import path for `createNodeCompression`
- Complex setup with HTTP server
- Not suitable for beginners

---

### 6. example-pack-gc
**Package:** `@statewalker/vcs-example-pack-gc`
**Purpose:** Pack file creation and garbage collection with native git verification.
**Status:** Working

**What it covers:**
- Repository creation on real filesystem
- Multiple commits
- Loose object verification
- Repacking (garbage collection)
- Automatic loose object cleanup
- Native git verification

**Strengths:**
- Well-documented
- Good step-by-step output
- Shows internal storage mechanics

**Issues:**
- **Fixed:** Import paths for compression and files utilities
- Overlaps with `example-git-lifecycle`

---

### 7. examples-git (Pack File Examples)
**Package:** `@statewalker/vcs-examples-git`
**Purpose:** Low-level pack file reading and writing examples.
**Status:** Has Pre-existing API Issues

**What it covers:**
1. Simple roundtrip (read all objects, write back)
2. Delta preservation analysis
3. Streaming OFS_DELTA building
4. Full verification with byte comparison
5. Index format comparison (V1 vs V2)
6. High-level API usage

**Strengths:**
- Covers pack file internals comprehensively
- Multiple focused examples
- Good for understanding delta compression

**Issues:**
- **Fixed:** Import paths for compression and files utilities
- **Pre-existing:** Examples 1-5 use `files.readFile()` which doesn't exist on FilesApi
  - Affected: 01-simple-roundtrip, 02-delta-preservation, 03-streaming-ofs-delta,
    04-full-verification, 05-index-format-comparison
  - Should use `readFile(files, path)` utility function
- Requires test data generation (shell script)
- Very technical, not suitable for beginners

---

### 8. example-readme-scripts
**Package:** `@statewalker/vcs-example-readme-scripts`
**Purpose:** Runnable versions of code examples from README documentation.
**Status:** Working

**What it covers:**
- Basic repository operations
- Commands API usage
- Delta compression

**Strengths:**
- Simple, focused examples
- Matches documentation
- Good for verifying README examples work

**Issues:**
- No README documentation
- Not clear what each script demonstrates without reading code

---

### 9. perf-bench
**Package:** `perf-bench`
**Purpose:** Performance benchmarking for delta compression algorithms.
**Status:** Working (Utility)

**What it covers:**
- Binary delta performance
- Delta ranges benchmarking

**Issues:**
- Not really an example app, more of a development tool
- Should be moved to `tools/` or renamed

---

## Issues Summary

### Critical Issues
1. **API Mismatch in examples-git (Examples 1-5):** Uses `files.readFile()` which doesn't exist on FilesApi
   - Should use `readFile(files, path)` utility from `@statewalker/vcs-utils/files`
   - Affects 5 example files, ~9 call sites total
2. **Missing READMEs:** `example-git-lifecycle`, `example-readme-scripts` lack documentation

### Import Path Issues (All Fixed)
- `@statewalker/vcs-utils/compression-node` → `@statewalker/vcs-utils-node/compression`
- `createNodeFilesApi` from `@statewalker/vcs-core` → `@statewalker/vcs-utils-node/files`

### Structural Issues
1. **Overlap:** `example-git-lifecycle` and `example-pack-gc` cover similar content
2. **Naming confusion:** `examples-git` vs `example-git-*` inconsistency
3. **Progressive learning path missing:** No clear order from simple to complex
4. **Mixed concerns:** Some apps mix learning and benchmarking

---

## Proposed Restructuring Plan

### Goals
1. Create a progressive learning path from basic to advanced
2. Each example should focus on ONE aspect
3. Clear naming convention
4. Remove duplicates
5. Separate utilities/benchmarks from examples

### Proposed Structure

```
apps/
├── examples/                    # Learning examples (progressive order)
│   ├── 01-getting-started/      # Introduction to VCS
│   ├── 02-object-storage/       # Blobs, trees, commits
│   ├── 03-branches-and-tags/    # References and branching
│   ├── 04-history-traversal/    # Log, ancestry, diff
│   ├── 05-staging-and-checkout/ # Working directory operations
│   ├── 06-pack-files/           # Pack format and delta compression
│   ├── 07-garbage-collection/   # Repacking and pruning
│   └── 08-transport/            # Clone, fetch, push
├── demos/                       # Complete workflow demonstrations
│   ├── git-cycle/               # Full Git workflow demo (current example-git-cycle)
│   └── http-roundtrip/          # Full HTTP protocol demo (current example-vcs-http-roundtrip)
├── benchmarks/                  # Performance testing (moved from apps/)
│   ├── perf-bench/              # Delta compression benchmarks
│   └── git-perf/                # Real repository benchmarks
└── tools/                       # Development utilities
```

### Migration Plan

#### Phase 1: Fix Pre-existing Issues
1. Fix `files.readFile()` API issue in examples-git
2. Add missing README files

#### Phase 2: Reorganize Directory Structure
1. Create new `examples/`, `demos/`, `benchmarks/` directories
2. Move and rename applications:
   - `example-git-cycle` → `demos/git-cycle/`
   - `example-vcs-http-roundtrip` → `demos/http-roundtrip/`
   - `example-git-perf` → `benchmarks/git-perf/`
   - `perf-bench` → `benchmarks/perf-bench/`

#### Phase 3: Create Progressive Examples
Extract focused examples from existing code:

**01-getting-started/**
- Initialize repository (from example-git-cycle step 1)
- Store and read a file
- Create a simple commit

**02-object-storage/**
- Blob storage and content addressing
- Tree creation and structure
- Object deduplication demonstration

**03-branches-and-tags/**
- Create and switch branches
- Lightweight vs annotated tags
- HEAD and ref resolution

**04-history-traversal/**
- Walk commit ancestry
- Compare commits (diff)
- Find common ancestors

**05-staging-and-checkout/**
- Index/staging area
- Checkout files and commits
- Status and modified detection

**06-pack-files/**
- Pack file format (from examples-git)
- Delta compression concepts
- Index file formats

**07-garbage-collection/**
- Loose vs packed objects (from example-pack-gc)
- Repacking workflow
- Pruning unreachable objects

**08-transport/**
- HTTP smart protocol
- Clone operation
- Push operation

#### Phase 4: Update Documentation
1. Create main examples index page
2. Add README to each example with:
   - What it teaches
   - Prerequisites (which examples to complete first)
   - Key APIs demonstrated
   - How to run

#### Phase 5: Deprecate Redundant Apps
1. Remove `example-git-lifecycle` (merged into other examples)
2. Consolidate `example-readme-scripts` into specific examples
3. Remove `example-git-push` (covered by transport example)

---

## Immediate Actions (Quick Wins)

### 1. Fix examples-git API Issue
Multiple files in examples-git use `files.readFile()` which is NOT a method on `FilesApi`.

**Affected files:**
- `01-simple-roundtrip/01-simple-roundtrip.ts` (lines 43, 109)
- `02-delta-preservation/02-delta-preservation.ts` (lines 91, 238)
- `03-streaming-ofs-delta/03-streaming-ofs-delta.ts` (lines 232, 355)
- `04-full-verification/04-full-verification.ts` (lines 127, 150)
- `05-index-format-comparison/05-index-format-comparison.ts` (line 63)

**Fix required in shared/utils.ts:**
Add a `readFile` helper function using the utility from `@statewalker/vcs-utils/files`:

```typescript
// Add to apps/examples-git/src/shared/utils.ts

import { readFile as readFileUtil } from "@statewalker/vcs-utils/files";
import type { FilesApi } from "@statewalker/vcs-utils";

// Helper for reading entire file (wrapper for compatibility)
export async function readFile(files: FilesApi, path: string): Promise<Uint8Array> {
  return readFileUtil(files, resolvePath(path));
}
```

Then update all example files to use the utility:
```typescript
// Wrong:
const idxData = await files.readFile(idxPath);

// Correct:
const idxData = await readFile(files, idxPath);
```

### 2. Add Missing READMEs
- `example-git-lifecycle/README.md`
- `example-readme-scripts/README.md`

### 3. Rename for Consistency
Consider renaming `examples-git` to `example-pack-files` to match naming convention.

---

## Dependencies Between Examples

```
01-getting-started
       ↓
02-object-storage
       ↓
03-branches-and-tags
       ↓
04-history-traversal
       ↓
05-staging-and-checkout
       ↓
06-pack-files
       ↓
07-garbage-collection
       ↓
08-transport
```

Each example should state its prerequisites clearly.

---

## Timeline Estimation

This restructuring can be done incrementally:
1. **Quick fixes:** Fix API issues and add missing docs (small effort)
2. **Reorganization:** Move files to new structure (medium effort)
3. **New examples:** Create focused examples (larger effort, can be done progressively)

The quick fixes should be done first to ensure all existing examples work correctly.
