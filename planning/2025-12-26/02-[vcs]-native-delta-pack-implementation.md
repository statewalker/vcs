# Native Delta Pack Implementation Plan

This plan describes how to implement an ideal `DeltaStore` that uses Git's native pack delta types (OFS_DELTA, REF_DELTA) instead of storing serialized deltas as BLOBs with separate metadata tracking.

## Goals

1. Write deltas as OFS_DELTA when base is in same pack (space-efficient)
2. Write deltas as REF_DELTA when base is in different pack or loose
3. Use pack reader's native delta resolution instead of separate chain tracking
4. Maintain reverse index for finding dependents (required for safe deletion)
5. Support thin packs for network transfer (REF_DELTA with external bases)

## Current State Analysis

### What Works Well

The existing infrastructure has strong foundations:

**PackWriterStream** ([pack-writer.ts:193-399](packages/core/src/pack/pack-writer.ts#L193-L399)) already supports native delta types with `addOfsDelta()` and `addRefDelta()` methods. It tracks object offsets via `objectOffsets` map for OFS_DELTA references.

**PackReader** ([pack-reader.ts:140-198](packages/core/src/pack/pack-reader.ts#L140-L198)) natively resolves delta chains for both OFS_DELTA and REF_DELTA, recursively loading bases and applying delta instructions.

**PendingPack** ([pending-pack.ts:187-199](packages/core/src/pack/pending-pack.ts#L187-L199)) already chooses between OFS_DELTA and REF_DELTA based on whether the base is in the current pack being written.

### Current Limitations

**PackDeltaStore** ([pack-delta-store.ts:91-132](packages/core/src/delta/pack-delta-store.ts#L91-L132)) stores deltas as BLOBs:
```typescript
// Current approach - stores as BLOB
this.pending.addObject(info.targetKey, PackObjectType.BLOB, binaryDelta);
```

This means:
- Pack files don't natively represent delta relationships
- Requires separate `DeltaMetadataIndex` to track base → target mappings
- Can't use `PackReader.isDelta()` or `PackReader.getDeltaChainInfo()` directly
- Pack files aren't compatible with Git tools for inspection

## Proposed Architecture

### Unified Object Store

Replace the dual-store architecture (RawStore + DeltaStore) with a single unified store that handles both full objects and deltas transparently:

```
┌─────────────────────────────────────────────────────────────────┐
│                      UnifiedObjectStore                          │
│  Single store for all objects (full and deltified)              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    PackDirectory                          │   │
│  │   (stores full objects + OFS_DELTA + REF_DELTA)          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                    ┌─────────┴─────────┐                        │
│                    │                   │                        │
│          ┌─────────▼───────┐  ┌───────▼─────────┐              │
│          │  ReverseIndex   │  │   LooseObjects   │              │
│          │ (base→targets)  │  │   (non-packed)   │              │
│          └─────────────────┘  └─────────────────┘              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### New Components

**ReverseIndex** - Maps base objects to their dependents:
```typescript
interface ReverseIndex {
  // Add a delta relationship
  addDelta(targetId: ObjectId, baseId: ObjectId): void;

  // Remove a delta relationship
  removeDelta(targetId: ObjectId): void;

  // Find all objects that depend on this base
  getDependents(baseId: ObjectId): ObjectId[];

  // Check if an object is used as a base
  isBase(objectId: ObjectId): boolean;

  // Persistence
  save(): Promise<void>;
  load(): Promise<void>;
}
```

**NativeDeltaStore** - Stores deltas using native pack types:
```typescript
interface NativeDeltaStore {
  // Store delta using native pack format
  storeDelta(
    targetId: ObjectId,
    baseId: ObjectId,
    deltaContent: Uint8Array,  // Git binary delta format
    targetType: PackObjectType
  ): Promise<void>;

  // Load resolved content (handles delta chain internally)
  load(objectId: ObjectId): Promise<Uint8Array>;

  // Get raw delta info from pack
  getDeltaInfo(objectId: ObjectId): Promise<DeltaInfo | undefined>;

  // Check if object is stored as delta
  isDelta(objectId: ObjectId): Promise<boolean>;
}
```

## Implementation Steps

### Phase 1: Reverse Index Implementation

Create a new `ReverseIndex` class that tracks which objects depend on which bases.

**File:** `packages/core/src/delta/reverse-index.ts`

```typescript
/**
 * Reverse index for delta relationships
 *
 * Maps base objects to their dependent delta objects.
 * Required for safe deletion - can't delete an object that's used as a base.
 */
export class ReverseIndex {
  private baseToTargets: Map<ObjectId, Set<ObjectId>> = new Map();
  private targetToBase: Map<ObjectId, ObjectId> = new Map();

  /**
   * Record a delta relationship
   */
  addDelta(targetId: ObjectId, baseId: ObjectId): void {
    // Track base → targets
    let targets = this.baseToTargets.get(baseId);
    if (!targets) {
      targets = new Set();
      this.baseToTargets.set(baseId, targets);
    }
    targets.add(targetId);

    // Track target → base for removal
    this.targetToBase.set(targetId, baseId);
  }

  /**
   * Remove a delta relationship
   */
  removeDelta(targetId: ObjectId): void {
    const baseId = this.targetToBase.get(targetId);
    if (baseId) {
      const targets = this.baseToTargets.get(baseId);
      if (targets) {
        targets.delete(targetId);
        if (targets.size === 0) {
          this.baseToTargets.delete(baseId);
        }
      }
      this.targetToBase.delete(targetId);
    }
  }

  /**
   * Get all objects that depend on a base
   */
  getDependents(baseId: ObjectId): ObjectId[] {
    const targets = this.baseToTargets.get(baseId);
    return targets ? [...targets] : [];
  }

  /**
   * Check if object is used as a delta base
   */
  isBase(objectId: ObjectId): boolean {
    const targets = this.baseToTargets.get(objectId);
    return targets !== undefined && targets.size > 0;
  }

  /**
   * Get the base for a delta object
   */
  getBase(targetId: ObjectId): ObjectId | undefined {
    return this.targetToBase.get(targetId);
  }
}
```

**Persistence format:**
```json
{
  "version": 1,
  "relationships": [
    { "target": "abc123...", "base": "def456..." },
    { "target": "ghi789...", "base": "def456..." }
  ]
}
```

### Phase 2: Native Delta Pack Store

Create `NativeDeltaPackStore` that writes deltas using proper pack types.

**File:** `packages/core/src/delta/native-delta-pack-store.ts`

Key changes from current `PackDeltaStore`:

**Storing deltas:**
```typescript
async storeDelta(
  targetId: ObjectId,
  baseId: ObjectId,
  delta: Uint8Array,
  targetType: PackObjectType
): Promise<void> {
  // Update reverse index
  this.reverseIndex.addDelta(targetId, baseId);

  // Add to pending pack as delta (not BLOB)
  this.pending.addDelta(targetId, baseId, delta);

  if (this.pending.shouldFlush()) {
    await this.flush();
  }
}
```

The key difference is using `addDelta()` instead of `addObject()` with BLOB type. PendingPack already handles the OFS_DELTA vs REF_DELTA decision.

**Loading objects:**
```typescript
async load(objectId: ObjectId): Promise<Uint8Array | undefined> {
  // PackReader.get() handles delta resolution natively
  const obj = await this.packDir.load(objectId);
  return obj?.content;
}
```

No need for separate chain resolution - `PackReader.load()` at [pack-reader.ts:140-198](packages/core/src/pack/pack-reader.ts#L140-L198) already does this.

**Checking delta status:**
```typescript
async isDelta(objectId: ObjectId): Promise<boolean> {
  // Use pack reader's native check
  const pack = await this.packDir.findPack(objectId);
  if (!pack) return false;
  return pack.reader.isDelta(objectId);
}
```

Uses `PackReader.isDelta()` at [pack-reader.ts:206-212](packages/core/src/pack/pack-reader.ts#L206-L212).

**Getting delta chain info:**
```typescript
async getDeltaChainInfo(objectId: ObjectId): Promise<PackDeltaChainInfo | undefined> {
  const pack = await this.packDir.findPack(objectId);
  if (!pack) return undefined;
  return pack.reader.getDeltaChainInfo(objectId);
}
```

Uses `PackReader.getDeltaChainInfo()` at [pack-reader.ts:222-276](packages/core/src/pack/pack-reader.ts#L222-L276).

### Phase 3: Update PendingPack for Base Ordering

Current `PendingPack.flush()` writes full objects first, then deltas. This works but could be improved.

**Enhancement:** Order objects to maximize OFS_DELTA usage by ensuring bases are written before their deltas.

```typescript
async flush(): Promise<FlushResult> {
  // Build dependency graph
  const graph = this.buildDependencyGraph();

  // Topological sort: bases before deltas
  const sortedEntries = this.topologicalSort(graph);

  const writer = new PackWriterStream();

  for (const entry of sortedEntries) {
    if (entry.type === "full") {
      await writer.addObject(entry.id, entry.objectType, entry.content);
    } else {
      // Base should already be written, use OFS_DELTA
      const baseOffset = writer.getObjectOffset(entry.baseId);
      if (baseOffset !== undefined) {
        await writer.addOfsDelta(entry.id, entry.baseId, entry.delta);
      } else {
        // Fallback to REF_DELTA if base is external
        await writer.addRefDelta(entry.id, entry.baseId, entry.delta);
      }
    }
  }

  // ... finalize
}

private buildDependencyGraph(): Map<ObjectId, ObjectId[]> {
  const graph = new Map<ObjectId, ObjectId[]>();

  for (const entry of this.entries) {
    if (entry.type === "delta") {
      const deps = graph.get(entry.id) || [];
      deps.push(entry.baseId);
      graph.set(entry.id, deps);
    }
  }

  return graph;
}
```

### Phase 4: Thin Pack Support

Thin packs contain REF_DELTA objects whose bases are not included in the pack. They're used for network transfer when the receiver already has the base objects.

**File:** `packages/core/src/pack/thin-pack-writer.ts`

```typescript
/**
 * Creates thin packs for network transfer
 *
 * A thin pack contains only the objects the receiver needs,
 * with REF_DELTA references to objects the receiver already has.
 */
export class ThinPackWriter {
  private readonly haveSet: Set<ObjectId>;

  constructor(haveObjects: ObjectId[]) {
    this.haveSet = new Set(haveObjects);
  }

  /**
   * Check if receiver has an object
   */
  receiverHas(objectId: ObjectId): boolean {
    return this.haveSet.has(objectId);
  }

  /**
   * Write thin pack with objects receiver needs
   */
  async writeThinPack(
    wantObjects: ObjectId[],
    objectStore: NativeDeltaPackStore
  ): Promise<PackWriterResult> {
    const writer = new PackWriterStream();
    const included = new Set<ObjectId>();

    for (const objectId of wantObjects) {
      await this.writeObject(objectId, writer, objectStore, included);
    }

    return writer.finalize();
  }

  private async writeObject(
    objectId: ObjectId,
    writer: PackWriterStream,
    store: NativeDeltaPackStore,
    included: Set<ObjectId>
  ): Promise<void> {
    if (included.has(objectId) || this.receiverHas(objectId)) {
      return;
    }

    const deltaInfo = await store.getDeltaInfo(objectId);

    if (deltaInfo && this.receiverHas(deltaInfo.baseId)) {
      // Receiver has base - send as REF_DELTA
      const delta = await store.loadRawDelta(objectId);
      await writer.addRefDelta(objectId, deltaInfo.baseId, delta);
    } else if (deltaInfo) {
      // Receiver doesn't have base - include base first
      await this.writeObject(deltaInfo.baseId, writer, store, included);

      // Now write as OFS_DELTA if base was just written
      const baseOffset = writer.getObjectOffset(deltaInfo.baseId);
      const delta = await store.loadRawDelta(objectId);

      if (baseOffset !== undefined) {
        await writer.addOfsDelta(objectId, deltaInfo.baseId, delta);
      } else {
        await writer.addRefDelta(objectId, deltaInfo.baseId, delta);
      }
    } else {
      // Full object
      const content = await store.load(objectId);
      const type = await store.getType(objectId);
      await writer.addObject(objectId, type, content);
    }

    included.add(objectId);
  }
}
```

### Phase 5: Index Pack for Thin Packs

When receiving a thin pack, bases must be resolved from existing storage.

**File:** `packages/core/src/pack/thin-pack-indexer.ts`

```typescript
/**
 * Indexes thin packs by resolving external bases
 */
export class ThinPackIndexer {
  constructor(
    private readonly objectResolver: (id: ObjectId) => Promise<Uint8Array | undefined>
  ) {}

  /**
   * Index a thin pack, resolving external REF_DELTA bases
   */
  async indexThinPack(packData: Uint8Array): Promise<IndexPackResult> {
    const header = parsePackHeader(packData);
    const entries: IndexEntry[] = [];

    let offset = 12; // After header

    for (let i = 0; i < header.objectCount; i++) {
      const objHeader = parseObjectHeader(packData, offset);

      if (objHeader.type === PackObjectType.REF_DELTA) {
        // External base - resolve from existing storage
        const baseId = objHeader.baseId!;
        const baseContent = await this.objectResolver(baseId);

        if (!baseContent) {
          throw new Error(`Missing base object: ${baseId}`);
        }

        // Decompress delta and apply
        const delta = await decompressAt(packData, offset + objHeader.headerLength);
        const resolved = applyDelta(baseContent, delta);

        // Compute object ID from resolved content
        const objectId = await computeObjectId(objHeader.resolvedType, resolved);

        entries.push({
          id: objectId,
          offset,
          crc32: computeCrc32(packData, offset, objHeader.totalLength)
        });
      } else {
        // Normal object or OFS_DELTA (base in same pack)
        // ... standard indexing
      }

      offset += objHeader.totalLength;
    }

    return { entries };
  }
}
```

### Phase 6: Remove DeltaMetadataIndex Dependency

With native delta storage, `DeltaMetadataIndex` is no longer needed for core operations. It can be replaced by:

1. **ReverseIndex** - For finding dependents (base → targets)
2. **PackReader.getDeltaChainInfo()** - For chain depth and base info
3. **PackReader.isDelta()** - For delta detection

The metadata index can be removed or repurposed for:
- Caching chain depth to avoid repeated pack reads
- Statistics and reporting
- GC decision-making

### Phase 7: Update RawStoreWithDelta

Simplify `RawStoreWithDelta` to use native pack resolution:

```typescript
// getDeltaChainInfo
// deltify 
// isDelta 
// undeltify

class RawStoreWithDelta implements RawStore {
  constructor(private readonly store: NativeDeltaPackStore) {}

  async load(id: ObjectId): Promise<AsyncIterable<Uint8Array>> {
    // Native resolution handles deltas transparently
    const content = await this.store.load(id);
    if (!content) throw new ObjectNotFoundError(id);
    return singleChunk(content);
  }

  async size(id: ObjectId): Promise<number> {
    // For deltas, this returns resolved size
    const content = await this.store.load(id);
    return content?.length ?? 0;
  }

  async deltify(targetId: ObjectId, candidateIds: ObjectId[]): Promise<boolean> {
    // Find best base and store as native delta
    const target = await this.store.load(targetId);

    for (const baseId of candidateIds) {
      const base = await this.store.load(baseId);
      const delta = computeDelta(base, target);

      if (isWorthDeltifying(delta, target)) {
        const binaryDelta = serializeGitDelta(delta);
        await this.store.storeDelta(targetId, baseId, binaryDelta, type);
        return true;
      }
    }

    return false;
  }
}
```

## Migration Path

### Step 1: Parallel Implementation

Implement `NativeDeltaPackStore` alongside existing `PackDeltaStore`. Both can coexist during transition.

### Step 2: Feature Flag

Add configuration to choose between implementations:
```typescript
interface StorageOptions {
  deltaFormat: 'legacy' | 'native';
}
```

### Step 3: Migration Tool

Create utility to migrate existing packs:
```typescript
async function migrateToNativeDelta(
  legacyStore: PackDeltaStore,
  nativeStore: NativeDeltaPackStore
): Promise<void> {
  for await (const { targetKey, baseKey, delta } of legacyStore.listDeltas()) {
    const binaryDelta = serializeDelta(delta);
    await nativeStore.storeDelta(targetKey, baseKey, binaryDelta, type);
  }
}
```

### Step 4: Deprecate Legacy

Once migration is complete:
1. Remove `PackDeltaStore`
2. Remove `DeltaMetadataIndex` (or repurpose for caching)
3. Update all callers to use native store

## Testing Strategy

### Unit Tests

1. **ReverseIndex tests**
   - Add/remove relationships
   - Find dependents
   - Persistence round-trip

2. **NativeDeltaPackStore tests**
   - Store and load deltas
   - OFS_DELTA vs REF_DELTA selection
   - Chain resolution

3. **ThinPackWriter tests**
   - Correct REF_DELTA for known bases
   - OFS_DELTA for included bases
   - Complete object graph

4. **ThinPackIndexer tests**
   - Resolve external bases
   - Handle missing bases gracefully

### Integration Tests

1. **End-to-end delta compression**
   - Create objects, deltify, load
   - Verify resolved content matches original

2. **GC with native deltas**
   - Pack objects with native deltas
   - Consolidate packs
   - Break deep chains

3. **Network transfer simulation**
   - Create thin pack
   - Index on "receiver" side
   - Verify complete resolution

### Compatibility Tests

1. **Git interoperability**
   - Write pack with native deltas
   - Verify `git verify-pack` accepts it
   - Verify `git index-pack` works

## File Changes Summary

### New Files

- `packages/core/src/delta/reverse-index.ts` - Reverse index implementation
- `packages/core/src/delta/native-delta-pack-store.ts` - Native delta store
- `packages/core/src/pack/thin-pack-writer.ts` - Thin pack creation
- `packages/core/src/pack/thin-pack-indexer.ts` - Thin pack indexing

### Modified Files

- `packages/core/src/pack/pending-pack.ts` - Topological sorting for base ordering
- `packages/core/src/delta/raw-store-with-delta.ts` - Simplified to use native resolution
- `packages/core/src/delta/gc-controller.ts` - Update for native delta store
- `packages/core/src/delta/packing-orchestrator.ts` - Update for native delta store

### Deprecated Files (Phase 4)

- `packages/core/src/delta/pack-delta-store.ts` - Replaced by native store
- `packages/core/src/delta/delta-metadata-index.ts` - No longer needed for core ops

## Benefits

### Space Efficiency

OFS_DELTA saves ~20 bytes per delta compared to REF_DELTA (offset varint vs 20-byte SHA-1). For a repository with 10,000 deltas where 80% can use OFS_DELTA:

```
Savings = 8,000 deltas × 16 bytes = 128 KB
```

### Performance

Native delta resolution in PackReader is optimized:
- Single pass through pack file
- No JSON parsing for metadata
- Direct offset-based lookups for OFS_DELTA

### Git Compatibility

Packs are fully compatible with Git tools:
- `git verify-pack -v` shows delta relationships
- `git index-pack` works correctly
- `git fsck` validates pack integrity

### Simplified Architecture

Removes dual-path logic (is it a delta? check metadata index vs pack):
- Single source of truth (pack files)
- Fewer moving parts
- Easier debugging

## Risks and Mitigations

### Risk: Migration Complexity

**Mitigation:** Parallel implementation with feature flag allows gradual rollout. Migration tool handles conversion.

### Risk: ReverseIndex Performance

For large repositories, scanning all deltas to find dependents could be slow.

**Mitigation:** ReverseIndex is in-memory with optional persistence. Load on startup, update incrementally.

### Risk: Thin Pack Base Resolution

Missing bases during thin pack indexing causes failures.

**Mitigation:** Validate bases exist before sending thin pack. Include full objects for missing bases.

## Conclusion

This plan provides a clear path to native delta storage that:

1. Uses Git's efficient OFS_DELTA/REF_DELTA types
2. Leverages existing PackReader delta resolution
3. Maintains reverse index for safe deletion
4. Supports thin packs for network transfer
5. Produces Git-compatible pack files

The phased approach allows incremental implementation with parallel operation during transition.
