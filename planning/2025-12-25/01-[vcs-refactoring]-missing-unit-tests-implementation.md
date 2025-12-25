# Missing Unit Tests Implementation Plan

This plan outlines the implementation of missing unit tests for `packages/core`, including test migrations from other packages and tests ported from JGit's test suite.

## Executive Summary

The `packages/core` module lacks comprehensive unit test coverage for critical subsystems. This plan addresses:

- **8 test modules** requiring new tests
- **~3,700 lines** of existing tests to migrate from other packages
- **~50+ test scenarios** to port from JGit

## Current State

### Existing Tests in packages/core/tests/

| Directory | Files | Coverage |
|-----------|-------|----------|
| format/ | 5 files | Commit, tree, tag, object-header, person-ident serialization |
| staging/ | 1 file | Conflict utilities |
| git-codec/ | 1 file | High-level store integration |
| binary/ | 1 file | MemoryVolatileStore |
| ignore/ | 3 files | Ignore rules, status calculator, add command |

### Missing Test Coverage

| Module | Priority | Complexity | Source |
|--------|----------|------------|--------|
| Pack file handling | HIGH | High | Migrate + JGit |
| Delta operations | HIGH | High | New + JGit |
| Reference store | HIGH | Medium | Migrate |
| Packing orchestrator | HIGH | High | New |
| GC controller | MEDIUM | Medium | New + JGit |
| Domain stores | MEDIUM | Low | New |
| Binary storage | LOW | Low | Migrate |
| Utility functions | LOW | Low | New |

---

## Phase 1: Pack File Tests (HIGH PRIORITY)

### 1.1 Migrate from packages/storage-git/tests/pack/

Migrate these 5 test files (~2,237 lines total):

**pack-writer.test.ts** (650 lines)
- Pack file header writing (version 2, object count)
- Object serialization (COMMIT, TREE, BLOB, TAG)
- REF_DELTA and OFS_DELTA writing
- Streaming writer with multiple objects
- Pack checksum computation

**pack-reader.test.ts** (477 lines)
- Pack header parsing
- Object loading by offset
- Delta chain resolution
- Large object handling
- Corrupt pack detection

**pack-index.test.ts** (454 lines)
- V1 and V2 index format parsing
- Binary search for object offsets
- CRC32 lookup (V2 only)
- Prefix resolution for abbreviated IDs
- Index iteration

**pack-indexer.test.ts** (366 lines)
- Index creation from raw pack data
- SHA-1 computation during indexing
- Thin pack handling with missing bases
- Delta resolution during indexing

**pack-index-writer.test.ts** (290 lines)
- V2 index file generation
- Entry sorting and fanout table
- CRC32 and offset encoding
- Pack checksum inclusion

### 1.2 New Tests from JGit Patterns

Based on JGit's PackTest.java, PackWriterTest.java, and PackIndexTest.java:

**pack-format-edge-cases.test.ts**
```typescript
describe("Pack format edge cases", () => {
  it("should handle objects exceeding 2GB")
  it("should handle configurable streaming thresholds")
  it("should validate pack version number")
  it("should detect truncated pack files")
  it("should handle empty pack files")
})
```

**pack-delta-resolution.test.ts**
```typescript
describe("Pack delta resolution", () => {
  it("should resolve OFS_DELTA chains up to max depth")
  it("should resolve REF_DELTA with base in same pack")
  it("should fail gracefully on missing delta base")
  it("should handle circular delta references")
  it("should apply copy and insert delta commands")
})
```

### 1.3 Implementation Steps

1. Create `packages/core/tests/pack/` directory
2. Copy test files from storage-git, updating imports:
   - Change `../../src/pack/index.js` to `../../src/pack/index.js`
   - Ensure `@webrun-vcs/utils` imports work
3. Run tests to verify they pass
4. Add new edge case tests based on JGit patterns
5. Add performance regression tests for large packs

---

## Phase 2: Delta Module Tests (HIGH PRIORITY)

### 2.1 New Tests for Core Delta Classes

**raw-store-with-delta.test.ts**
```typescript
describe("RawStoreWithDelta", () => {
  describe("transparent delta resolution", () => {
    it("should load full object when no delta exists")
    it("should resolve single-level delta chain")
    it("should resolve multi-level delta chain up to max depth")
    it("should fail when chain exceeds max depth")
    it("should cache resolved objects")
  })

  describe("deltify operation", () => {
    it("should create delta when savings exceed threshold")
    it("should skip deltification for small objects")
    it("should respect minimum size threshold")
    it("should select best candidate from multiple options")
  })

  describe("undeltify operation", () => {
    it("should convert delta back to full object")
    it("should update delta store after undeltify")
    it("should preserve object content exactly")
  })
})
```

**storage-analyzer.test.ts**
```typescript
describe("StorageAnalyzer", () => {
  describe("analyzeAll", () => {
    it("should scan all objects in storage")
    it("should report object counts by type")
    it("should calculate total storage size")
    it("should identify delta vs full objects")
  })

  describe("analyzeFromRoots", () => {
    it("should walk commit ancestry from roots")
    it("should include all reachable trees and blobs")
    it("should stop at already-visited objects")
  })

  describe("findOrphanedObjects", () => {
    it("should identify unreachable objects")
    it("should not mark reachable objects as orphans")
    it("should handle circular references")
  })
})
```

**packing-orchestrator.test.ts**
```typescript
describe("PackingOrchestrator", () => {
  describe("sliding window algorithm", () => {
    it("should find delta candidates within window")
    it("should respect window size limits")
    it("should prioritize similar-size objects")
  })

  describe("packAll", () => {
    it("should pack all objects in storage")
    it("should report progress during packing")
    it("should respect AbortSignal for cancellation")
  })

  describe("packFromRoots", () => {
    it("should pack only reachable objects")
    it("should include commit, tree, and blob objects")
  })

  describe("packIncremental", () => {
    it("should pack only new objects")
    it("should find deltas against existing objects")
  })
})
```

**gc-controller.test.ts**
```typescript
describe("GCController", () => {
  describe("threshold triggering", () => {
    it("should trigger GC when commit count exceeds threshold")
    it("should not trigger GC below threshold")
    it("should respect cooldown period")
  })

  describe("quickPack", () => {
    it("should deltify recent commits quickly")
    it("should limit chain depth")
  })

  describe("runGC", () => {
    it("should analyze storage before packing")
    it("should break long delta chains")
    it("should report GC statistics")
  })
})
```

### 2.2 Migrate from packages/storage-git/tests/delta/

**resolve-delta-chain.test.ts** (300 lines)
- Delta chain resolution with mock stores
- Chain depth tracking
- Base object lookup

### 2.3 JGit Test Patterns to Port

From DeltaIndexTest.java (13 test methods):
- Insert whole objects (minimal to large sizes)
- Copy whole objects with variations
- Shuffle segments (non-linear data layout)
- Insert head/middle/tail operations
- Size limit enforcement

From BinaryDeltaTest.java:
- Delta application correctness
- Base and result size extraction
- Copy command validation
- Insert command validation

---

## Phase 3: Reference Store Tests (HIGH PRIORITY)

### 3.1 Migrate from packages/storage-git/tests/refs/

**git-ref-storage.test.ts** (680 lines)
- Ref type creation (regular, symbolic, peeled)
- Ref storage operations
- Packed refs parsing

**refs.test.ts** (485 lines)
- HEAD state handling
- Ref directory validation
- Reference resolution chains

### 3.2 New Tests from JGit Patterns

From RefDirectoryTest.java (40+ test methods):

**ref-directory.test.ts**
```typescript
describe("RefDirectory", () => {
  describe("ref reading", () => {
    it("should list empty database")
    it("should read HEAD reference")
    it("should handle detached HEAD")
    it("should resolve deeply nested branches")
    it("should handle unborn HEAD")
  })

  describe("loose vs packed refs", () => {
    it("should prefer loose ref over packed")
    it("should discover new loose refs")
    it("should detect modified loose refs")
    it("should handle deleted loose refs")
  })

  describe("packed-refs format", () => {
    it("should parse packed-refs file")
    it("should handle peeled refs annotation")
    it("should write packed-refs atomically")
  })
})
```

From RefUpdateTest.java (40+ test methods):

**ref-update.test.ts**
```typescript
describe("RefUpdate", () => {
  describe("deletion", () => {
    it("should delete loose reference")
    it("should delete packed reference")
    it("should cleanup empty directories")
    it("should handle force deletion")
  })

  describe("updates", () => {
    it("should fast-forward update")
    it("should handle no-op updates")
    it("should invalidate cache after update")
    it("should fail on lock conflict")
  })

  describe("compare-and-swap", () => {
    it("should succeed when expected value matches")
    it("should fail when expected value differs")
    it("should handle concurrent updates")
  })
})
```

---

## Phase 4: Domain Store Tests (MEDIUM PRIORITY)

### 4.1 BlobStore Tests

**blob-store.test.ts**
```typescript
describe("BlobStore", () => {
  it("should store and retrieve binary content")
  it("should compute correct SHA-1 for blob")
  it("should stream large blobs efficiently")
  it("should handle empty blob")
  it("should detect content corruption")
})
```

### 4.2 TreeStore Tests

**tree-store.test.ts**
```typescript
describe("TreeStore", () => {
  describe("storeTree", () => {
    it("should sort entries canonically")
    it("should handle mixed file and directory entries")
    it("should compute correct SHA-1 for tree")
  })

  describe("loadTree", () => {
    it("should parse tree format correctly")
    it("should handle all file modes")
    it("should iterate entries in order")
  })

  describe("getEntry", () => {
    it("should find entry by name")
    it("should return undefined for missing entry")
  })

  describe("edge cases", () => {
    it("should handle empty tree")
    it("should handle large directories (1000+ entries)")
    it("should handle special characters in names")
  })
})
```

### 4.3 CommitStore Tests

**commit-store.test.ts**
```typescript
describe("CommitStore", () => {
  describe("storeCommit", () => {
    it("should serialize commit with single parent")
    it("should serialize merge commit with multiple parents")
    it("should compute correct SHA-1")
  })

  describe("loadCommit", () => {
    it("should parse commit format correctly")
    it("should extract all parent IDs")
    it("should parse author and committer")
  })

  describe("walkAncestry", () => {
    it("should traverse linear history")
    it("should handle merge commits")
    it("should stop at specified depth")
    it("should respect abort signal")
  })

  describe("findMergeBase", () => {
    it("should find LCA of two commits")
    it("should handle multiple common ancestors")
    it("should handle disjoint histories")
  })

  describe("isAncestor", () => {
    it("should return true for direct ancestor")
    it("should return false for non-ancestor")
    it("should handle self-reference")
  })
})
```

### 4.4 TagStore Tests

**tag-store.test.ts**
```typescript
describe("TagStore", () => {
  describe("storeTag", () => {
    it("should serialize annotated tag")
    it("should include optional tagger field")
    it("should handle tag message")
  })

  describe("loadTag", () => {
    it("should parse tag format correctly")
    it("should extract target object ID")
  })

  describe("getTarget", () => {
    it("should return direct target")
    it("should peel through tag chains")
    it("should handle tag pointing to commit")
  })
})
```

---

## Phase 5: Binary Storage Tests (LOW PRIORITY)

### 5.1 New RawStore Tests

**raw-store.test.ts**
```typescript
describe("RawStore interface", () => {
  describe("store", () => {
    it("should store byte stream by key")
    it("should handle large streams")
    it("should overwrite existing content")
  })

  describe("load", () => {
    it("should retrieve stored content")
    it("should support offset option")
    it("should support length option")
    it("should throw for non-existent key")
  })

  describe("has", () => {
    it("should return true for existing key")
    it("should return false for missing key")
  })

  describe("delete", () => {
    it("should remove stored content")
    it("should handle non-existent key")
  })

  describe("size", () => {
    it("should return uncompressed size")
  })
})
```

### 5.2 Migrate from packages/store-mem/tests/

Evaluate binary-storage.test.ts (513 lines) for interface-level tests that could move to core.

---

## Phase 6: Utility Function Tests (LOW PRIORITY)

### 6.1 Varint Tests

**varint.test.ts**
```typescript
describe("Varint encoding", () => {
  it("should encode small integers (< 128)")
  it("should encode medium integers (128-16383)")
  it("should encode large integers (> 16383)")
  it("should decode encoded values correctly")
  it("should handle maximum safe integer")
})
```

---

## Test Infrastructure

### Mock Implementations

Create shared mock implementations in `packages/core/tests/mocks/`:

**mock-raw-store.ts**
```typescript
export class MockRawStore implements RawStore {
  private data = new Map<string, Uint8Array>()
  // Implementation for testing
}
```

**mock-delta-store.ts**
```typescript
export class MockDeltaStore implements DeltaStore {
  private deltas = new Map<string, DeltaInfo>()
  // Implementation for testing
}
```

**mock-commit-store.ts**
```typescript
export class MockCommitStore implements CommitStore {
  private commits = new Map<string, Commit>()
  // Implementation for testing with predefined commit graphs
}
```

### Test Utilities

**test-data-generators.ts**
```typescript
export function randomBytes(size: number): Uint8Array
export function randomCommitGraph(depth: number, width: number): CommitGraph
export function randomTreeEntries(count: number): TreeEntry[]
```

**assertion-helpers.ts**
```typescript
export function assertDeltaApplies(base: Uint8Array, delta: Delta, expected: Uint8Array)
export function assertPackRoundTrip(objects: GitObject[])
export function assertRefResolution(store: RefStore, name: string, expected: ObjectId)
```

---

## JGit Test Patterns Reference

### Key Test Infrastructure from JGit

**Test Base Classes:**
- `LocalDiskRepositoryTestCase` - Real filesystem tests
- `RepositoryTestCase` - In-memory/temporary tests
- `RevWalkTestCase` - RevWalk-specific base

**Test Fixtures:**
- `TestRepository<T>` - Fluent API for repo manipulation
- `BranchBuilder` - Commit graph building
- `TestRng` - Reproducible random data

**Assertion Patterns:**
- Delta validation via `BinaryDelta.format()` comparison
- Object reconstruction via `BinaryDelta.apply()`
- Statistics validation: before/after metrics
- Reference state: `Ref.Storage` checks

### Priority Test Scenarios from JGit

| JGit Test | Core Module | Scenarios |
|-----------|-------------|-----------|
| DeltaIndexTest | delta/ | 13 methods - insert/copy operations |
| PackTest | pack/ | 6 methods - read whole objects, deltas |
| BasePackWriterTest | pack/ | 30+ methods - pack generation |
| GcBasicPackingTest | delta/ | 4 methods - pack consolidation |
| ObjectDirectoryTest | binary/ | 8 methods - concurrent access |
| RefDirectoryTest | refs/ | 40+ methods - ref operations |
| RefUpdateTest | refs/ | 40+ methods - updates, deletions |
| RevWalkFilterTest | commits/ | 17 methods - commit traversal |

---

## Implementation Timeline

### Phase 1: Pack Tests (Week 1)
- Day 1-2: Migrate pack test files from storage-git
- Day 3: Update imports, verify tests pass
- Day 4-5: Add edge case tests from JGit patterns

### Phase 2: Delta Tests (Week 2)
- Day 1-2: Create RawStoreWithDelta tests
- Day 3: Create StorageAnalyzer tests
- Day 4: Create PackingOrchestrator tests
- Day 5: Create GCController tests

### Phase 3: Reference Tests (Week 3)
- Day 1-2: Migrate ref tests from storage-git
- Day 3-4: Add RefDirectory tests from JGit
- Day 5: Add RefUpdate tests from JGit

### Phase 4: Domain Store Tests (Week 4)
- Day 1: BlobStore tests
- Day 2: TreeStore tests
- Day 3-4: CommitStore tests
- Day 5: TagStore tests

### Phase 5-6: Lower Priority (Week 5)
- Day 1-2: Binary storage tests
- Day 3: Utility function tests
- Day 4-5: Test infrastructure and documentation

---

## Success Criteria

1. **Test coverage**: Achieve 80%+ line coverage for core modules
2. **All tests pass**: Zero failing tests in CI
3. **JGit parity**: Key scenarios from JGit test suite covered
4. **Performance**: No test takes longer than 5 seconds
5. **Documentation**: Each test file has clear descriptions

---

## File Structure After Implementation

```
packages/core/tests/
├── pack/
│   ├── pack-writer.test.ts
│   ├── pack-reader.test.ts
│   ├── pack-index.test.ts
│   ├── pack-indexer.test.ts
│   ├── pack-index-writer.test.ts
│   ├── pack-format-edge-cases.test.ts
│   └── pack-delta-resolution.test.ts
├── delta/
│   ├── raw-store-with-delta.test.ts
│   ├── storage-analyzer.test.ts
│   ├── packing-orchestrator.test.ts
│   ├── gc-controller.test.ts
│   └── resolve-delta-chain.test.ts
├── refs/
│   ├── git-ref-storage.test.ts
│   ├── refs.test.ts
│   ├── ref-directory.test.ts
│   └── ref-update.test.ts
├── stores/
│   ├── blob-store.test.ts
│   ├── tree-store.test.ts
│   ├── commit-store.test.ts
│   └── tag-store.test.ts
├── binary/
│   ├── memory-volatile-store.test.ts (existing)
│   └── raw-store.test.ts
├── utils/
│   └── varint.test.ts
├── mocks/
│   ├── mock-raw-store.ts
│   ├── mock-delta-store.ts
│   └── mock-commit-store.ts
└── helpers/
    ├── test-data-generators.ts
    └── assertion-helpers.ts
```

---

## References

- [Notes: Missing Unit Tests Analysis](../notes/src/2025-12-25/02-[vcs-refactoring]-missing-unit-tests.md)
- JGit test suite: `tmp/jgit/org.eclipse.jgit.test/`
- Existing storage-git tests: `packages/storage-git/tests/`
- Existing utils tests: `packages/utils/tests/diff/delta/`
