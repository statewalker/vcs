# Native Pack Delta Store Implementation Plan

**Date:** 2025-12-27
**Status:** Proposed
**Approach:** Option B - PackDirectory Extension
**Related Analysis:** [notes/src/2025-12-27/01-[vcs]-unified-storage-interface-proposals.md](../../notes/src/2025-12-27/01-[vcs]-unified-storage-interface-proposals.md)

## Overview

Replace the current `PackDeltaStore` implementation (which stores deltas as BLOBs with separate JSON metadata) with a native implementation that stores deltas as `OFS_DELTA`/`REF_DELTA` and reads relationships directly from pack headers.

Additionally, move `PackDeltaStore` from `delta/` to `pack/` to enforce proper separation of concerns.

## Folder Organization Principle

```
packages/core/src/
├── delta/           # ABSTRACT layer - interfaces and generic algorithms
│   ├── delta-store.ts         # DeltaStore interface
│   ├── types.ts               # Delta types
│   ├── gc-controller.ts       # GC algorithms (uses DeltaStore interface)
│   ├── storage-analyzer.ts    # Analysis algorithms
│   ├── raw-store-with-delta.ts # Abstract composition
│   ├── packing-orchestrator.ts # Orchestration
│   ├── delta-binary-format.ts # Serialization (shared)
│   └── strategies/            # Delta candidate strategies
│
└── pack/            # GIT-SPECIFIC layer - implementations
    ├── pack-delta-store.ts    # DeltaStore implementation (MOVED HERE)
    ├── delta-reverse-index.ts # Reverse index for packs (NEW)
    ├── pack-directory.ts      # Pack file management
    ├── pack-reader.ts         # Pack file reading
    ├── pack-writer.ts         # Pack file writing
    ├── pending-pack.ts        # Pack buffering
    └── ...                    # Other pack infrastructure
```

## Current vs Proposed Architecture

### Current Architecture

```
delta/PackDeltaStore (WRONG LOCATION)
├── PackDirectory     → Stores delta bytes as BLOB (type 3)
├── DeltaMetadataIndex → JSON file tracking base→target relationships
└── PendingPack        → Buffers objects before pack creation
```

**Problems:**
- Deltas stored as BLOBs, not native delta types
- Relationships tracked in separate JSON file
- Git tools can't inspect delta relationships
- PackDeltaStore in delta/ breaks abstraction (implementation in abstract layer)

### Proposed Architecture

```
pack/PackDeltaStore (CORRECT LOCATION)
├── PackDirectory     → Stores as OFS_DELTA/REF_DELTA (types 6/7)
├── DeltaReverseIndex → In-memory cache built from pack headers
└── PendingPack        → Already supports native deltas
```

**Benefits:**
- Git-compatible delta storage
- Relationships implicit in pack format
- No separate metadata file
- Reduced storage overhead
- Proper separation: delta/ = abstract, pack/ = Git-specific

## References

### Git References
- [Pack format documentation](https://git-scm.com/docs/gitformat-pack) - OFS_DELTA and REF_DELTA format
- [gitformat-pack - Reverse index format](https://git-scm.com/docs/gitformat-pack#_pack_rev_files_have_the_format) - `.rev` file specification
- [pack-revindex.c](https://github.com/git/git/blob/master/pack-revindex.c) - Git's reverse index implementation
- [git-index-pack](https://git-scm.com/docs/git-index-pack) - Pack indexing

### JGit References
- `org.eclipse.jgit.internal.storage.file.Pack` - Pack file handling
- `org.eclipse.jgit.internal.storage.pack.ObjectToPack` - Delta base tracking in memory
- `org.eclipse.jgit.internal.storage.file.PackReverseIndex` - Offset→Position mapping interface
- `org.eclipse.jgit.internal.storage.file.PackReverseIndexComputed` - Computed from forward index
- `org.eclipse.jgit.internal.storage.file.PackReverseIndexV1` - Read from `.rev` file
- `org.eclipse.jgit.internal.storage.file.GC` - Reachability-based garbage collection

---

## Important: Reverse Index Clarification

### Two Different Concepts

There are **two distinct reverse index concepts** that must not be confused:

| Concept | Purpose | Format | Git Compatibility |
|---------|---------|--------|-------------------|
| **Git's .rev file** (PackReverseIndex) | offset→position mapping | Native `.rev` file format | ✅ Git-compatible |
| **DeltaReverseIndex** | base→targets mapping | In-memory only | ❌ Custom (no Git equivalent) |

### Git's .rev File Format

Git's reverse index (`.rev` file) maps pack **offsets to index positions**. This enables:
- Finding the nth object by offset order for pack streaming
- Efficiently iterating objects in pack file order
- Required for pack verification and copy operations

**Format** (from `gitformat-pack` specification):
```
RIDX magic (4 bytes: 'R', 'I', 'D', 'X')
Version (4 bytes, network order, currently 1)
Hash algorithm ID (4 bytes, network order)
Index positions sorted by pack offset (4 bytes each × object count)
Pack file checksum (20 bytes SHA-1)
Reverse index checksum (20 bytes SHA-1)
```

**JGit implementations:**
- `PackReverseIndexV1` - reads from `.rev` file
- `PackReverseIndexComputed` - builds from forward index using bucket sort

### DeltaReverseIndex (Our Custom Index)

Our `DeltaReverseIndex` maps **delta bases to their targets**. This enables:
- O(1) lookup of objects depending on a base (critical for GC safety)
- Efficient dependent chain traversal
- Checking if an object can be safely deleted

**Key point:** Git does NOT have a native persistent format for base→targets mapping. Git rebuilds this relationship in memory during repack operations by scanning pack headers.

### Implementation Decisions

1. **DeltaReverseIndex** remains in-memory only (like Git's approach)
2. **PackReverseIndex** (offset→position) can optionally be added for:
   - Git `.rev` file compatibility
   - Efficient pack iteration
   - Pack verification

The current plan focuses on DeltaReverseIndex because it's required for delta operations. PackReverseIndex (Git's `.rev` format) is orthogonal and can be added separately if needed for pack streaming operations.

---

## Implementation Steps

### Step 1: Extend PackDirectory with Delta Methods

Add methods to query delta information directly from pack headers.

**File:** `packages/core/src/pack/pack-directory.ts`

**Changes:**

```typescript
import type { ObjectId } from "../id/index.js";
import type { PackDeltaChainInfo } from "./pack-reader.js";

export class PackDirectory {
  // ... existing methods ...

  /**
   * Check if object is stored as delta in any pack
   *
   * Reads the pack header to determine object type.
   * OFS_DELTA (type 6) and REF_DELTA (type 7) are deltas.
   *
   * Based on: jgit Pack.java#loadObjectSize (checks object type from header)
   *
   * @param id Object ID to check
   * @returns True if stored as delta
   */
  async isDelta(id: ObjectId): Promise<boolean> {
    const packName = await this.findPack(id);
    if (!packName) return false;
    const reader = await this.getPack(packName);
    return reader.isDelta(id);
  }

  /**
   * Get immediate delta base (not full chain resolution)
   *
   * For OFS_DELTA: calculates base offset and finds object ID
   * For REF_DELTA: returns the embedded base object ID
   *
   * Based on: jgit Pack.java#resolveDeltas
   *
   * @param id Object ID to query
   * @returns Base object ID or undefined if not a delta
   */
  async getDeltaBase(id: ObjectId): Promise<ObjectId | undefined> {
    const packName = await this.findPack(id);
    if (!packName) return undefined;

    const reader = await this.getPack(packName);
    const offset = reader.index.findOffset(id);
    if (offset === -1) return undefined;

    const header = await reader.readObjectHeader(offset);

    if (header.type === 7) {
      // REF_DELTA - base ID embedded in header
      return header.baseId;
    } else if (header.type === 6) {
      // OFS_DELTA - calculate base offset, find corresponding ID
      if (header.baseOffset === undefined) {
        throw new Error("OFS_DELTA missing base offset");
      }
      const baseOffset = offset - header.baseOffset;
      return reader.findObjectIdByOffset(baseOffset);
    }

    return undefined; // Not a delta
  }

  /**
   * Get delta chain info (depth, ultimate base)
   *
   * Walks the delta chain from target to ultimate base object.
   *
   * Based on: jgit Pack.java#load (delta chain resolution)
   *
   * @param id Object ID to query
   * @returns Chain info or undefined if not a delta
   */
  async getDeltaChainInfo(id: ObjectId): Promise<PackDeltaChainInfo | undefined> {
    const packName = await this.findPack(id);
    if (!packName) return undefined;
    const reader = await this.getPack(packName);
    return reader.getDeltaChainInfo(id);
  }

  /**
   * Find all objects that depend on a base (O(n) scan)
   *
   * Scans all pack headers to find objects with matching base.
   * For efficient repeated queries, use DeltaReverseIndex.
   *
   * Note: Git/JGit don't maintain persistent reverse indexes for
   * delta relationships - they rebuild during repack operations.
   *
   * @param baseId Base object ID
   * @returns Array of dependent object IDs
   */
  async findDependents(baseId: ObjectId): Promise<ObjectId[]> {
    const dependents: ObjectId[] = [];

    for await (const id of this.listObjects()) {
      const base = await this.getDeltaBase(id);
      if (base === baseId) {
        dependents.push(id);
      }
    }

    return dependents;
  }

  /**
   * List all delta relationships by scanning pack headers
   *
   * Iterates through all objects and yields those stored as deltas.
   *
   * @returns Async iterable of target→base relationships
   */
  async *listDeltaRelationships(): AsyncIterable<{ target: ObjectId; base: ObjectId }> {
    for await (const id of this.listObjects()) {
      const base = await this.getDeltaBase(id);
      if (base) {
        yield { target: id, base };
      }
    }
  }

  /**
   * Build reverse index for efficient dependent lookups
   *
   * Scans all packs once to build an in-memory index of
   * base→targets relationships.
   *
   * @returns DeltaReverseIndex with O(1) lookups
   */
  async buildReverseIndex(): Promise<DeltaReverseIndex> {
    return DeltaReverseIndex.build(this);
  }
}
```

---

### Step 2: Make PackReader Methods Public

Expose internal methods needed by PackDirectory for delta queries.

**File:** `packages/core/src/pack/pack-reader.ts`

**Changes:**

```typescript
export class PackReader {
  // Change from private to public
  /**
   * Read object header at offset
   *
   * Parses the variable-length header to get type and size.
   * For delta types, also reads base offset/id.
   *
   * Based on: jgit PackFile.java#getObjectHeader
   *
   * @param offset Byte offset in pack file
   * @returns Parsed header information
   */
  async readObjectHeader(offset: number): Promise<PackObjectHeader> {
    // ... existing implementation unchanged ...
  }

  // Change from private to public
  /**
   * Find object ID by its offset in the pack file
   *
   * Iterates through index entries to find matching offset.
   * Used to resolve OFS_DELTA base references.
   *
   * Note: This is O(n) - for large packs, consider using
   * PackReverseIndex for offset→id mapping.
   *
   * Based on: jgit PackReverseIndex.java#findObject
   *
   * @param offset Offset to search for
   * @returns Object ID
   * @throws Error if offset not found
   */
  findObjectIdByOffset(offset: number): ObjectId {
    // Iterate through all entries to find matching offset
    for (const entry of this.index.entries()) {
      if (entry.offset === offset) {
        return entry.id;
      }
    }
    throw new Error(`Object at offset ${offset} not found in index`);
  }

  /**
   * Load raw delta bytes without resolution
   *
   * Returns the compressed delta data directly, without
   * applying the delta to reconstruct the object.
   *
   * Useful for:
   * - Copying deltas between packs
   * - Inspecting delta format
   * - Re-deltifying with different base
   *
   * Based on: jgit Pack.java#copyAsIs
   *
   * @param id Object ID
   * @returns Raw delta bytes or undefined if not a delta
   */
  async loadRawDelta(id: ObjectId): Promise<Uint8Array | undefined> {
    const offset = this.index.findOffset(id);
    if (offset === -1) return undefined;

    const header = await this.readObjectHeader(offset);

    // Not a delta - return undefined
    if (header.type !== 6 && header.type !== 7) {
      return undefined;
    }

    // Calculate data offset (after header and base reference)
    let dataOffset = offset + header.headerLength;

    // REF_DELTA includes 20-byte base object ID
    if (header.type === 7) {
      dataOffset += 20; // SHA-1 length
    }

    // Decompress delta data
    return this.decompress(dataOffset, header.size);
  }
}
```

---

### Step 3: Add Delta Reverse Index

Create an in-memory cache for efficient base→targets lookups.

**IMPORTANT:** This is NOT Git's `.rev` file format!

| Index Type | Purpose | This Implementation |
|------------|---------|---------------------|
| Git's `.rev` (PackReverseIndex) | offset→position | No (future work if needed) |
| DeltaReverseIndex | base→targets | ✅ Yes |

Git's `.rev` file enables efficient pack iteration by offset order. Our `DeltaReverseIndex`
enables efficient GC by tracking delta dependencies. Both Git and JGit rebuild
base→targets relationships in memory during repack - there is no native Git format for this.

**File:** `packages/core/src/pack/delta-reverse-index.ts` (new file)

```typescript
/**
 * Delta reverse index for base→targets relationships
 *
 * IMPORTANT: This is NOT Git's .rev file format!
 *
 * Git's .rev file format (RIDX magic) maps offset→position for pack iteration.
 * This DeltaReverseIndex maps base→targets for delta dependency tracking.
 *
 * Provides O(1) lookup for delta relationships in both directions:
 * - target → base (getBase)
 * - base → targets (getTargets)
 *
 * Built by scanning pack headers once. Must be invalidated when
 * packs are added/removed.
 *
 * Implementation note: Like Git/JGit, we keep this in-memory only.
 * Git rebuilds delta relationships during repack operations by
 * scanning pack headers - there is no native persistent format.
 *
 * See: jgit PackReverseIndexComputed (different purpose: offset→position)
 * See: jgit ObjectToPack.deltaBase (in-memory delta base tracking)
 */

import type { ObjectId } from "../id/index.js";
import type { PackDirectory } from "./pack-directory.js";

/**
 * Delta relationship entry
 */
export interface DeltaRelationship {
  target: ObjectId;
  base: ObjectId;
  depth?: number;
}

/**
 * In-memory reverse index for delta relationships
 */
export class DeltaReverseIndex {
  /** Map: base → Set of targets */
  private readonly baseToTargets = new Map<ObjectId, Set<ObjectId>>();

  /** Map: target → base */
  private readonly targetToBase = new Map<ObjectId, ObjectId>();

  /**
   * Build reverse index from PackDirectory
   *
   * Scans all pack files to build the index.
   * O(n) where n = total objects in all packs.
   *
   * @param packDir PackDirectory to scan
   * @returns Built reverse index
   */
  static async build(packDir: PackDirectory): Promise<DeltaReverseIndex> {
    const index = new DeltaReverseIndex();

    for await (const { target, base } of packDir.listDeltaRelationships()) {
      index.add(target, base);
    }

    return index;
  }

  /**
   * Add a delta relationship
   *
   * @param target Target object ID (the delta)
   * @param base Base object ID (delta source)
   */
  add(target: ObjectId, base: ObjectId): void {
    this.targetToBase.set(target, base);

    let targets = this.baseToTargets.get(base);
    if (!targets) {
      targets = new Set();
      this.baseToTargets.set(base, targets);
    }
    targets.add(target);
  }

  /**
   * Remove a delta relationship
   *
   * @param target Target object ID
   * @returns True if removed
   */
  remove(target: ObjectId): boolean {
    const base = this.targetToBase.get(target);
    if (!base) return false;

    this.targetToBase.delete(target);

    const targets = this.baseToTargets.get(base);
    if (targets) {
      targets.delete(target);
      if (targets.size === 0) {
        this.baseToTargets.delete(base);
      }
    }

    return true;
  }

  /**
   * Get all targets that depend on a base (O(1))
   *
   * @param base Base object ID
   * @returns Array of target object IDs
   */
  getTargets(base: ObjectId): ObjectId[] {
    const targets = this.baseToTargets.get(base);
    return targets ? [...targets] : [];
  }

  /**
   * Get base for a target (O(1))
   *
   * @param target Target object ID
   * @returns Base object ID or undefined
   */
  getBase(target: ObjectId): ObjectId | undefined {
    return this.targetToBase.get(target);
  }

  /**
   * Check if base has any dependents (O(1))
   *
   * Critical for GC - can't delete objects with dependents.
   *
   * @param base Base object ID
   * @returns True if has dependents
   */
  hasTargets(base: ObjectId): boolean {
    const targets = this.baseToTargets.get(base);
    return targets !== undefined && targets.size > 0;
  }

  /**
   * Check if target is a delta (O(1))
   *
   * @param target Target object ID
   * @returns True if stored as delta
   */
  isDelta(target: ObjectId): boolean {
    return this.targetToBase.has(target);
  }

  /**
   * Get number of delta relationships
   */
  get size(): number {
    return this.targetToBase.size;
  }

  /**
   * Iterate all relationships
   */
  *entries(): IterableIterator<DeltaRelationship> {
    for (const [target, base] of this.targetToBase) {
      yield { target, base };
    }
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.baseToTargets.clear();
    this.targetToBase.clear();
  }
}
```

---

### Step 4: Create Native PackDeltaStore Implementation

Replace the current implementation with native delta storage.
**Move from `delta/` to `pack/`** to enforce proper separation of concerns.

**File:** `packages/core/src/pack/pack-delta-store.ts` (NEW LOCATION)

```typescript
/**
 * Native pack-based delta store
 *
 * Stores deltas using Git's native OFS_DELTA/REF_DELTA types.
 * Relationships are read from pack headers - no separate metadata needed.
 *
 * This is the Git-specific implementation of DeltaStore interface.
 * Located in pack/ because it depends on Git pack format.
 *
 * Based on:
 * - jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/Pack.java
 * - jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/pack/PackWriter.java
 */

import type { Delta } from "@statewalker/vcs-utils";
import type { FilesApi } from "../files/index.js";
import { PackDirectory } from "./pack-directory.js";
import { PendingPack } from "./pending-pack.js";
import { DeltaReverseIndex } from "./delta-reverse-index.js";
import { parseBinaryDelta, serializeDelta } from "../delta/delta-binary-format.js";
import type { DeltaChainDetails, DeltaInfo, DeltaStore, StoredDelta } from "../delta/delta-store.js";

/** Default flush threshold (number of objects) */
const DEFAULT_FLUSH_THRESHOLD = 100;

/** Default flush size threshold (10MB) */
const DEFAULT_FLUSH_SIZE = 10 * 1024 * 1024;

/**
 * Options for PackDeltaStore
 */
export interface PackDeltaStoreOptions {
  /** FilesApi for storage operations */
  files: FilesApi;
  /** Base path for pack files (e.g., ".git/objects/pack") */
  basePath: string;
  /** Flush threshold (number of objects, default: 100) */
  flushThreshold?: number;
  /** Flush size threshold (bytes, default: 10MB) */
  flushSize?: number;
}

/**
 * Native pack-based delta store
 *
 * Stores deltas using Git's native delta types (OFS_DELTA, REF_DELTA).
 * Delta relationships are embedded in pack file headers.
 *
 * Key differences from previous implementation:
 * - Uses OFS_DELTA when base is in same pack (more efficient)
 * - Uses REF_DELTA when base is in different pack
 * - No separate JSON metadata index
 * - Relationships read from pack headers
 *
 * @example
 * ```typescript
 * const store = new PackDeltaStore({ files, basePath: ".git/objects/pack" });
 * await store.initialize();
 *
 * // Store delta (written as OFS_DELTA or REF_DELTA)
 * await store.storeDelta(
 *   { baseKey: baseId, targetKey: targetId },
 *   deltaInstructions
 * );
 *
 * // Query uses pack headers, not separate index
 * const isDelta = await store.isDelta(targetId);
 * const base = await store.getDeltaBase(targetId);
 * ```
 */
export class PackDeltaStore implements DeltaStore {
  private readonly files: FilesApi;
  private readonly basePath: string;
  private readonly packDir: PackDirectory;
  private pending: PendingPack;
  private reverseIndex: DeltaReverseIndex | null = null;
  private initialized = false;

  constructor(options: PackDeltaStoreOptions) {
    this.files = options.files;
    this.basePath = options.basePath;

    this.packDir = new PackDirectory({
      files: options.files,
      basePath: options.basePath,
    });

    this.pending = new PendingPack({
      maxObjects: options.flushThreshold ?? DEFAULT_FLUSH_THRESHOLD,
      maxBytes: options.flushSize ?? DEFAULT_FLUSH_SIZE,
    });
  }

  /**
   * Initialize the store
   *
   * Scans existing pack files. No metadata file to load.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Scan for existing packs
    await this.packDir.scan();
    this.initialized = true;
  }

  /**
   * Store a delta relationship
   *
   * Stores as native OFS_DELTA or REF_DELTA depending on
   * whether the base is in the same pack.
   *
   * Based on: jgit PackWriter.java#writeObject
   *
   * @param info Delta relationship (baseKey, targetKey)
   * @param delta Delta instructions
   * @returns Compressed size in bytes
   */
  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number> {
    await this.ensureInitialized();

    // Serialize delta to Git binary format
    const binaryDelta = serializeDelta(delta);

    // Add as delta - PendingPack handles OFS vs REF automatically
    // (OFS if base already in pending, REF otherwise)
    this.pending.addDelta(info.targetKey, info.baseKey, binaryDelta);

    // Update reverse index if cached
    if (this.reverseIndex) {
      this.reverseIndex.add(info.targetKey, info.baseKey);
    }

    // Auto-flush if threshold reached
    if (this.pending.shouldFlush()) {
      await this.flush();
    }

    return binaryDelta.length;
  }

  /**
   * Load delta for an object
   *
   * Reads delta bytes from pack and parses to Delta[] instructions.
   *
   * @param targetKey Target object key
   * @returns Stored delta with instructions, or undefined if not a delta
   */
  async loadDelta(targetKey: string): Promise<StoredDelta | undefined> {
    await this.ensureInitialized();

    // Flush pending to ensure object is available
    if (this.pending.hasPending(targetKey)) {
      await this.flush();
    }

    // Check if it's a delta from pack header
    if (!(await this.packDir.isDelta(targetKey))) {
      return undefined;
    }

    // Get base from pack header
    const baseKey = await this.packDir.getDeltaBase(targetKey);
    if (!baseKey) return undefined;

    // Load raw delta bytes from pack
    const packName = await this.packDir.findPack(targetKey);
    if (!packName) return undefined;

    const reader = await this.packDir.getPack(packName);
    const rawDelta = await reader.loadRawDelta(targetKey);
    if (!rawDelta) return undefined;

    // Parse binary delta to Delta[]
    const delta = parseBinaryDelta(rawDelta);

    // Calculate ratio (would need original size for accurate ratio)
    const chainInfo = await this.packDir.getDeltaChainInfo(targetKey);
    const ratio = chainInfo ? rawDelta.length / (rawDelta.length + chainInfo.savings) : 0;

    return {
      baseKey,
      targetKey,
      delta,
      ratio,
    };
  }

  /**
   * Check if object is stored as delta
   *
   * Reads pack header - no separate index lookup.
   *
   * @param targetKey Target object key
   * @returns True if stored as delta
   */
  async isDelta(targetKey: string): Promise<boolean> {
    await this.ensureInitialized();

    // Check pending first
    if (this.pending.hasPending(targetKey)) {
      return this.pending.isDelta?.(targetKey) ?? false;
    }

    // Check reverse index if available (O(1))
    if (this.reverseIndex) {
      return this.reverseIndex.isDelta(targetKey);
    }

    // Fall back to pack header read
    return this.packDir.isDelta(targetKey);
  }

  /**
   * Remove delta relationship
   *
   * Pack files are immutable - actual removal happens during GC/repack.
   * This marks the relationship as removed in the reverse index.
   *
   * @param targetKey Target object key
   * @param _keepAsBase Ignored - pack-based deletion handled by GC
   * @returns True if was a delta
   */
  async removeDelta(targetKey: string, _keepAsBase?: boolean): Promise<boolean> {
    await this.ensureInitialized();

    const wasDelta = await this.isDelta(targetKey);

    // Update reverse index if cached
    if (this.reverseIndex && wasDelta) {
      this.reverseIndex.remove(targetKey);
    }

    return wasDelta;
  }

  /**
   * Get delta chain info for an object
   *
   * Walks delta chain from pack headers.
   *
   * @param targetKey Target object key
   * @returns Chain details or undefined if not a delta
   */
  async getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined> {
    await this.ensureInitialized();

    // Flush pending first
    if (this.pending.hasPending(targetKey)) {
      await this.flush();
    }

    const packInfo = await this.packDir.getDeltaChainInfo(targetKey);
    if (!packInfo) return undefined;

    // Build chain by walking from target to base
    const chain: string[] = [targetKey];
    let currentKey = targetKey;

    while (true) {
      const base = await this.packDir.getDeltaBase(currentKey);
      if (!base) break;
      chain.push(base);
      currentKey = base;
    }

    return {
      baseKey: packInfo.baseId,
      targetKey,
      depth: packInfo.depth,
      originalSize: 0, // Would need to load resolved object
      compressedSize: 0, // Would need pack entry size
      chain,
    };
  }

  /**
   * List all delta relationships
   *
   * Scans pack headers to find all deltas.
   * Uses reverse index if available for efficiency.
   *
   * @returns Async iterable of delta info
   */
  async *listDeltas(): AsyncIterable<DeltaInfo> {
    await this.ensureInitialized();

    // Flush pending first
    if (!this.pending.isEmpty()) {
      await this.flush();
    }

    // Use reverse index if available
    if (this.reverseIndex) {
      for (const { target, base } of this.reverseIndex.entries()) {
        yield { baseKey: base, targetKey: target };
      }
      return;
    }

    // Fall back to pack header scan
    for await (const { target, base } of this.packDir.listDeltaRelationships()) {
      yield { baseKey: base, targetKey: target };
    }
  }

  /**
   * Find all objects depending on a base
   *
   * Uses reverse index for O(1) lookup if available,
   * otherwise falls back to O(n) pack scan.
   *
   * @param baseKey Base object key
   * @returns Array of dependent target keys
   */
  async findDependents(baseKey: string): Promise<string[]> {
    await this.ensureInitialized();

    // Use reverse index if available
    if (this.reverseIndex) {
      return this.reverseIndex.getTargets(baseKey);
    }

    // Fall back to pack scan
    return this.packDir.findDependents(baseKey);
  }

  /**
   * Check if object is used as a delta base
   *
   * @param key Object key
   * @returns True if has dependents
   */
  async isBase(key: string): Promise<boolean> {
    const dependents = await this.findDependents(key);
    return dependents.length > 0;
  }

  /**
   * Build or rebuild the reverse index
   *
   * Call this for efficient repeated findDependents() queries.
   * Must be called after pack changes.
   */
  async buildReverseIndex(): Promise<void> {
    await this.ensureInitialized();
    this.reverseIndex = await this.packDir.buildReverseIndex();
  }

  /**
   * Invalidate cached reverse index
   *
   * Call after packs are added/removed externally.
   */
  invalidateReverseIndex(): void {
    this.reverseIndex = null;
  }

  /**
   * Flush pending objects to a new pack file
   */
  async flush(): Promise<void> {
    if (this.pending.isEmpty()) return;

    const result = await this.pending.flush();

    // Write pack files
    await this.packDir.addPack(result.packName, result.packData, result.indexData);

    // Invalidate pack directory cache
    await this.packDir.invalidate();
  }

  /**
   * Close the store
   */
  async close(): Promise<void> {
    await this.flush();
    await this.packDir.invalidate();
    this.reverseIndex = null;
  }

  /**
   * Get pack directory for advanced operations
   */
  getPackDirectory(): PackDirectory {
    return this.packDir;
  }

  /**
   * Get reverse index (may be null if not built)
   */
  getReverseIndex(): DeltaReverseIndex | null {
    return this.reverseIndex;
  }

  /**
   * Ensure store is initialized
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }
  }
}
```

---

### Step 5: Update PendingPack with isDelta Method

Add method to check if pending object is a delta.

**File:** `packages/core/src/pack/pending-pack.ts`

**Changes:**

```typescript
export class PendingPack {
  // ... existing methods ...

  /**
   * Check if a pending object is a delta
   *
   * @param id Object ID
   * @returns True if pending as delta, false if full or not found
   */
  isDelta(id: ObjectId): boolean {
    const entry = this.entries.find((e) => e.id === id);
    return entry?.type === "delta";
  }

  /**
   * Get base key for a pending delta
   *
   * @param id Object ID
   * @returns Base object ID or undefined
   */
  getDeltaBase(id: ObjectId): ObjectId | undefined {
    const entry = this.entries.find((e) => e.id === id && e.type === "delta");
    if (entry && entry.type === "delta") {
      return entry.baseId;
    }
    return undefined;
  }
}
```

---

### Step 6: Update Exports

**File:** `packages/core/src/pack/index.ts`

```typescript
export * from "./pack-directory.js";
export * from "./pack-reader.js";
export * from "./pack-writer.js";
export * from "./pack-index-reader.js";
export * from "./pack-index-writer.js";
export * from "./pending-pack.js";
export * from "./pack-consolidator.js";
export * from "./delta-reverse-index.js";  // NEW
export * from "./pack-delta-store.js";     // MOVED HERE from delta/
export * from "./types.js";
```

**File:** `packages/core/src/delta/index.ts`

```typescript
export * from "./delta-binary-format.js";
export * from "./delta-store.js";
export * from "./gc-controller.js";
export * from "./packing-orchestrator.js";
export * from "./raw-store-with-delta.js";
export * from "./storage-analyzer.js";
export * from "./strategies/index.js";
export * from "./types.js";

// Re-export PackDeltaStore from pack/ for backwards compatibility
// Consumers should eventually import from pack/ directly
export { PackDeltaStore, type PackDeltaStoreOptions } from "../pack/pack-delta-store.js";
```

---

### Step 7: Remove DeltaMetadataIndex and Old PackDeltaStore

**Files to delete:**
- `packages/core/src/delta/delta-metadata-index.ts`
- `packages/core/src/delta/pack-delta-store.ts` (old location)
- `packages/core/tests/delta/delta-metadata-index.test.ts`

**Files to move:**
- `packages/core/tests/delta/pack-delta-store.test.ts` → `packages/core/tests/pack/pack-delta-store.test.ts`

---

### Step 8: Update Tests

**File:** `packages/core/tests/delta/pack-delta-store.test.ts`

Update tests to work with new implementation. The interface is unchanged,
so most tests should work. Key changes:

1. Remove tests for `getMetadataIndex()`
2. Add tests for `buildReverseIndex()` and `findDependents()`
3. Update any tests that relied on JSON metadata file

```typescript
describe("PackDeltaStore", () => {
  // ... existing tests remain largely unchanged ...

  describe("reverse index", () => {
    it("builds reverse index from pack headers", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const target1 = "1".repeat(40);
      const target2 = "2".repeat(40);

      await store.storeDelta({ baseKey, targetKey: target1 }, createSimpleDelta(100));
      await store.storeDelta({ baseKey, targetKey: target2 }, createSimpleDelta(100));

      await store.buildReverseIndex();

      const dependents = await store.findDependents(baseKey);
      expect(dependents).toContain(target1);
      expect(dependents).toContain(target2);
      expect(dependents).toHaveLength(2);

      await store.close();
    });

    it("finds dependents without building reverse index (slower)", async () => {
      const store = new PackDeltaStore({ files, basePath, flushThreshold: 1 });
      await store.initialize();

      const baseKey = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      const targetKey = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

      await store.storeDelta({ baseKey, targetKey }, createSimpleDelta(100));

      // Don't build reverse index - should still work via pack scan
      const dependents = await store.findDependents(baseKey);
      expect(dependents).toContain(targetKey);

      await store.close();
    });
  });
});
```

---

## Implementation Order

The changes can be implemented incrementally with the following order:

### Phase 1: Infrastructure (Non-Breaking)

1. **Step 2**: Make PackReader methods public
2. **Step 3**: Add DeltaReverseIndex (new file in pack/)
3. **Step 5**: Add isDelta/getDeltaBase to PendingPack
4. **Step 1**: Add delta methods to PackDirectory
5. **Step 6**: Update pack/ exports (add delta-reverse-index)

**Verification:** All existing tests pass

### Phase 2: Create New Implementation in pack/

6. **Step 4**: Create new PackDeltaStore in `pack/pack-delta-store.ts`
7. **Step 6**: Update pack/ exports (add pack-delta-store)
8. **Step 8**: Move and update PackDeltaStore tests to `tests/pack/`

**Verification:** New PackDeltaStore tests pass

### Phase 3: Switch and Cleanup

9. **Step 6**: Update delta/ exports (re-export from pack/, remove old export)
10. **Step 7**: Delete old files:
    - `delta/pack-delta-store.ts`
    - `delta/delta-metadata-index.ts`
    - `tests/delta/delta-metadata-index.test.ts`

**Verification:** All tests pass, no references to deleted files

### Alternative: Direct Replacement (Single Phase)

Since the interface is unchanged, all steps can be done in a single commit:

1. Create new `pack/pack-delta-store.ts` with new implementation
2. Create new `pack/delta-reverse-index.ts`
3. Update `pack/pack-directory.ts` with delta methods
4. Update `pack/pack-reader.ts` (make methods public)
5. Update `pack/pending-pack.ts` (add isDelta)
6. Update `pack/index.ts` exports
7. Update `delta/index.ts` exports (re-export from pack/)
8. Move tests from `tests/delta/` to `tests/pack/`
9. Delete old files

**Recommended:** Use direct replacement since the DeltaStore interface is unchanged.

---

## Migration Notes

### Direct Replacement Strategy

Since the new `PackDeltaStore` implements the same `DeltaStore` interface, it can be a **direct replacement**:

- Same constructor signature (files, basePath, thresholds)
- Same interface methods (storeDelta, loadDelta, isDelta, etc.)
- Same lifecycle methods (initialize, close, flush)

### Breaking Changes

The following methods are **removed**:

| Old Method | Replacement |
|------------|-------------|
| `getMetadataIndex()` | Use `getReverseIndex()` after `buildReverseIndex()` |

### New Methods

| Method | Purpose |
|--------|---------|
| `findDependents(baseKey)` | Get all targets depending on base |
| `isBase(key)` | Check if object has dependents |
| `buildReverseIndex()` | Build in-memory reverse index |
| `invalidateReverseIndex()` | Clear cached reverse index |
| `getReverseIndex()` | Access reverse index (may be null) |

---

## Verification Checklist

- [ ] Step 1: PackDirectory delta methods work
- [ ] Step 2: PackReader public methods accessible
- [ ] Step 3: DeltaReverseIndex builds correctly
- [ ] Step 4: New PackDeltaStore in pack/ stores as OFS_DELTA/REF_DELTA
- [ ] Step 5: PendingPack.isDelta works
- [ ] Step 6: Exports updated (pack/ exports, delta/ re-exports)
- [ ] Step 7: Old files removed (delta-metadata-index.ts, old pack-delta-store.ts)
- [ ] Step 8: All tests pass in new location (tests/pack/)

```bash
pnpm test
pnpm lint:fix
pnpm format:fix
```

---

## Files Summary

### New Files (pack/)
| File | Description |
|------|-------------|
| `pack/pack-delta-store.ts` | DeltaStore implementation (moved from delta/) |
| `pack/delta-reverse-index.ts` | In-memory reverse index |

### Modified Files
| File | Changes |
|------|---------|
| `pack/pack-directory.ts` | Add delta query methods |
| `pack/pack-reader.ts` | Make readObjectHeader, findObjectIdByOffset public; add loadRawDelta |
| `pack/pending-pack.ts` | Add isDelta, getDeltaBase methods |
| `pack/index.ts` | Export new files |
| `delta/index.ts` | Remove old exports, re-export from pack/ |

### Deleted Files
| File | Reason |
|------|--------|
| `delta/pack-delta-store.ts` | Moved to pack/ |
| `delta/delta-metadata-index.ts` | Replaced by DeltaReverseIndex |

### Moved Tests
| From | To |
|------|-----|
| `tests/delta/pack-delta-store.test.ts` | `tests/pack/pack-delta-store.test.ts` |
| `tests/delta/delta-metadata-index.test.ts` | (deleted) |

---

## Success Criteria

1. Deltas stored as `OFS_DELTA` (type 6) or `REF_DELTA` (type 7), not BLOB
2. No separate JSON metadata file required
3. `findDependents()` works with O(1) performance after `buildReverseIndex()`
4. Git tools can inspect delta relationships in pack files
5. All existing PackDeltaStore tests pass
6. DeltaMetadataIndex completely removed
7. PackDeltaStore located in `pack/` (Git-specific layer)
8. `delta/` contains only abstract interfaces and algorithms

---

## Future Work: Git-Compatible PackReverseIndex

The current plan implements `DeltaReverseIndex` for base→targets mapping (delta dependency tracking).
A separate future task could implement Git-compatible `PackReverseIndex` for offset→position mapping.

### When PackReverseIndex Would Be Needed

- Streaming pack contents in offset order
- Pack verification operations
- Pack-to-pack copying without full decompression
- Compatibility with `git verify-pack -v`

### Implementation Approach

```typescript
/**
 * Git-compatible reverse index (offset→position)
 *
 * Implements Git's .rev file format:
 * - RIDX magic (4 bytes)
 * - Version (4 bytes, network order)
 * - Hash algorithm ID (4 bytes)
 * - Index positions sorted by pack offset (4 bytes each)
 * - Pack checksum (20 bytes)
 * - Index checksum (20 bytes)
 *
 * See: jgit PackReverseIndexV1
 */
export class PackReverseIndex {
  static readonly MAGIC = new Uint8Array([0x52, 0x49, 0x44, 0x58]); // 'RIDX'
  static readonly VERSION = 1;

  /** Find object ID at given pack offset */
  findObject(offset: number): ObjectId | null;

  /** Find next object offset (for iteration) */
  findNextOffset(offset: number, maxOffset: number): number;

  /** Find position in offset order */
  findPosition(offset: number): number;

  /** Find object by position in offset order */
  findObjectByPosition(position: number): ObjectId;

  /** Serialize to .rev file format */
  serialize(): Uint8Array;

  /** Parse from .rev file */
  static parse(data: Uint8Array, packIndex: PackIndex): PackReverseIndex;

  /** Compute from forward index (like JGit PackReverseIndexComputed) */
  static compute(packIndex: PackIndex): PackReverseIndex;
}
```

This is orthogonal to the current plan and can be implemented independently when needed.
