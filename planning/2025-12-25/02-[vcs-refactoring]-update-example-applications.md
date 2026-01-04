# Update Example Applications Plan

## Overview

After the core package consolidation, the example applications must be updated to use only the approved set of dependencies. This plan details how to update all 7 example applications in the `apps/` directory.

**Target architecture - Allowed dependencies ONLY:**
- `@statewalker/vcs-utils` - hash, compression, diff utilities
- `@statewalker/vcs-core` - VCS types, interfaces, stores
- `@statewalker/vcs-transport` - HTTP operations (clone, fetch, push)
- `@statewalker/vcs-commands` - high-level Git command API

**Dependencies to REMOVE:**
- `@webrun-vcs/vcs` → replace with `@statewalker/vcs-core`
- `@webrun-vcs/storage-git` → replace with `@statewalker/vcs-commands` (Git class) or `@statewalker/vcs-core`

## Current State Analysis

### Example Applications - Current Dependencies

| App | Current Dependencies | Dependencies to Remove |
|-----|---------------------|----------------------|
| example-git-cycle | core, **vcs**, **storage-git**, utils | vcs, storage-git |
| example-git-perf | **vcs**, **storage-git**, utils | vcs, storage-git |
| example-git-push | **vcs**, **storage-git**, transport, utils | vcs, storage-git |
| example-pack-gc | **vcs**, **storage-git**, utils | vcs, storage-git |
| example-vcs-http-roundtrip | **vcs**, **storage-git**, transport, utils | vcs, storage-git |
| examples-git | **vcs**, **storage-git**, utils | vcs, storage-git |
| perf-bench | utils only | None |

### Current Imports to Replace

**From @webrun-vcs/vcs (replace with @statewalker/vcs-core):**
- `FileMode` → `@statewalker/vcs-core`
- `ObjectId` → `@statewalker/vcs-core`
- `PersonIdent` → `@statewalker/vcs-core`
- `ObjectType` → `@statewalker/vcs-core`
- `Commit` → `@statewalker/vcs-core`
- `TreeEntry` → `@statewalker/vcs-core`

**From @webrun-vcs/storage-git (replace with @statewalker/vcs-commands or @statewalker/vcs-core):**
- `createGitRepository` → Use `Git.open()` or `Git.wrap()` from `@statewalker/vcs-commands`
- `GitRepository` → Use `Git` class from `@statewalker/vcs-commands`
- `createGitStorage` → Use `Git` class from `@statewalker/vcs-commands`
- `PackObjectType` → Move to `@statewalker/vcs-core` or access via commands
- Pack utilities → Access via `@statewalker/vcs-core` if needed

---

## Phase 1: Ensure Core and Commands Export Required Types

### Task 1.1: Verify Core Exports All Required Types

Ensure `@statewalker/vcs-core` exports all types that examples need:
- `FileMode`, `ObjectId`, `ObjectType`, `ObjectTypeCode`
- `PersonIdent`, `Commit`, `TreeEntry`
- `Repository`, `CommitStore`, `TreeStore`, `BlobStore`, `TagStore`, `RefStore`

**Verification:**
```typescript
import { FileMode, ObjectId, PersonIdent, ObjectType } from "@statewalker/vcs-core";
```

### Task 1.2: Verify Commands Provides Git High-Level API

Ensure `@statewalker/vcs-commands` provides the `Git` class with factory methods:
- `Git.open(path)` - open existing repository
- `Git.wrap(repository)` - wrap a Repository instance
- `Git.init(path)` - initialize new repository

Examples should use `Git` class instead of directly creating repositories with `storage-git`.

**Verification:**
```typescript
import { Git } from "@statewalker/vcs-commands";
const git = await Git.open("/path/to/repo");
```

### Task 1.3: Determine Pack Utilities Location

Decide where pack file utilities should be accessed from:
- **Option A:** Re-export from `@statewalker/vcs-core`
- **Option B:** Re-export from `@statewalker/vcs-commands`
- **Option C:** Keep in internal packages, refactor examples to not need low-level pack access

**Decision needed:** Which option to implement.

---

## Phase 2: Update Example Applications

### Task 2.1: Update example-git-cycle

**Current dependencies:** core, vcs, storage-git, utils
**Target dependencies:** core, commands, utils

**Files to update:**
- `apps/example-git-cycle/src/shared/index.ts`
- `apps/example-git-cycle/package.json`

**Import changes:**
```typescript
// Before
import { createGitRepository, type GitRepository } from "@webrun-vcs/storage-git";
import { FileMode, type ObjectId, type PersonIdent } from "@webrun-vcs/vcs";

// After
import { Git } from "@statewalker/vcs-commands";
import { FileMode, type ObjectId, type PersonIdent } from "@statewalker/vcs-core";
```

**package.json changes:**
```json
{
  "dependencies": {
    "@statewalker/vcs-core": "workspace:*",
    "@statewalker/vcs-commands": "workspace:*",
    "@statewalker/vcs-utils": "workspace:*"
    // REMOVE: "@webrun-vcs/vcs"
    // REMOVE: "@webrun-vcs/storage-git"
  }
}
```

**Code refactoring required:**
- Replace `createGitRepository()` calls with `Git.open()` or `Git.init()`
- Update repository access patterns to use Git command API

**Verification:**
```bash
cd apps/example-git-cycle && pnpm start
```

### Task 2.2: Update example-git-perf

**Current dependencies:** vcs, storage-git, utils
**Target dependencies:** core, commands, utils

**Files to update:**
- `apps/example-git-perf/src/shared/helpers.ts`
- `apps/example-git-perf/src/shared/storage.ts`
- `apps/example-git-perf/src/steps/*.ts`
- `apps/example-git-perf/package.json`

**Import changes:**
```typescript
// Before
import type { ObjectId } from "@webrun-vcs/vcs";
import { FileMode } from "@webrun-vcs/vcs";
import { createGitRepository, type GitRepository } from "@webrun-vcs/storage-git";

// After
import type { ObjectId } from "@statewalker/vcs-core";
import { FileMode } from "@statewalker/vcs-core";
import { Git } from "@statewalker/vcs-commands";
```

**Verification:**
```bash
cd apps/example-git-perf && pnpm step:traverse
```

### Task 2.3: Update example-git-push

**Current dependencies:** vcs, storage-git, transport, utils
**Target dependencies:** core, commands, transport, utils

**Files to update:**
- `apps/example-git-push/src/main.ts`
- `apps/example-git-push/package.json`

**Import changes:**
```typescript
// Before
import { createGitRepository, createGitStorage } from "@webrun-vcs/storage-git";
import { FileMode } from "@webrun-vcs/vcs";

// After
import { Git } from "@statewalker/vcs-commands";
import { FileMode } from "@statewalker/vcs-core";
```

**Verification:**
```bash
cd apps/example-git-push && pnpm start
```

### Task 2.4: Update example-pack-gc

**Current dependencies:** vcs, storage-git, utils
**Target dependencies:** core, commands, utils

**Files to update:**
- `apps/example-pack-gc/src/main.ts`
- `apps/example-pack-gc/package.json`

**Import changes:**
```typescript
// Before
import { createGitRepository, createGitStorage, type GitRepository } from "@webrun-vcs/storage-git";
import { FileMode, type ObjectId, type PersonIdent } from "@webrun-vcs/vcs";

// After
import { Git } from "@statewalker/vcs-commands";
import { FileMode, type ObjectId, type PersonIdent } from "@statewalker/vcs-core";
```

**Note:** This example demonstrates garbage collection. May need to expose GC functionality through commands API.

**Verification:**
```bash
cd apps/example-pack-gc && pnpm start
```

### Task 2.5: Update example-vcs-http-roundtrip

**Current dependencies:** vcs, storage-git, transport, utils
**Target dependencies:** core, commands, transport, utils

**Files to update:**
- `apps/example-vcs-http-roundtrip/src/main.ts`
- `apps/example-vcs-http-roundtrip/src/shared/vcs-http-server.ts`
- `apps/example-vcs-http-roundtrip/package.json`

**Import changes:**
```typescript
// Before
import { createGitRepository, createGitStorage } from "@webrun-vcs/storage-git";
import { FileMode } from "@webrun-vcs/vcs";

// After
import { Git } from "@statewalker/vcs-commands";
import { FileMode } from "@statewalker/vcs-core";
```

**Note:** The HTTP server implementation may need significant refactoring if it uses low-level storage-git APIs.

**Verification:**
```bash
cd apps/example-vcs-http-roundtrip && pnpm start
```

### Task 2.6: Update examples-git

**Current dependencies:** vcs, storage-git, utils
**Target dependencies:** core, commands, utils

**Files to update:**
- `apps/examples-git/src/shared/utils.ts`
- `apps/examples-git/src/01-simple-roundtrip/01-simple-roundtrip.ts`
- `apps/examples-git/src/02-delta-preservation/02-delta-preservation.ts`
- `apps/examples-git/src/03-streaming-ofs-delta/03-streaming-ofs-delta.ts`
- `apps/examples-git/src/04-full-verification/04-full-verification.ts`
- `apps/examples-git/src/05-index-format-comparison/05-index-format-comparison.ts`
- `apps/examples-git/src/06-high-level-api/06-high-level-api.ts`
- `apps/examples-git/package.json`

**Critical Note:** This package demonstrates low-level pack file operations. May need to:
1. Keep as internal/advanced examples with storage-git as devDependency
2. Or expose pack utilities through core/commands
3. Or significantly refactor to use high-level API only

**Import changes for high-level examples:**
```typescript
// Before
import { FileMode, type PersonIdent } from "@webrun-vcs/vcs";
import { createGitRepository } from "@webrun-vcs/storage-git";

// After
import { FileMode, type PersonIdent } from "@statewalker/vcs-core";
import { Git } from "@statewalker/vcs-commands";
```

**Verification:**
```bash
cd apps/examples-git && pnpm examples
```

### Task 2.7: Verify perf-bench (No Changes Expected)

**Current dependencies:** utils only
**Target dependencies:** utils only

The `perf-bench` app only uses `@statewalker/vcs-utils`, which is in the allowed list.

**Verification:**
```bash
cd apps/perf-bench && pnpm start
```

---

## Phase 3: Update Documentation

### Task 3.1: Update Example README Files

Update README files to reflect new import patterns AND add comprehensive documentation:
- `apps/example-git-cycle/README.md`
- `apps/example-git-push/README.md`
- `apps/examples-git/README.md`

**Import pattern changes:**
- Update import examples to use `@statewalker/vcs-core` for types
- Update import examples to use `@statewalker/vcs-commands` for Git operations
- Remove references to `@webrun-vcs/vcs` and `@webrun-vcs/storage-git`

**REQUIRED: Each README must document:**

1. **Purpose and Description**
   - What does this example demonstrate?
   - What real-world use case does it cover?
   - Target audience (beginner/advanced)

2. **Dependencies Used**
   - List all @webrun-vcs packages with their purpose:
     - @statewalker/vcs-core - types and interfaces
     - @statewalker/vcs-commands - Git high-level API
     - @statewalker/vcs-transport - HTTP operations
     - @statewalker/vcs-utils - utilities (hash, compression, diff)

3. **How It Works**
   - Step-by-step explanation of the example flow
   - Key functions/classes being demonstrated
   - Expected output

4. **Running Instructions**
   - Installation steps (pnpm install)
   - Run command (pnpm start or specific scripts)
   - Any prerequisites (native git, etc.)

**Example README structure:**
```markdown
# Example: [Name]

## Overview
[What this example demonstrates]

## Dependencies
- @statewalker/vcs-core - VCS types (FileMode, ObjectId, PersonIdent)
- @statewalker/vcs-commands - Git class for repository operations
- @statewalker/vcs-utils - Hash utilities

## How It Works
[Step-by-step explanation]

## Running the Example
\`\`\`bash
pnpm install
pnpm start
\`\`\`

## Expected Output
[Description of what to expect]
```

### Task 3.2: Update Markdown Documentation in examples-git

Update markdown documentation with new import patterns AND comprehensive technical descriptions:
- `apps/examples-git/src/03-streaming-ofs-delta/03-streaming-ofs-delta.md`
- `apps/examples-git/src/04-full-verification/04-full-verification.md`
- `apps/examples-git/src/05-index-format-comparison/05-index-format-comparison.md`

**REQUIRED: Each markdown file must include:**

1. **Purpose and Description**
   - What concept/feature does this example demonstrate?
   - Why is this important for understanding Git internals?

2. **Dependencies and Packages Used**
   - List imported packages with their role
   - Specify which types/functions from each package

3. **Technical Explanation**
   - How the feature works internally
   - Key algorithms or data structures

4. **Code Examples**
   - Working code samples with updated imports
   - Comments explaining each step

---

## Phase 4: Final Verification

### Task 4.1: Run All Example Applications

Execute all examples to verify they work with new dependencies:

**Validation criteria for each example:**

1. **example-git-cycle** - Full Git workflow demo
   - Run: `cd apps/example-git-cycle && pnpm start`
   - Verify: Creates repo, commits, branches work correctly
   - Expected: All 8 steps complete without errors

2. **example-git-perf** - Performance benchmarks
   - Run: `cd apps/example-git-perf && pnpm step:traverse`
   - Verify: Can traverse commit history, measure performance
   - Expected: Performance metrics displayed

3. **example-git-push** - Clone/push operations
   - Run: `cd apps/example-git-push && pnpm start`
   - Verify: HTTP server starts, clone and push work
   - Expected: Changes pushed and verified with native git

4. **example-pack-gc** - Garbage collection demo
   - Run: `cd apps/example-pack-gc && pnpm start`
   - Verify: GC packs objects, native git fsck passes
   - Expected: Pack files created, loose objects cleaned

5. **example-vcs-http-roundtrip** - HTTP protocol demo
   - Run: `cd apps/example-vcs-http-roundtrip && pnpm start`
   - Verify: Full HTTP roundtrip without native git
   - Expected: Clone/push via HTTP protocol works

6. **examples-git** - Pack file examples
   - Run: `cd apps/examples-git && pnpm examples`
   - Verify: All 6 sub-examples complete
   - Expected: No errors, pack operations work

7. **perf-bench** - Benchmarks
   - Run: `cd apps/perf-bench && pnpm start`
   - Verify: Benchmarks run and display results
   - Expected: No errors (uses only utils)

**Success criteria:**
- All examples run without errors
- No import errors from removed packages
- Each example produces expected output
- No runtime errors related to missing types or functions

### Task 4.2: Verify No Forbidden Dependencies

Check that no example has dependencies outside the allowed list:
```bash
for app in apps/*/package.json; do
  echo "=== $app ==="
  grep -E "@webrun-vcs/(vcs|storage-git)" "$app" && echo "FORBIDDEN DEPENDENCY FOUND!" || echo "OK"
done
```

### Task 4.3: Full Build Verification

```bash
pnpm build
pnpm test
pnpm lint
```

---

## Dependency Order

This plan depends on:
1. **Phase 1 of core consolidation** - Core exports all required types
2. **Commands package providing Git high-level API** - For repository operations

---

## Summary

| Phase | Tasks | Description |
|-------|-------|-------------|
| Phase 1 | 3 | Verify core and commands provide required APIs |
| Phase 2 | 7 | Update each example application |
| Phase 3 | 2 | Update documentation |
| Phase 4 | 3 | Final verification |

**Total tasks:** 15
**Estimated files to modify:** ~30-40 files

## Key Migration Patterns

### Type imports
```typescript
// OLD
import { FileMode, ObjectId, PersonIdent } from "@webrun-vcs/vcs";

// NEW
import { FileMode, ObjectId, PersonIdent } from "@statewalker/vcs-core";
```

### Repository creation
```typescript
// OLD
import { createGitRepository } from "@webrun-vcs/storage-git";
const repo = await createGitRepository(filesApi, "/path");

// NEW
import { Git } from "@statewalker/vcs-commands";
const git = await Git.open("/path");
// or
const git = await Git.init("/path");
```

### Package.json dependencies
```json
// OLD
{
  "@webrun-vcs/vcs": "workspace:*",
  "@webrun-vcs/storage-git": "workspace:*"
}

// NEW
{
  "@statewalker/vcs-core": "workspace:*",
  "@statewalker/vcs-commands": "workspace:*"
}
```
