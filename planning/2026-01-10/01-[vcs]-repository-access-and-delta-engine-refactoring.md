# Implementation Plan: RepositoryAccess & Delta Engine Refactoring

**Date**: 2026-01-10
**Project**: StateWalker VCS
**Status**: Approved Plan
**Priority**: High

---

## Executive Summary

This plan combines two architectural improvements:

1. **Hide GitObjectStore**: Replace public `GitObjectStore` with `RepositoryAccess` interface
2. **Reusable Delta Engine**: Extract delta compression into pluggable, storage-agnostic components

These changes enable:
- Alternative storage backends (SQL, KV, Memory) without Git format coupling
- Reusable delta compression across storage types and transport
- Clean separation between high-level stores and wire format

---

## Architecture Target

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            APPLICATION                                   │
│                    (Git commands, user code)                            │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      HIGH-LEVEL STORES (Public API)                      │
│        CommitStore │ TreeStore │ BlobStore │ TagStore │ RefStore        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────────┐
│  RepositoryAccess   │ │    DeltaEngine      │ │      GCController       │
│  (transport/wire)   │ │  (compression)      │ │    (maintenance)        │
└─────────────────────┘ └─────────────────────┘ └─────────────────────────┘
              │                     │                     │
              └─────────────────────┼─────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        STORAGE BACKENDS                                  │
│    Git-Native (files)  │  SQL Database  │  Key-Value  │  Memory         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Core Interfaces

**Goal**: Define the foundational interfaces without breaking existing code.

### Task 1.1: Create RepositoryAccess Interface

**File**: `packages/core/src/repository-access/repository-access.ts` (NEW)

```typescript
import type { ObjectId } from "../id/index.js";
import type { ObjectTypeCode } from "../objects/object-types.js";

/**
 * Git wire format object representation.
 */
export interface GitWireObject {
  id: ObjectId;
  type: ObjectTypeCode;
  size: number;
  content: Uint8Array | AsyncIterable<Uint8Array>;
}

/**
 * Object metadata without content.
 */
export interface ObjectInfo {
  id: ObjectId;
  type: ObjectTypeCode;
  size: number;
}

/**
 * Reference information.
 */
export interface RefInfo {
  name: string;
  target: ObjectId;
  symbolic?: boolean;
  symbolicTarget?: string;
}

/**
 * HEAD reference information.
 */
export interface HeadInfo {
  target: ObjectId | null;
  branch?: string;
  detached: boolean;
}

/**
 * Low-level repository access for transport and maintenance.
 *
 * Provides Git-wire-format compatible access regardless of storage backend.
 */
export interface RepositoryAccess {
  // Object enumeration
  listObjects(): AsyncIterable<ObjectId>;
  hasObject(id: ObjectId): Promise<boolean>;
  getObjectInfo(id: ObjectId): Promise<ObjectInfo | null>;

  // Object loading (Git wire format)
  loadObject(id: ObjectId): Promise<GitWireObject | null>;
  loadRawObject(id: ObjectId): AsyncIterable<Uint8Array>;

  // Object storage
  storeObject(type: ObjectTypeCode, content: Uint8Array | AsyncIterable<Uint8Array>): Promise<ObjectId>;

  // Bulk operations
  walkObjects(wants: ObjectId[], haves: ObjectId[]): AsyncIterable<GitWireObject>;

  // Reference operations
  listRefs(): AsyncIterable<RefInfo>;
  getHead(): Promise<HeadInfo | null>;
  updateRef(name: string, oldId: ObjectId | null, newId: ObjectId | null): Promise<boolean>;
}
```

**Exports**: `packages/core/src/repository-access/index.ts`

```typescript
export type {
  RepositoryAccess,
  GitWireObject,
  ObjectInfo,
  RefInfo,
  HeadInfo,
} from "./repository-access.js";
```

---

### Task 1.2: Create DeltaCompressor Interface

**File**: `packages/core/src/delta/compressor/delta-compressor.ts` (NEW)

```typescript
/**
 * Delta compression algorithm.
 * Pure computation - no storage awareness.
 */
export interface DeltaCompressor {
  /**
   * Compute delta from base to target.
   * Returns null if delta would be larger than target.
   */
  computeDelta(base: Uint8Array, target: Uint8Array): DeltaResult | null;

  /**
   * Apply delta to base to reconstruct target.
   */
  applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array;

  /**
   * Quick estimate if delta is worth computing.
   */
  estimateDeltaQuality(baseSize: number, targetSize: number): DeltaEstimate;
}

export interface DeltaResult {
  delta: Uint8Array;
  ratio: number;
  savings: number;
  baseSize: number;
  targetSize: number;
}

export interface DeltaEstimate {
  worthTrying: boolean;
  expectedRatio: number;
  reason?: string;
}
```

---

### Task 1.3: Create CandidateFinder Interface

**File**: `packages/core/src/delta/candidate-finder/candidate-finder.ts` (NEW)

```typescript
import type { ObjectId } from "../../id/index.js";
import type { ObjectTypeCode } from "../../objects/object-types.js";

/**
 * Target object for delta compression.
 */
export interface DeltaTarget {
  id: ObjectId;
  type: ObjectTypeCode;
  size: number;
  path?: string;
  content?: Uint8Array;
}

/**
 * Candidate base object for delta.
 */
export interface DeltaCandidate {
  id: ObjectId;
  type: ObjectTypeCode;
  size: number;
  similarity: number;
  reason: CandidateReason;
}

export type CandidateReason =
  | "same-path"
  | "similar-size"
  | "same-tree"
  | "parent-commit"
  | "rolling-hash"
  | "recent";

/**
 * Finds candidate base objects for delta compression.
 */
export interface CandidateFinder {
  findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate>;
}
```

---

### Task 1.4: Create DeltaDecisionStrategy Interface

**File**: `packages/core/src/delta/strategy/delta-decision-strategy.ts` (NEW)

```typescript
import type { DeltaTarget, DeltaCandidate } from "../candidate-finder/candidate-finder.js";
import type { DeltaResult } from "../compressor/delta-compressor.js";

/**
 * Decides when to use delta compression.
 */
export interface DeltaDecisionStrategy {
  shouldAttemptDelta(target: DeltaTarget): boolean;
  shouldUseDelta(result: DeltaResult, candidate: DeltaCandidate): boolean;
  readonly maxChainDepth: number;
}

/**
 * Configuration for default strategy.
 */
export interface DeltaDecisionOptions {
  minObjectSize?: number;
  maxObjectSize?: number;
  minCompressionRatio?: number;
  minBytesSaved?: number;
  maxChainDepth?: number;
  allowedTypes?: ObjectTypeCode[];
}
```

---

### Task 1.5: Create DeltaEngine Interface

**File**: `packages/core/src/delta/engine/delta-engine.ts` (NEW)

```typescript
import type { ObjectId } from "../../id/index.js";
import type { DeltaTarget } from "../candidate-finder/candidate-finder.js";

/**
 * Best delta found for an object.
 */
export interface BestDeltaResult {
  baseId: ObjectId;
  delta: Uint8Array;
  ratio: number;
  savings: number;
  chainDepth: number;
}

/**
 * Result of processing a target object.
 */
export interface DeltaProcessResult {
  targetId: ObjectId;
  result: BestDeltaResult | null;
}

/**
 * Delta compression engine.
 * Orchestrates candidate finding, compression, and decision making.
 */
export interface DeltaEngine {
  findBestDelta(target: DeltaTarget): Promise<BestDeltaResult | null>;
  processBatch(targets: AsyncIterable<DeltaTarget>): AsyncIterable<DeltaProcessResult>;
}
```

---

### Task 1.6: Create DeltaStorage Interface

**File**: `packages/core/src/delta/storage/delta-storage.ts` (NEW)

```typescript
import type { ObjectId } from "../../id/index.js";
import type { BestDeltaResult } from "../engine/delta-engine.js";

/**
 * Stored delta information.
 */
export interface StoredDelta {
  baseId: ObjectId;
  delta: Uint8Array;
  targetSize: number;
  chainDepth: number;
}

/**
 * Storage for delta-compressed objects.
 */
export interface DeltaStorage {
  storeDelta(targetId: ObjectId, delta: BestDeltaResult): Promise<void>;
  loadDelta(targetId: ObjectId): Promise<StoredDelta | null>;
  isDelta(targetId: ObjectId): Promise<boolean>;
  getChainDepth(targetId: ObjectId): Promise<number>;
  resolve(targetId: ObjectId): Promise<Uint8Array>;
  undelta(targetId: ObjectId): Promise<void>;
}
```

---

### Task 1.7: Export All Interfaces

**File**: `packages/core/src/delta/index.ts` (NEW)

```typescript
// Compressor
export type { DeltaCompressor, DeltaResult, DeltaEstimate } from "./compressor/delta-compressor.js";

// Candidate finder
export type {
  CandidateFinder,
  DeltaTarget,
  DeltaCandidate,
  CandidateReason,
} from "./candidate-finder/candidate-finder.js";

// Strategy
export type { DeltaDecisionStrategy, DeltaDecisionOptions } from "./strategy/delta-decision-strategy.js";

// Engine
export type { DeltaEngine, BestDeltaResult, DeltaProcessResult } from "./engine/delta-engine.js";

// Storage
export type { DeltaStorage, StoredDelta } from "./storage/delta-storage.js";
```

**File**: `packages/core/src/index.ts` (UPDATE)

```typescript
// Add exports
export * from "./repository-access/index.js";
export * from "./delta/index.js";
```

---

## Phase 2: Delta Engine Implementations

**Goal**: Implement the delta compression components.

### Task 2.1: Implement GitDeltaCompressor

**File**: `packages/core/src/delta/compressor/git-delta-compressor.ts` (NEW)

```typescript
import type { DeltaCompressor, DeltaResult, DeltaEstimate } from "./delta-compressor.js";
import { createDelta, applyDelta as applyGitDelta } from "@statewalker/vcs-utils/diff/delta";

/**
 * Git-compatible delta compressor using the Git delta format.
 */
export class GitDeltaCompressor implements DeltaCompressor {
  computeDelta(base: Uint8Array, target: Uint8Array): DeltaResult | null {
    const delta = createDelta(base, target);
    const deltaBytes = encodeDeltaToGitFormat(delta, base.length, target.length);

    // Only use delta if it's smaller than target
    if (deltaBytes.length >= target.length) {
      return null;
    }

    return {
      delta: deltaBytes,
      ratio: target.length / deltaBytes.length,
      savings: target.length - deltaBytes.length,
      baseSize: base.length,
      targetSize: target.length,
    };
  }

  applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
    const instructions = decodeDeltaFromGitFormat(delta);
    return applyGitDelta(base, instructions);
  }

  estimateDeltaQuality(baseSize: number, targetSize: number): DeltaEstimate {
    const ratio = Math.max(baseSize, targetSize) / Math.min(baseSize, targetSize);

    // If sizes differ by more than 10x, unlikely to get good delta
    if (ratio > 10) {
      return { worthTrying: false, expectedRatio: 1, reason: "size-difference-too-large" };
    }

    // Estimate based on size similarity
    const expectedRatio = 1 + (1 - (ratio - 1) / 10) * 2;
    return { worthTrying: true, expectedRatio };
  }
}
```

---

### Task 2.2: Implement PathBasedCandidateFinder

**File**: `packages/core/src/delta/candidate-finder/path-based-finder.ts` (NEW)

```typescript
import type { CandidateFinder, DeltaTarget, DeltaCandidate } from "./candidate-finder.js";
import type { ObjectId } from "../../id/index.js";

/**
 * Index for tracking object history by path.
 */
export interface PathHistoryIndex {
  getPreviousVersions(path: string, limit?: number): AsyncIterable<ObjectInfo>;
  recordVersion(path: string, id: ObjectId, commitId: ObjectId): Promise<void>;
}

/**
 * Index for finding objects by size range.
 */
export interface SizeIndex {
  findInRange(range: { min: number; max: number }, limit?: number): AsyncIterable<ObjectInfo>;
}

interface ObjectInfo {
  id: ObjectId;
  type: ObjectTypeCode;
  size: number;
}

/**
 * Finds candidates based on file path history.
 */
export class PathBasedCandidateFinder implements CandidateFinder {
  constructor(
    private pathIndex: PathHistoryIndex,
    private sizeIndex: SizeIndex,
    private options: PathBasedFinderOptions = {},
  ) {}

  async *findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    const maxCandidates = this.options.maxCandidates ?? 10;
    let yielded = 0;

    // Priority 1: Same path, previous versions
    if (target.path) {
      for await (const prev of this.pathIndex.getPreviousVersions(target.path, 5)) {
        if (prev.id === target.id) continue;
        yield {
          id: prev.id,
          type: prev.type,
          size: prev.size,
          similarity: 0.9,
          reason: "same-path",
        };
        if (++yielded >= maxCandidates) return;
      }
    }

    // Priority 2: Similar size
    const sizeRange = {
      min: Math.floor(target.size * 0.5),
      max: Math.ceil(target.size * 2),
    };
    for await (const similar of this.sizeIndex.findInRange(sizeRange, 10)) {
      if (similar.id === target.id) continue;
      if (similar.type !== target.type) continue;

      const sizeDiff = Math.abs(similar.size - target.size) / target.size;
      yield {
        id: similar.id,
        type: similar.type,
        size: similar.size,
        similarity: 1 - sizeDiff,
        reason: "similar-size",
      };
      if (++yielded >= maxCandidates) return;
    }
  }
}

export interface PathBasedFinderOptions {
  maxCandidates?: number;
}
```

---

### Task 2.3: Implement CommitTreeCandidateFinder

**File**: `packages/core/src/delta/candidate-finder/commit-tree-finder.ts` (NEW)

```typescript
import type { CandidateFinder, DeltaTarget, DeltaCandidate } from "./candidate-finder.js";
import type { CommitStore } from "../../commits/commit-store.js";
import type { TreeStore } from "../../trees/tree-store.js";
import { ObjectTypeCode } from "../../objects/object-types.js";

/**
 * Finds candidates based on commit/tree relationships.
 * For Git-native storage where all object types are deltified.
 */
export class CommitTreeCandidateFinder implements CandidateFinder {
  constructor(
    private commits: CommitStore,
    private trees: TreeStore,
    private options: CommitTreeFinderOptions = {},
  ) {}

  async *findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    switch (target.type) {
      case ObjectTypeCode.COMMIT:
        yield* this.findCommitCandidates(target);
        break;
      case ObjectTypeCode.TREE:
        yield* this.findTreeCandidates(target);
        break;
      // Blobs and tags handled by other finders
    }
  }

  private async *findCommitCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    try {
      const commit = await this.commits.loadCommit(target.id);

      // Parent commits are excellent candidates
      for (const parentId of commit.parents) {
        try {
          const parent = await this.commits.loadCommit(parentId);
          yield {
            id: parentId,
            type: ObjectTypeCode.COMMIT,
            size: 0, // Size will be determined when loading
            similarity: 0.95,
            reason: "parent-commit",
          };
        } catch {
          // Parent not found, skip
        }
      }
    } catch {
      // Commit not found
    }
  }

  private async *findTreeCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    // Trees from same path in parent commits would be candidates
    // This requires path tracking through the tree hierarchy
    // For now, delegate to size-based finder
  }
}

export interface CommitTreeFinderOptions {
  maxParentDepth?: number;
}
```

---

### Task 2.4: Implement CompositeCandidateFinder

**File**: `packages/core/src/delta/candidate-finder/composite-finder.ts` (NEW)

```typescript
import type { CandidateFinder, DeltaTarget, DeltaCandidate } from "./candidate-finder.js";

/**
 * Combines multiple candidate finders.
 * Deduplicates and orders by similarity.
 */
export class CompositeCandidateFinder implements CandidateFinder {
  constructor(private finders: CandidateFinder[]) {}

  async *findCandidates(target: DeltaTarget): AsyncIterable<DeltaCandidate> {
    const seen = new Set<string>();
    const candidates: DeltaCandidate[] = [];

    // Collect from all finders
    for (const finder of this.finders) {
      for await (const candidate of finder.findCandidates(target)) {
        if (seen.has(candidate.id)) continue;
        seen.add(candidate.id);
        candidates.push(candidate);
      }
    }

    // Sort by similarity (highest first)
    candidates.sort((a, b) => b.similarity - a.similarity);

    // Yield sorted candidates
    for (const candidate of candidates) {
      yield candidate;
    }
  }
}
```

---

### Task 2.5: Implement DefaultDeltaDecisionStrategy

**File**: `packages/core/src/delta/strategy/default-delta-decision-strategy.ts` (NEW)

```typescript
import type { DeltaDecisionStrategy, DeltaDecisionOptions } from "./delta-decision-strategy.js";
import type { DeltaTarget, DeltaCandidate } from "../candidate-finder/candidate-finder.js";
import type { DeltaResult } from "../compressor/delta-compressor.js";
import { ObjectTypeCode } from "../../objects/object-types.js";

/**
 * Default strategy with configurable thresholds.
 */
export class DefaultDeltaDecisionStrategy implements DeltaDecisionStrategy {
  private readonly minObjectSize: number;
  private readonly maxObjectSize: number;
  private readonly minCompressionRatio: number;
  private readonly minBytesSaved: number;
  private readonly _maxChainDepth: number;
  private readonly allowedTypes: Set<ObjectTypeCode> | null;

  constructor(options: DeltaDecisionOptions = {}) {
    this.minObjectSize = options.minObjectSize ?? 64;
    this.maxObjectSize = options.maxObjectSize ?? 512 * 1024 * 1024;
    this.minCompressionRatio = options.minCompressionRatio ?? 1.5;
    this.minBytesSaved = options.minBytesSaved ?? 32;
    this._maxChainDepth = options.maxChainDepth ?? 50;
    this.allowedTypes = options.allowedTypes ? new Set(options.allowedTypes) : null;
  }

  shouldAttemptDelta(target: DeltaTarget): boolean {
    // Size checks
    if (target.size < this.minObjectSize) return false;
    if (target.size > this.maxObjectSize) return false;

    // Type check
    if (this.allowedTypes && !this.allowedTypes.has(target.type)) {
      return false;
    }

    return true;
  }

  shouldUseDelta(result: DeltaResult, candidate: DeltaCandidate): boolean {
    return result.ratio >= this.minCompressionRatio &&
           result.savings >= this.minBytesSaved;
  }

  get maxChainDepth(): number {
    return this._maxChainDepth;
  }
}
```

---

### Task 2.6: Implement DefaultDeltaEngine

**File**: `packages/core/src/delta/engine/default-delta-engine.ts` (NEW)

```typescript
import type { DeltaEngine, BestDeltaResult, DeltaProcessResult } from "./delta-engine.js";
import type { DeltaCompressor } from "../compressor/delta-compressor.js";
import type { CandidateFinder, DeltaTarget } from "../candidate-finder/candidate-finder.js";
import type { DeltaDecisionStrategy } from "../strategy/delta-decision-strategy.js";
import type { ObjectId } from "../../id/index.js";

/**
 * Loads object content and chain depth.
 */
export interface ObjectLoader {
  load(id: ObjectId): Promise<Uint8Array>;
  getChainDepth(id: ObjectId): Promise<number>;
}

/**
 * Default delta engine implementation.
 */
export class DefaultDeltaEngine implements DeltaEngine {
  constructor(
    private compressor: DeltaCompressor,
    private candidateFinder: CandidateFinder,
    private strategy: DeltaDecisionStrategy,
    private objectLoader: ObjectLoader,
  ) {}

  async findBestDelta(target: DeltaTarget): Promise<BestDeltaResult | null> {
    if (!this.strategy.shouldAttemptDelta(target)) {
      return null;
    }

    // Load target content if not provided
    const targetContent = target.content ?? await this.objectLoader.load(target.id);
    let bestResult: BestDeltaResult | null = null;

    for await (const candidate of this.candidateFinder.findCandidates(target)) {
      // Check chain depth
      const chainDepth = await this.objectLoader.getChainDepth(candidate.id);
      if (chainDepth >= this.strategy.maxChainDepth) continue;

      // Quick estimate
      const estimate = this.compressor.estimateDeltaQuality(candidate.size, target.size);
      if (!estimate.worthTrying) continue;

      // Load candidate and compute delta
      try {
        const baseContent = await this.objectLoader.load(candidate.id);
        const deltaResult = this.compressor.computeDelta(baseContent, targetContent);

        if (!deltaResult) continue;
        if (!this.strategy.shouldUseDelta(deltaResult, candidate)) continue;

        // Track best result
        if (!bestResult || deltaResult.ratio > bestResult.ratio) {
          bestResult = {
            baseId: candidate.id,
            delta: deltaResult.delta,
            ratio: deltaResult.ratio,
            savings: deltaResult.savings,
            chainDepth: chainDepth + 1,
          };
        }
      } catch {
        // Failed to load candidate, skip
      }
    }

    return bestResult;
  }

  async *processBatch(targets: AsyncIterable<DeltaTarget>): AsyncIterable<DeltaProcessResult> {
    for await (const target of targets) {
      const result = await this.findBestDelta(target);
      yield { targetId: target.id, result };
    }
  }
}
```

---

### Task 2.7: Export Implementations

**File**: `packages/core/src/delta/index.ts` (UPDATE)

```typescript
// ... existing type exports ...

// Implementations
export { GitDeltaCompressor } from "./compressor/git-delta-compressor.js";
export { PathBasedCandidateFinder } from "./candidate-finder/path-based-finder.js";
export { CommitTreeCandidateFinder } from "./candidate-finder/commit-tree-finder.js";
export { CompositeCandidateFinder } from "./candidate-finder/composite-finder.js";
export { DefaultDeltaDecisionStrategy } from "./strategy/default-delta-decision-strategy.js";
export { DefaultDeltaEngine } from "./engine/default-delta-engine.js";
export type { ObjectLoader } from "./engine/default-delta-engine.js";
export type { PathHistoryIndex, SizeIndex } from "./candidate-finder/path-based-finder.js";
```

---

## Phase 3: RepositoryAccess Implementations

**Goal**: Implement RepositoryAccess for different backends.

### Task 3.1: Implement GitNativeRepositoryAccess

**File**: `packages/core/src/repository-access/git-native-repository-access.ts` (NEW)

```typescript
import type { RepositoryAccess, GitWireObject, ObjectInfo, RefInfo, HeadInfo } from "./repository-access.js";
import type { GitObjectStore } from "../objects/object-store.js";
import type { RefStore } from "../refs/ref-store.js";
import type { CommitStore } from "../commits/commit-store.js";
import type { TreeStore } from "../trees/tree-store.js";
import type { ObjectId } from "../id/index.js";
import { ObjectTypeCode, objectTypeCodeFromString, objectTypeStringFromCode } from "../objects/object-types.js";

/**
 * RepositoryAccess for Git-native storage.
 * Direct passthrough to GitObjectStore - no serialization overhead.
 */
export class GitNativeRepositoryAccess implements RepositoryAccess {
  constructor(
    private readonly objects: GitObjectStore,
    private readonly refs: RefStore,
    private readonly commits: CommitStore,
    private readonly trees: TreeStore,
  ) {}

  async *listObjects(): AsyncIterable<ObjectId> {
    yield* this.objects.list();
  }

  hasObject(id: ObjectId): Promise<boolean> {
    return this.objects.has(id);
  }

  async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
    try {
      const header = await this.objects.getHeader(id);
      return {
        id,
        type: objectTypeCodeFromString(header.type),
        size: header.size,
      };
    } catch {
      return null;
    }
  }

  async loadObject(id: ObjectId): Promise<GitWireObject | null> {
    try {
      const [header, content] = await this.objects.loadWithHeader(id);
      return {
        id,
        type: objectTypeCodeFromString(header.type),
        size: header.size,
        content,
      };
    } catch {
      return null;
    }
  }

  async *loadRawObject(id: ObjectId): AsyncIterable<Uint8Array> {
    yield* this.objects.loadRaw(id);
  }

  storeObject(type: ObjectTypeCode, content: Uint8Array | AsyncIterable<Uint8Array>): Promise<ObjectId> {
    return this.objects.store(objectTypeStringFromCode(type), content);
  }

  async *walkObjects(wants: ObjectId[], haves: ObjectId[]): AsyncIterable<GitWireObject> {
    const visited = new Set<ObjectId>(haves);
    const pending = [...wants];

    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const obj = await this.loadObject(id);
      if (!obj) continue;

      yield obj;

      if (obj.type === ObjectTypeCode.COMMIT) {
        const commit = await this.commits.loadCommit(id);
        pending.push(commit.tree);
        pending.push(...commit.parents);
      } else if (obj.type === ObjectTypeCode.TREE) {
        for await (const entry of this.trees.loadTree(id)) {
          pending.push(entry.id);
        }
      }
    }
  }

  async *listRefs(): AsyncIterable<RefInfo> {
    for await (const ref of this.refs.list()) {
      yield {
        name: ref.name,
        target: ref.target,
        symbolic: ref.symbolic,
        symbolicTarget: ref.symbolicTarget,
      };
    }
  }

  async getHead(): Promise<HeadInfo | null> {
    const headTarget = await this.refs.resolve("HEAD");
    const symbolicTarget = await this.refs.getSymbolicTarget("HEAD");

    if (!headTarget && !symbolicTarget) return null;

    return {
      target: headTarget ?? null,
      branch: symbolicTarget?.startsWith("refs/heads/")
        ? symbolicTarget.slice("refs/heads/".length)
        : undefined,
      detached: !symbolicTarget,
    };
  }

  async updateRef(name: string, oldId: ObjectId | null, newId: ObjectId | null): Promise<boolean> {
    if (newId === null) {
      return this.refs.delete(name);
    }
    return this.refs.compareAndSwap(name, oldId ?? undefined, newId);
  }
}
```

---

### Task 3.2: Create Git Format Serializers

**File**: `packages/core/src/repository-access/git-serializers.ts` (NEW)

```typescript
import type { Commit } from "../commits/commit-store.js";
import type { TreeEntry } from "../trees/tree-entry.js";
import type { Tag } from "../tags/tag-store.js";
import { commitToEntries, encodeCommitEntries } from "../commits/commit-format.js";
import { encodeTreeEntries } from "../trees/tree-format.js";
import { tagToEntries, encodeTagEntries } from "../tags/tag-format.js";
import { collect } from "@statewalker/vcs-utils/streams";

export async function serializeCommit(commit: Commit): Promise<Uint8Array> {
  const entries = commitToEntries(commit);
  return collect(encodeCommitEntries(entries));
}

export async function serializeTree(entries: TreeEntry[]): Promise<Uint8Array> {
  return collect(encodeTreeEntries(entries));
}

export async function serializeTag(tag: Tag): Promise<Uint8Array> {
  const entries = tagToEntries(tag);
  return collect(encodeTagEntries(entries));
}
```

---

### Task 3.3: Create Git Format Parsers

**File**: `packages/core/src/repository-access/git-parsers.ts` (NEW)

```typescript
import type { Commit } from "../commits/commit-store.js";
import type { TreeEntry } from "../trees/tree-entry.js";
import type { Tag } from "../tags/tag-store.js";
import { decodeCommitEntries, entriesToCommit } from "../commits/commit-format.js";
import { decodeTreeEntries } from "../trees/tree-format.js";
import { decodeTagEntries, entriesToTag } from "../tags/tag-format.js";

async function* toAsyncIterable(data: Uint8Array): AsyncIterable<Uint8Array> {
  yield data;
}

export async function parseCommit(content: Uint8Array): Promise<Commit> {
  const entries = await decodeCommitEntries(toAsyncIterable(content));
  return entriesToCommit(entries);
}

export async function parseTree(content: Uint8Array): Promise<TreeEntry[]> {
  const entries: TreeEntry[] = [];
  for await (const entry of decodeTreeEntries(toAsyncIterable(content))) {
    entries.push(entry);
  }
  return entries;
}

export async function parseTag(content: Uint8Array): Promise<Tag> {
  const entries = await decodeTagEntries(toAsyncIterable(content));
  return entriesToTag(entries);
}
```

---

### Task 3.4: Implement SerializingRepositoryAccess

**File**: `packages/core/src/repository-access/serializing-repository-access.ts` (NEW)

```typescript
import type { RepositoryAccess, GitWireObject, ObjectInfo, RefInfo, HeadInfo } from "./repository-access.js";
import type { CommitStore } from "../commits/commit-store.js";
import type { TreeStore } from "../trees/tree-store.js";
import type { BlobStore } from "../blob/blob-store.js";
import type { TagStore } from "../tags/tag-store.js";
import type { RefStore } from "../refs/ref-store.js";
import type { ObjectId } from "../id/index.js";
import { ObjectTypeCode, objectTypeStringFromCode } from "../objects/object-types.js";
import { encodeObjectHeader } from "../objects/object-header.js";
import { serializeCommit, serializeTree, serializeTag } from "./git-serializers.js";
import { parseCommit, parseTree, parseTag } from "./git-parsers.js";
import { collect } from "@statewalker/vcs-utils/streams";

export interface SerializingRepositoryAccessStores {
  commits: CommitStore;
  trees: TreeStore;
  blobs: BlobStore;
  tags?: TagStore;
  refs: RefStore;
  getObjectType?(id: ObjectId): Promise<ObjectTypeCode | null>;
  listAllObjects?(): AsyncIterable<ObjectId>;
}

/**
 * RepositoryAccess that serializes from high-level stores on-demand.
 * Used for SQL/KV/Memory backends.
 */
export class SerializingRepositoryAccess implements RepositoryAccess {
  constructor(private readonly stores: SerializingRepositoryAccessStores) {}

  async *listObjects(): AsyncIterable<ObjectId> {
    if (this.stores.listAllObjects) {
      yield* this.stores.listAllObjects();
    } else {
      throw new Error("listAllObjects not implemented");
    }
  }

  async hasObject(id: ObjectId): Promise<boolean> {
    if (await this.stores.blobs.has(id)) return true;
    if (await this.tryHasCommit(id)) return true;
    if (await this.tryHasTree(id)) return true;
    if (this.stores.tags && await this.tryHasTag(id)) return true;
    return false;
  }

  async getObjectInfo(id: ObjectId): Promise<ObjectInfo | null> {
    const obj = await this.loadObject(id);
    if (!obj) return null;
    return { id, type: obj.type, size: obj.size };
  }

  async loadObject(id: ObjectId): Promise<GitWireObject | null> {
    if (this.stores.getObjectType) {
      const type = await this.stores.getObjectType(id);
      if (type) return this.loadObjectOfType(id, type);
    }

    return (
      await this.tryLoadCommit(id) ||
      await this.tryLoadTree(id) ||
      await this.tryLoadBlob(id) ||
      await this.tryLoadTag(id) ||
      null
    );
  }

  private async loadObjectOfType(id: ObjectId, type: ObjectTypeCode): Promise<GitWireObject | null> {
    switch (type) {
      case ObjectTypeCode.COMMIT: return this.tryLoadCommit(id);
      case ObjectTypeCode.TREE: return this.tryLoadTree(id);
      case ObjectTypeCode.BLOB: return this.tryLoadBlob(id);
      case ObjectTypeCode.TAG: return this.tryLoadTag(id);
      default: return null;
    }
  }

  private async tryLoadCommit(id: ObjectId): Promise<GitWireObject | null> {
    try {
      const commit = await this.stores.commits.loadCommit(id);
      const content = await serializeCommit(commit);
      return { id, type: ObjectTypeCode.COMMIT, size: content.length, content };
    } catch { return null; }
  }

  private async tryLoadTree(id: ObjectId): Promise<GitWireObject | null> {
    try {
      const entries: TreeEntry[] = [];
      for await (const entry of this.stores.trees.loadTree(id)) {
        entries.push(entry);
      }
      const content = await serializeTree(entries);
      return { id, type: ObjectTypeCode.TREE, size: content.length, content };
    } catch { return null; }
  }

  private async tryLoadBlob(id: ObjectId): Promise<GitWireObject | null> {
    try {
      if (!await this.stores.blobs.has(id)) return null;
      const content = await collect(this.stores.blobs.load(id));
      return { id, type: ObjectTypeCode.BLOB, size: content.length, content };
    } catch { return null; }
  }

  private async tryLoadTag(id: ObjectId): Promise<GitWireObject | null> {
    if (!this.stores.tags) return null;
    try {
      const tag = await this.stores.tags.loadTag(id);
      const content = await serializeTag(tag);
      return { id, type: ObjectTypeCode.TAG, size: content.length, content };
    } catch { return null; }
  }

  async *loadRawObject(id: ObjectId): AsyncIterable<Uint8Array> {
    const obj = await this.loadObject(id);
    if (!obj) throw new Error(`Object not found: ${id}`);

    const typeString = objectTypeStringFromCode(obj.type);
    const header = encodeObjectHeader(typeString, obj.size);
    yield header;

    if (obj.content instanceof Uint8Array) {
      yield obj.content;
    } else {
      yield* obj.content;
    }
  }

  async storeObject(type: ObjectTypeCode, content: Uint8Array | AsyncIterable<Uint8Array>): Promise<ObjectId> {
    const bytes = content instanceof Uint8Array ? content : await collect(content);

    switch (type) {
      case ObjectTypeCode.COMMIT:
        return this.stores.commits.storeCommit(await parseCommit(bytes));
      case ObjectTypeCode.TREE:
        return this.stores.trees.storeTree(await parseTree(bytes));
      case ObjectTypeCode.BLOB:
        return this.stores.blobs.store([bytes]);
      case ObjectTypeCode.TAG:
        if (!this.stores.tags) throw new Error("Tag store not available");
        return this.stores.tags.storeTag(await parseTag(bytes));
      default:
        throw new Error(`Unknown object type: ${type}`);
    }
  }

  async *walkObjects(wants: ObjectId[], haves: ObjectId[]): AsyncIterable<GitWireObject> {
    const visited = new Set<ObjectId>(haves);
    const pending = [...wants];

    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);

      const obj = await this.loadObject(id);
      if (!obj) continue;

      yield obj;

      if (obj.type === ObjectTypeCode.COMMIT) {
        const commit = await this.stores.commits.loadCommit(id);
        pending.push(commit.tree);
        pending.push(...commit.parents);
      } else if (obj.type === ObjectTypeCode.TREE) {
        for await (const entry of this.stores.trees.loadTree(id)) {
          pending.push(entry.id);
        }
      }
    }
  }

  async *listRefs(): AsyncIterable<RefInfo> {
    for await (const ref of this.stores.refs.list()) {
      yield { name: ref.name, target: ref.target, symbolic: ref.symbolic, symbolicTarget: ref.symbolicTarget };
    }
  }

  async getHead(): Promise<HeadInfo | null> {
    const headTarget = await this.stores.refs.resolve("HEAD");
    const symbolicTarget = await this.stores.refs.getSymbolicTarget("HEAD");
    if (!headTarget && !symbolicTarget) return null;
    return {
      target: headTarget ?? null,
      branch: symbolicTarget?.startsWith("refs/heads/") ? symbolicTarget.slice("refs/heads/".length) : undefined,
      detached: !symbolicTarget,
    };
  }

  async updateRef(name: string, oldId: ObjectId | null, newId: ObjectId | null): Promise<boolean> {
    if (newId === null) return this.stores.refs.delete(name);
    return this.stores.refs.compareAndSwap(name, oldId ?? undefined, newId);
  }

  private async tryHasCommit(id: ObjectId): Promise<boolean> {
    try { await this.stores.commits.loadCommit(id); return true; } catch { return false; }
  }

  private async tryHasTree(id: ObjectId): Promise<boolean> {
    try { for await (const _ of this.stores.trees.loadTree(id)) return true; return false; } catch { return false; }
  }

  private async tryHasTag(id: ObjectId): Promise<boolean> {
    if (!this.stores.tags) return false;
    try { await this.stores.tags.loadTag(id); return true; } catch { return false; }
  }
}
```

---

### Task 3.5: Export RepositoryAccess Implementations

**File**: `packages/core/src/repository-access/index.ts` (UPDATE)

```typescript
// Types
export type { RepositoryAccess, GitWireObject, ObjectInfo, RefInfo, HeadInfo } from "./repository-access.js";

// Implementations
export { GitNativeRepositoryAccess } from "./git-native-repository-access.js";
export { SerializingRepositoryAccess } from "./serializing-repository-access.js";
export type { SerializingRepositoryAccessStores } from "./serializing-repository-access.js";

// Serializers/Parsers (for custom implementations)
export { serializeCommit, serializeTree, serializeTag } from "./git-serializers.js";
export { parseCommit, parseTree, parseTag } from "./git-parsers.js";
```

---

## Phase 4: Update HistoryStore

**Goal**: Add `getRepositoryAccess()` and remove `objects` from public interface.

### Task 4.1: Update HistoryStore Interface

**File**: `packages/core/src/history-store.ts` (UPDATE)

```typescript
import type { RepositoryAccess } from "./repository-access/index.js";
import type { CommitStore } from "./commits/commit-store.js";
import type { TreeStore } from "./trees/tree-store.js";
import type { BlobStore } from "./blob/blob-store.js";
import type { TagStore } from "./tags/tag-store.js";
import type { RefStore } from "./refs/ref-store.js";
import type { GCController } from "./gc/gc-controller.js";

export interface HistoryStoreConfig {
  gitDir: string;
  bare?: boolean;
}

/**
 * Immutable history storage (Part 1 of three-part architecture).
 *
 * Provides access to all Git objects and references.
 */
export interface HistoryStore {
  // High-level stores (PUBLIC API)
  readonly commits: CommitStore;
  readonly trees: TreeStore;
  readonly blobs: BlobStore;
  readonly tags: TagStore;
  readonly refs: RefStore;

  // Configuration
  readonly config: HistoryStoreConfig;

  // Optional: Garbage collection
  readonly gc?: GCController;

  /**
   * Get low-level repository access for transport and maintenance.
   */
  getRepositoryAccess(): RepositoryAccess;

  // Lifecycle
  initialize(): Promise<void>;
  close(): Promise<void>;
  isInitialized(): Promise<boolean>;
}
```

---

### Task 4.2: Update GitRepository Implementation

**File**: `packages/core/src/stores/create-repository.ts` (UPDATE)

```typescript
import { GitNativeRepositoryAccess } from "../repository-access/git-native-repository-access.js";
import type { RepositoryAccess } from "../repository-access/index.js";

export class GitRepository implements HistoryStore {
  // Internal - not exposed
  private readonly _objects: GitObjectStoreImpl;
  private _repositoryAccess?: RepositoryAccess;

  // Public stores
  readonly commits: CommitStore;
  readonly trees: TreeStore;
  readonly blobs: BlobStore;
  readonly tags: TagStore;
  readonly refs: RefStore;
  readonly config: HistoryStoreConfig;
  readonly gc?: GCController;

  constructor(/* ... */) {
    // ... existing initialization
  }

  getRepositoryAccess(): RepositoryAccess {
    if (!this._repositoryAccess) {
      this._repositoryAccess = new GitNativeRepositoryAccess(
        this._objects,
        this.refs,
        this.commits,
        this.trees,
      );
    }
    return this._repositoryAccess;
  }

  // ... other methods
}
```

---

### Task 4.3: Remove GitObjectStore from Public Exports

**File**: `packages/core/src/index.ts` (UPDATE)

```typescript
// REMOVE:
// export type { GitObjectStore } from "./objects/object-store.js";

// GitObjectStore is now internal to the package
```

---

## Phase 5: Update Transport Layer

**Goal**: Replace VcsStores with RepositoryAccess.

### Task 5.1: Replace vcs-repository-adapter

**File**: `packages/transport/src/storage-adapters/vcs-repository-adapter.ts` (REPLACE)

```typescript
import type { RepositoryAccess } from "@statewalker/vcs-core";

/**
 * Transport layer repository access interface.
 */
export interface TransportRepositoryAccess {
  listRefs(): AsyncIterable<RefInfo>;
  getHead(): Promise<HeadInfo | null>;
  hasObject(id: ObjectId): Promise<boolean>;
  getObjectInfo(id: ObjectId): Promise<ObjectInfo | null>;
  loadObject(id: ObjectId): AsyncIterable<Uint8Array>;
  storeObject(type: ObjectTypeCode, content: Uint8Array | AsyncIterable<Uint8Array>): Promise<ObjectId>;
  updateRef(name: string, oldId: ObjectId | null, newId: ObjectId | null): Promise<boolean>;
  walkObjects(wants: ObjectId[], haves: ObjectId[]): AsyncIterable<GitWireObject>;
}

/**
 * Create transport adapter from RepositoryAccess.
 */
export function createRepositoryAccessAdapter(access: RepositoryAccess): TransportRepositoryAccess {
  return {
    listRefs: () => access.listRefs(),
    getHead: () => access.getHead(),
    hasObject: (id) => access.hasObject(id),
    getObjectInfo: (id) => access.getObjectInfo(id),
    loadObject: (id) => access.loadRawObject(id),
    storeObject: (type, content) => access.storeObject(type, content),
    updateRef: (name, oldId, newId) => access.updateRef(name, oldId, newId),
    walkObjects: (wants, haves) => access.walkObjects(wants, haves),
  };
}
```

---

### Task 5.2: Update HTTP Server

**File**: `packages/transport/src/http-server/git-http-server.ts` (UPDATE)

```typescript
import type { RepositoryAccess } from "@statewalker/vcs-core";

export interface GitHttpServerOptions {
  resolveRepository: (path: string) => Promise<RepositoryAccess | null>;
  authenticate?: (request: Request) => Promise<AuthResult>;
  authorize?: (repo: string, operation: 'fetch' | 'push') => Promise<boolean>;
  onError?: (error: Error) => void;
  logger?: Logger;
}
```

---

### Task 5.3: Update All Transport Handlers

Update all files that use VcsStores:
- `handlers/upload-pack-handler.ts`
- `handlers/receive-pack-handler.ts`
- `operations/fetch.ts`
- `operations/push.ts`
- `operations/clone.ts`

---

## Phase 6: Update GC

**Goal**: Integrate DeltaEngine into GC.

### Task 6.1: Define GCController Interface

**File**: `packages/core/src/gc/gc-controller.ts` (NEW)

```typescript
export interface GCOptions {
  prune?: boolean;
  repack?: boolean;
  aggressive?: boolean;
}

export interface GCResult {
  objectsRemoved: number;
  bytesReclaimed: number;
  deltaCreated: number;
  deltaSavings: number;
}

export interface GCStats {
  objectCount: number;
  looseObjectCount: number;
  packFileCount: number;
  deltaCount: number;
  totalSize: number;
}

export interface GCController {
  collect(options?: GCOptions): Promise<GCResult>;
  getStats(): Promise<GCStats>;
}
```

---

### Task 6.2: Create DeltaAwareGC

**File**: `packages/core/src/gc/delta-aware-gc.ts` (NEW)

```typescript
import type { GCController, GCOptions, GCResult, GCStats } from "./gc-controller.js";
import type { DeltaEngine, DeltaTarget } from "../delta/index.js";
import type { DeltaStorage } from "../delta/storage/delta-storage.js";
import type { RepositoryAccess } from "../repository-access/index.js";
import type { RefStore } from "../refs/ref-store.js";
import type { CommitStore } from "../commits/commit-store.js";
import type { TreeStore } from "../trees/tree-store.js";

export class DeltaAwareGC implements GCController {
  constructor(
    private deltaEngine: DeltaEngine,
    private deltaStorage: DeltaStorage,
    private repositoryAccess: RepositoryAccess,
    private refs: RefStore,
    private commits: CommitStore,
    private trees: TreeStore,
  ) {}

  async collect(options?: GCOptions): Promise<GCResult> {
    let objectsRemoved = 0;
    let bytesReclaimed = 0;
    let deltaCreated = 0;
    let deltaSavings = 0;

    // 1. Find reachable objects
    const reachable = await this.findReachableObjects();

    // 2. Prune unreferenced
    if (options?.prune) {
      const pruneResult = await this.pruneUnreferenced(reachable);
      objectsRemoved = pruneResult.count;
      bytesReclaimed = pruneResult.bytes;
    }

    // 3. Repack with delta compression
    if (options?.repack) {
      const targets = this.getRepackTargets(reachable, options.aggressive);
      for await (const result of this.deltaEngine.processBatch(targets)) {
        if (result.result) {
          await this.deltaStorage.storeDelta(result.targetId, result.result);
          deltaCreated++;
          deltaSavings += result.result.savings;
        }
      }
    }

    return { objectsRemoved, bytesReclaimed, deltaCreated, deltaSavings };
  }

  async getStats(): Promise<GCStats> {
    // Implementation
  }

  private async findReachableObjects(): Promise<Set<ObjectId>> {
    const reachable = new Set<ObjectId>();

    for await (const ref of this.refs.list()) {
      for await (const obj of this.repositoryAccess.walkObjects([ref.target], [])) {
        reachable.add(obj.id);
      }
    }

    return reachable;
  }

  private async pruneUnreferenced(reachable: Set<ObjectId>): Promise<{ count: number; bytes: number }> {
    // Implementation
  }

  private async *getRepackTargets(reachable: Set<ObjectId>, aggressive?: boolean): AsyncIterable<DeltaTarget> {
    // Implementation
  }
}
```

---

### Task 6.3: Create Pre-configured GC Strategies

**File**: `packages/core/src/gc/strategies/git-native-gc.ts` (NEW)

```typescript
import { DeltaAwareGC } from "../delta-aware-gc.js";
import { DefaultDeltaEngine } from "../../delta/engine/default-delta-engine.js";
import { GitDeltaCompressor } from "../../delta/compressor/git-delta-compressor.js";
import { CompositeCandidateFinder } from "../../delta/candidate-finder/composite-finder.js";
import { CommitTreeCandidateFinder } from "../../delta/candidate-finder/commit-tree-finder.js";
import { PathBasedCandidateFinder } from "../../delta/candidate-finder/path-based-finder.js";
import { DefaultDeltaDecisionStrategy } from "../../delta/strategy/default-delta-decision-strategy.js";
import { ObjectTypeCode } from "../../objects/object-types.js";

export function createGitNativeGC(repository: GitRepository): GCController {
  const compressor = new GitDeltaCompressor();

  const candidateFinder = new CompositeCandidateFinder([
    new CommitTreeCandidateFinder(repository.commits, repository.trees),
    new PathBasedCandidateFinder(repository.pathIndex, repository.sizeIndex),
  ]);

  const strategy = new DefaultDeltaDecisionStrategy({
    allowedTypes: [
      ObjectTypeCode.COMMIT,
      ObjectTypeCode.TREE,
      ObjectTypeCode.BLOB,
      ObjectTypeCode.TAG,
    ],
    maxChainDepth: 50,
    minCompressionRatio: 1.5,
  });

  const deltaEngine = new DefaultDeltaEngine(
    compressor,
    candidateFinder,
    strategy,
    repository.objectLoader,
  );

  return new DeltaAwareGC(
    deltaEngine,
    repository.deltaStorage,
    repository.getRepositoryAccess(),
    repository.refs,
    repository.commits,
    repository.trees,
  );
}
```

**File**: `packages/core/src/gc/strategies/blob-only-gc.ts` (NEW)

```typescript
export function createBlobOnlyGC(stores: SerializingRepositoryAccessStores): GCController {
  const compressor = new GitDeltaCompressor();

  const candidateFinder = new PathBasedCandidateFinder(
    stores.pathIndex,
    stores.sizeIndex,
  );

  const strategy = new DefaultDeltaDecisionStrategy({
    allowedTypes: [ObjectTypeCode.BLOB],  // Only blobs
    maxChainDepth: 10,
    minCompressionRatio: 2.0,
  });

  // ... rest of setup
}
```

---

## Phase 7: Testing

### Task 7.1: RepositoryAccess Tests

**File**: `packages/core/src/__tests__/repository-access.test.ts` (NEW)

Test both implementations:
- GitNativeRepositoryAccess
- SerializingRepositoryAccess

### Task 7.2: Delta Engine Tests

**File**: `packages/core/src/__tests__/delta-engine.test.ts` (NEW)

Test:
- GitDeltaCompressor
- CandidateFinders
- DeltaDecisionStrategy
- DefaultDeltaEngine

### Task 7.3: Integration Tests

**File**: `packages/transport/src/__tests__/repository-access-integration.test.ts` (NEW)

Test transport operations with both RepositoryAccess implementations.

### Task 7.4: Update Existing Tests

Update all tests that use `historyStore.objects` to use `historyStore.getRepositoryAccess()`.

---

## Phase 8: Documentation

### Task 8.1: Update ARCHITECTURE.md

Update to reflect:
- RepositoryAccess as transport interface
- DeltaEngine architecture
- GC strategies

### Task 8.2: Add API Documentation

JSDoc for all new interfaces and classes.

### Task 8.3: Add Usage Examples

Examples for:
- Using RepositoryAccess for transport
- Implementing custom storage backend
- Configuring delta strategies

---

## Implementation Order

| Phase | Description | Dependencies | Effort |
|-------|-------------|--------------|--------|
| 1 | Core Interfaces | None | Medium |
| 2 | Delta Engine Implementations | Phase 1 | Large |
| 3 | RepositoryAccess Implementations | Phase 1 | Medium |
| 4 | Update HistoryStore | Phases 2, 3 | Small |
| 5 | Update Transport | Phase 4 | Medium |
| 6 | Update GC | Phases 2, 4 | Medium |
| 7 | Testing | All | Medium |
| 8 | Documentation | All | Small |

---

## Files Summary

### New Files (25)

| File | Phase |
|------|-------|
| `core/src/repository-access/repository-access.ts` | 1 |
| `core/src/repository-access/index.ts` | 1 |
| `core/src/delta/compressor/delta-compressor.ts` | 1 |
| `core/src/delta/candidate-finder/candidate-finder.ts` | 1 |
| `core/src/delta/strategy/delta-decision-strategy.ts` | 1 |
| `core/src/delta/engine/delta-engine.ts` | 1 |
| `core/src/delta/storage/delta-storage.ts` | 1 |
| `core/src/delta/index.ts` | 1 |
| `core/src/delta/compressor/git-delta-compressor.ts` | 2 |
| `core/src/delta/candidate-finder/path-based-finder.ts` | 2 |
| `core/src/delta/candidate-finder/commit-tree-finder.ts` | 2 |
| `core/src/delta/candidate-finder/composite-finder.ts` | 2 |
| `core/src/delta/strategy/default-delta-decision-strategy.ts` | 2 |
| `core/src/delta/engine/default-delta-engine.ts` | 2 |
| `core/src/repository-access/git-native-repository-access.ts` | 3 |
| `core/src/repository-access/serializing-repository-access.ts` | 3 |
| `core/src/repository-access/git-serializers.ts` | 3 |
| `core/src/repository-access/git-parsers.ts` | 3 |
| `core/src/gc/gc-controller.ts` | 6 |
| `core/src/gc/delta-aware-gc.ts` | 6 |
| `core/src/gc/strategies/git-native-gc.ts` | 6 |
| `core/src/gc/strategies/blob-only-gc.ts` | 6 |
| `core/src/__tests__/repository-access.test.ts` | 7 |
| `core/src/__tests__/delta-engine.test.ts` | 7 |
| `transport/src/__tests__/repository-access-integration.test.ts` | 7 |

### Modified Files (8)

| File | Changes |
|------|---------|
| `core/src/index.ts` | Add exports, remove GitObjectStore |
| `core/src/history-store.ts` | Add getRepositoryAccess(), remove objects |
| `core/src/stores/create-repository.ts` | Implement getRepositoryAccess() |
| `transport/src/storage-adapters/vcs-repository-adapter.ts` | Replace implementation |
| `transport/src/http-server/git-http-server.ts` | Use RepositoryAccess |
| `transport/src/handlers/*.ts` | Update to use new interface |
| `transport/src/operations/*.ts` | Update to use new interface |
| `core/ARCHITECTURE.md` | Update documentation |

### Deleted Exports

| Item | Package |
|------|---------|
| `GitObjectStore` type | `@statewalker/vcs-core` |
| `VcsStores` interface | `@statewalker/vcs-transport` |
| `createVcsRepositoryAdapter()` | `@statewalker/vcs-transport` |

---

## Success Criteria

1. `GitObjectStore` not accessible from public HistoryStore interface
2. `GitObjectStore` not exported from `@statewalker/vcs-core`
3. Transport works with any `RepositoryAccess` implementation
4. Delta compression reusable across storage types
5. GC uses pluggable delta strategies
6. All existing tests pass
7. Documentation complete
