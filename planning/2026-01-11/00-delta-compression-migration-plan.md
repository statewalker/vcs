# Delta Compression Migration Plan

Detailed plan to migrate from legacy `DeltaCandidateStrategy` interface to the new delta compression architecture (`CandidateFinder`, `DeltaDecisionStrategy`, `DeltaEngine`) and remove all legacy code.

## Current State: Backward Compatibility Bridges

### 1. CandidateFinderAdapter (New → Old)

**Location**: `packages/core/src/delta/candidate-finder/adapter.ts`

**Purpose**: Wraps new `CandidateFinder` interface to work with legacy `DeltaCandidateStrategy` consumers (primarily `GCController`).

```typescript
// Usage: Allow new CandidateFinder with old GCController
const finder: CandidateFinder = new PathBasedCandidateFinder(storage);
const adapted = new CandidateFinderAdapter(finder);

const gc = new GCController(storage, {
  deltaCandidateStrategy: adapted  // Old interface
});
```

### 2. LegacyStrategyAdapter (Old → New)

**Location**: `packages/core/src/delta/candidate-finder/adapter.ts`

**Purpose**: Wraps legacy `DeltaCandidateStrategy` implementations to work with new `CandidateFinder` consumers (primarily `DeltaEngine`).

```typescript
// Usage: Allow old SimilarSizeCandidateStrategy with new DeltaEngine
const legacy = new SimilarSizeCandidateStrategy();
const adapted = new LegacyStrategyAdapter(legacy, storage);

const engine = new DefaultDeltaEngine(compressor, adapted, strategy, loader);
```

### 3. chainDepthThreshold in GCScheduleOptions

**Location**: `packages/core/src/delta/gc-controller.ts`

**Purpose**: Legacy option for chain depth configuration.

```typescript
interface GCScheduleOptions {
  chainDepthThreshold?: number;  // To be removed
}
```

---

## Migration Plan

### Phase 1: Create Replacement Implementations

**Goal**: Provide new `CandidateFinder` implementations before removing legacy code.

#### 1.1 Create SizeSimilarityCandidateFinder

**New file**: `packages/core/src/delta/candidate-finder/size-similarity-finder.ts`

Replaces `SimilarSizeCandidateStrategy` with full `CandidateFinder` interface:

```typescript
export class SizeSimilarityCandidateFinder implements CandidateFinder {
  constructor(
    private storage: RepositoryAccess,
    private options: { tolerance?: number; maxCandidates?: number }
  ) {}

  async *findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    const minSize = target.size * (1 - this.options.tolerance);
    const maxSize = target.size * (1 + this.options.tolerance);

    for await (const info of this.storage.enumerate()) {
      if (info.size >= minSize && info.size <= maxSize) {
        const similarity = 1 - Math.abs(info.size - target.size) / target.size;
        yield {
          id: info.id,
          type: info.type,
          size: info.size,
          similarity,
          reason: 'similar-size'
        };
      }
    }
  }
}
```

#### 1.2 Verify Existing New Implementations

**Already exist**:
- `packages/core/src/delta/candidate-finder/path-based-finder.ts` - PathBasedCandidateFinder
- `packages/core/src/delta/candidate-finder/commit-tree-finder.ts` - CommitTreeCandidateFinder
- `packages/core/src/delta/candidate-finder/composite-finder.ts` - CompositeCandidateFinder

---

### Phase 2: Update Consumers to New Interfaces

**Goal**: All code uses new interfaces directly.

#### 2.1 Update GCController to use DeltaEngine

**Files to modify**:
- `packages/core/src/delta/gc-controller.ts`

**Changes**:
1. Replace `deltaCandidateStrategy: DeltaCandidateStrategy` with `deltaEngine: DeltaEngine`
2. Replace manual candidate iteration + deltify with `deltaEngine.findBestDelta()`
3. Remove sliding window logic (moved into DefaultDeltaEngine)
4. Remove `chainDepthThreshold` option (use strategy's maxChainDepth)

**Before**:
```typescript
interface GCScheduleOptions {
  deltaCandidateStrategy?: DeltaCandidateStrategy;
  chainDepthThreshold?: number;
}

// In quickPack:
for await (const candidateId of getCandidates.findCandidates(commitId, storage)) {
  candidateIds.push(candidateId);
}
await this.storage.deltify(commitId, candidateIds);
```

**After**:
```typescript
interface GCScheduleOptions {
  deltaEngine?: DeltaEngine;
}

// In quickPack:
const target: DeltaTarget = { id: commitId, type: ObjectType.COMMIT, size };
const result = await this.deltaEngine.findBestDelta(target);
if (result) {
  await this.storage.storeDelta(commitId, result.baseId, result.delta);
}
```

#### 2.2 Update RawStoreWithDelta

**Files to modify**:
- `packages/core/src/delta/raw-store-with-delta.ts`

**Changes**:
1. Remove `deltify(targetId, candidateIds)` method entirely
2. Add `storeDeltaResult(targetId, result: BestDeltaResult)` method
3. Remove internal delta computation (DeltaEngine handles this)

**Before**:
```typescript
async deltify(targetId: ObjectId, candidateIds: ObjectId[]): Promise<boolean>
```

**After**:
```typescript
async storeDeltaResult(targetId: ObjectId, result: BestDeltaResult): Promise<void> {
  // Direct storage without recomputing delta
}
```

#### 2.3 Update Transport Layer

**Files to check**:
- `packages/core/src/transport/fetch-session.ts`
- `packages/core/src/transport/pack-builder.ts`

**Status**: Already migrated in Epic 5 to use `RepositoryAccess` and `DeltaEngine`.

---

### Phase 3: Remove Legacy Code

**Goal**: Delete all legacy interfaces, implementations, and bridges.

#### 3.1 Remove Adapter Classes

**Files to delete**:
- `packages/core/src/delta/candidate-finder/adapter.ts`

**Also remove from**:
- `packages/core/src/delta/candidate-finder/index.ts` (remove export)

#### 3.2 Remove Legacy Strategies Directory

**Files to delete**:
- `packages/core/src/delta/strategies/similar-size-candidate.ts`
- `packages/core/src/delta/strategies/commit-window-candidate.ts`
- `packages/core/src/delta/strategies/index.ts`

**Also remove from**:
- `packages/core/src/delta/index.ts` - Remove `export * from "./strategies/index.js";`

#### 3.3 Remove DeltaCandidateStrategy Interface

**Files to modify**:
- `packages/core/src/delta/types.ts`

**Remove**:
```typescript
export interface DeltaCandidateStrategy {
  findCandidates(targetId: ObjectId, storage: RawStore): AsyncIterable<ObjectId>;
}
```

#### 3.4 Remove Legacy Options from GCController

**Files to modify**:
- `packages/core/src/delta/gc-controller.ts`

**Remove from GCScheduleOptions**:
```typescript
deltaCandidateStrategy?: DeltaCandidateStrategy;
chainDepthThreshold?: number;
```

**Remove from DEFAULT_GC_OPTIONS**:
```typescript
deltaCandidateStrategy: new SimilarSizeCandidateStrategy(),
chainDepthThreshold: 50,
```

**Remove imports**:
```typescript
import { SimilarSizeCandidateStrategy } from "./strategies/similar-size-candidate.js";
import type { DeltaCandidateStrategy } from "./types.js";
```

#### 3.5 Remove deltify() Method

**Files to modify**:
- `packages/core/src/delta/raw-store-with-delta.ts`

**Remove**:
```typescript
async deltify(targetId: ObjectId, candidateIds: ObjectId[]): Promise<boolean>
```

---

### Phase 4: Test Migration and Verification

**Goal**: Migrate all meaningful tests to new interfaces and add comprehensive tests for new implementations.

#### 4.1 Identify Existing Tests to Migrate

**Tests using legacy interfaces**:

| Test File | Uses | Action |
|-----------|------|--------|
| `packages/core/tests/delta/candidate-finder-adapter.test.ts` | Adapters | Delete (bridges removed) |
| `packages/core/tests/delta/delta.test.ts` | SimilarSizeCandidateStrategy indirectly | Migrate to new interfaces |
| `packages/core/tests/gc/gc-controller.test.ts` | deltaCandidateStrategy, chainDepthThreshold | Migrate to DeltaEngine |

**Search for all references**:
```bash
grep -r "DeltaCandidateStrategy" packages/core/tests/
grep -r "SimilarSizeCandidateStrategy" packages/core/tests/
grep -r "CommitWindowCandidateStrategy" packages/core/tests/
grep -r "deltaCandidateStrategy" packages/core/tests/
grep -r "chainDepthThreshold" packages/core/tests/
grep -r "deltify" packages/core/tests/
```

#### 4.2 Migrate GC Controller Tests

**File**: `packages/core/tests/gc/gc-controller.test.ts`

**Before**:
```typescript
const gc = new GCController(storage, {
  deltaCandidateStrategy: new SimilarSizeCandidateStrategy(),
  chainDepthThreshold: 10,
});
```

**After**:
```typescript
const finder = new SizeSimilarityCandidateFinder(repositoryAccess);
const strategy = new DefaultDeltaDecisionStrategy({ maxChainDepth: 10 });
const engine = new DefaultDeltaEngine(compressor, finder, strategy, loader);

const gc = new GCController(storage, {
  deltaEngine: engine,
});
```

#### 4.3 Add New Strategy-Specific Tests

**New test files to create**:

| Test File | Tests For |
|-----------|-----------|
| `packages/core/tests/delta/size-similarity-finder.test.ts` | SizeSimilarityCandidateFinder |
| `packages/core/tests/delta/path-based-finder.test.ts` | PathBasedCandidateFinder |
| `packages/core/tests/delta/commit-tree-finder.test.ts` | CommitTreeCandidateFinder |
| `packages/core/tests/delta/composite-finder.test.ts` | CompositeCandidateFinder |
| `packages/core/tests/delta/default-delta-engine.test.ts` | DefaultDeltaEngine integration |

#### 4.4 SizeSimilarityCandidateFinder Tests

**File**: `packages/core/tests/delta/size-similarity-finder.test.ts`

```typescript
describe("SizeSimilarityCandidateFinder", () => {
  describe("findCandidates", () => {
    it("finds candidates with similar sizes within tolerance", async () => {
      // Store objects: 100, 105, 110, 200 bytes
      // Target: 100 bytes, tolerance: 0.2
      // Expected: 100, 105, 110 (within 20%)
    });

    it("excludes objects outside tolerance range", async () => {
      // Store objects with sizes far outside tolerance
      // Verify they are not returned as candidates
    });

    it("calculates similarity based on size difference", async () => {
      // Verify similarity scores are correct
      // Exact match = 1.0, larger difference = lower similarity
    });

    it("respects maxCandidates limit", async () => {
      // Store many similar-sized objects
      // Verify only maxCandidates are returned
    });

    it("returns candidates sorted by similarity", async () => {
      // Verify candidates are ordered by similarity (highest first)
    });

    it("sets reason to 'similar-size'", async () => {
      // Verify all candidates have reason: 'similar-size'
    });

    it("handles empty storage", async () => {
      // Verify no candidates returned for empty storage
    });

    it("excludes target object from candidates", async () => {
      // Target should not be returned as its own candidate
    });
  });
});
```

#### 4.5 PathBasedCandidateFinder Tests

**File**: `packages/core/tests/delta/path-based-finder.test.ts`

```typescript
describe("PathBasedCandidateFinder", () => {
  describe("findCandidates", () => {
    it("finds candidates with same file path", async () => {
      // Store multiple versions of same file path
      // Verify they are returned as candidates
    });

    it("prioritizes recent versions over older ones", async () => {
      // Verify ordering by recency when available
    });

    it("sets reason to 'same-path'", async () => {
      // Verify all candidates have reason: 'same-path'
    });

    it("handles targets without path information", async () => {
      // Gracefully handle when target.path is undefined
    });
  });
});
```

#### 4.6 CommitTreeCandidateFinder Tests

**File**: `packages/core/tests/delta/commit-tree-finder.test.ts`

```typescript
describe("CommitTreeCandidateFinder", () => {
  describe("findCandidates", () => {
    it("finds candidates from parent commit trees", async () => {
      // Create commit chain, verify parent tree objects found
    });

    it("finds candidates from same tree", async () => {
      // For tree objects, find siblings in same tree
    });

    it("sets appropriate reason for each candidate type", async () => {
      // 'parent-commit' for commit objects
      // 'same-tree' for tree objects
    });
  });
});
```

#### 4.7 CompositeCandidateFinder Tests

**File**: `packages/core/tests/delta/composite-finder.test.ts`

```typescript
describe("CompositeCandidateFinder", () => {
  describe("findCandidates", () => {
    it("combines candidates from multiple finders", async () => {
      // Add multiple finders, verify all candidates are returned
    });

    it("deduplicates candidates from different finders", async () => {
      // Same candidate from multiple finders should appear once
    });

    it("preserves highest similarity when deduplicating", async () => {
      // When same candidate found by multiple finders, keep best similarity
    });

    it("respects per-finder maxCandidates", async () => {
      // Each finder should respect its own limit
    });

    it("respects global maxCandidates", async () => {
      // Total candidates should respect composite limit
    });
  });
});
```

#### 4.8 DefaultDeltaEngine Integration Tests

**File**: `packages/core/tests/delta/default-delta-engine.test.ts`

```typescript
describe("DefaultDeltaEngine", () => {
  describe("findBestDelta", () => {
    it("finds best delta among candidates", async () => {
      // Verify best (highest ratio) delta is selected
    });

    it("respects decision strategy thresholds", async () => {
      // Verify strategy.shouldUseDelta is consulted
    });

    it("returns null when no good delta found", async () => {
      // When all candidates produce poor deltas
    });

    it("respects max chain depth", async () => {
      // Skip candidates that would exceed max chain depth
    });
  });

  describe("processBatch", () => {
    it("processes multiple targets in batch", async () => {
      // Verify batch processing works
    });

    it("yields results as they complete", async () => {
      // Verify streaming behavior
    });
  });
});
```

#### 4.9 Tests to Delete

| Test File | Reason |
|-----------|--------|
| `packages/core/tests/delta/candidate-finder-adapter.test.ts` | Tests bridge adapters being removed |

---

### Phase 5: Documentation Updates

**Goal**: Update all documentation to reflect new interfaces.

#### 5.1 Update Architecture Documentation

**Files to update**:
- `packages/core/ARCHITECTURE.md`
- `ARCHITECTURE.md` (root)

**Changes**:
- Remove references to `DeltaCandidateStrategy`
- Add documentation for `CandidateFinder`, `DeltaDecisionStrategy`, `DeltaEngine`
- Update diagrams showing delta compression flow

#### 5.2 Update API Documentation

**Files to update**:
- JSDoc comments in all new interface files
- `packages/core/README.md`

**Ensure documented**:
- `CandidateFinder` interface and implementations
- `DeltaDecisionStrategy` interface and implementations
- `DeltaEngine` interface and DefaultDeltaEngine
- `RepositoryAccess` interface and implementations
- Migration examples from old to new interfaces

#### 5.3 Update Inline Code Examples

**Search and update**:
```bash
grep -r "SimilarSizeCandidateStrategy" packages/
grep -r "deltaCandidateStrategy" packages/
grep -r "chainDepthThreshold" packages/
```

**Update all code examples in comments and documentation**.

---

### Phase 6: Example Applications Updates

**Goal**: Update all example applications to use new interfaces.

#### 6.1 Identify Example Applications

**Search for examples**:
```bash
find . -type d -name "examples" -o -name "example"
find . -name "*.example.ts" -o -name "example-*.ts"
```

**Known locations**:
- `examples/` directory (if exists)
- `packages/*/examples/` directories
- README code snippets

#### 6.2 Update Example Code

**For each example using legacy interfaces**:

1. Replace `SimilarSizeCandidateStrategy` with `SizeSimilarityCandidateFinder`
2. Replace `CommitWindowCandidateStrategy` with `CommitTreeCandidateFinder`
3. Replace `deltaCandidateStrategy` option with `deltaEngine`
4. Remove `chainDepthThreshold` option, use `DeltaDecisionStrategy`
5. Replace `deltify()` calls with `DeltaEngine.findBestDelta()` + `storeDeltaResult()`

**Example migration**:

**Before**:
```typescript
import { GCController, SimilarSizeCandidateStrategy } from "@statewalker/vcs-core";

const gc = new GCController(storage, {
  deltaCandidateStrategy: new SimilarSizeCandidateStrategy({ tolerance: 0.3 }),
  chainDepthThreshold: 20,
});
```

**After**:
```typescript
import {
  GCController,
  DefaultDeltaEngine,
  SizeSimilarityCandidateFinder,
  DefaultDeltaDecisionStrategy,
  GitDeltaCompressor,
} from "@statewalker/vcs-core";

const compressor = new GitDeltaCompressor();
const finder = new SizeSimilarityCandidateFinder(repositoryAccess, { tolerance: 0.3 });
const strategy = new DefaultDeltaDecisionStrategy({ maxChainDepth: 20 });
const engine = new DefaultDeltaEngine(compressor, finder, strategy, loader);

const gc = new GCController(storage, {
  deltaEngine: engine,
});
```

#### 6.3 Verify Examples Compile and Run

```bash
# For each example directory
pnpm build
pnpm test # if examples have tests
```

---

## File Summary

### Files to Create

| File | Description |
|------|-------------|
| `packages/core/src/delta/candidate-finder/size-similarity-finder.ts` | New SizeSimilarityCandidateFinder |
| `packages/core/tests/delta/size-similarity-finder.test.ts` | Tests for SizeSimilarityCandidateFinder |
| `packages/core/tests/delta/path-based-finder.test.ts` | Tests for PathBasedCandidateFinder |
| `packages/core/tests/delta/commit-tree-finder.test.ts` | Tests for CommitTreeCandidateFinder |
| `packages/core/tests/delta/composite-finder.test.ts` | Tests for CompositeCandidateFinder |
| `packages/core/tests/delta/default-delta-engine.test.ts` | Integration tests for DefaultDeltaEngine |

### Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/delta/gc-controller.ts` | Replace DeltaCandidateStrategy with DeltaEngine, remove chainDepthThreshold |
| `packages/core/src/delta/raw-store-with-delta.ts` | Remove deltify(), add storeDeltaResult() |
| `packages/core/src/delta/types.ts` | Remove DeltaCandidateStrategy interface |
| `packages/core/src/delta/index.ts` | Remove `export * from "./strategies/index.js"` |
| `packages/core/src/delta/candidate-finder/index.ts` | Remove adapter exports |
| `packages/core/tests/gc/gc-controller.test.ts` | Migrate to use DeltaEngine |
| `packages/core/tests/delta/delta.test.ts` | Update to use new interfaces |
| `packages/core/ARCHITECTURE.md` | Update delta compression documentation |
| `ARCHITECTURE.md` | Update delta compression documentation |

### Files to Delete

| File | Reason |
|------|--------|
| `packages/core/src/delta/candidate-finder/adapter.ts` | Bridge adapters no longer needed |
| `packages/core/src/delta/strategies/similar-size-candidate.ts` | Replaced by SizeSimilarityCandidateFinder |
| `packages/core/src/delta/strategies/commit-window-candidate.ts` | Replaced by CommitTreeCandidateFinder |
| `packages/core/src/delta/strategies/index.ts` | Directory being removed |
| `packages/core/tests/delta/candidate-finder-adapter.test.ts` | Tests for removed adapters |

---

## Execution Order

1. **Create** `SizeSimilarityCandidateFinder` implementation
2. **Create** tests for all new CandidateFinder implementations
3. **Update** `GCController` to use `DeltaEngine`
4. **Update** `RawStoreWithDelta` - remove `deltify()`, add `storeDeltaResult()`
5. **Migrate** existing tests to use new interfaces
6. **Run** tests, fix any failures
7. **Delete** adapter.ts and its tests
8. **Delete** strategies/ directory
9. **Update** types.ts - remove `DeltaCandidateStrategy`
10. **Update** exports in index.ts files
11. **Update** documentation (ARCHITECTURE.md, README.md, JSDoc)
12. **Update** example applications
13. **Final verification** - run all tests and linting

---

## Verification Checklist

After migration:

**Code Quality**:
- [ ] All tests pass (`pnpm test`)
- [ ] No type errors (`pnpm typecheck`)
- [ ] No lint errors (`pnpm lint`)

**Legacy Removal**:
- [ ] No references to `DeltaCandidateStrategy` in codebase
- [ ] No imports from `./strategies/` directory
- [ ] No references to `deltaCandidateStrategy` option
- [ ] No references to `chainDepthThreshold` option
- [ ] No references to `deltify()` method

**New Tests**:
- [ ] SizeSimilarityCandidateFinder tests pass
- [ ] PathBasedCandidateFinder tests pass
- [ ] CommitTreeCandidateFinder tests pass
- [ ] CompositeCandidateFinder tests pass
- [ ] DefaultDeltaEngine integration tests pass
- [ ] GCController tests migrated and pass

**Documentation**:
- [ ] ARCHITECTURE.md updated
- [ ] All JSDoc comments accurate
- [ ] No code examples reference legacy interfaces

**Examples**:
- [ ] All example applications compile
- [ ] All example applications run correctly

---

## Breaking Changes

This migration introduces breaking changes:

1. **GCScheduleOptions** - `deltaCandidateStrategy` and `chainDepthThreshold` removed
2. **RawStoreWithDelta** - `deltify()` method removed
3. **DeltaCandidateStrategy** interface removed from public API
4. **SimilarSizeCandidateStrategy** class removed
5. **CommitWindowCandidateStrategy** class removed

**Recommendation**: Bump to next major version after this migration.
