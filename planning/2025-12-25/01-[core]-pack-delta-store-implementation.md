# Pack-Based DeltaStore Implementation Plan

## Overview

This plan implements a `PackDeltaStore` class that fulfills the `DeltaStore` interface using Git pack files for persistent delta storage. The implementation bridges the logical delta layer (`packages/core/src/delta/`) with the physical pack layer (`packages/core/src/pack/`).

## Goals

1. Provide persistent delta storage using Git pack file format
2. Maintain compatibility with standard Git tools (`git verify-pack`, `git unpack-objects`)
3. Support efficient multi-pack queries with caching
4. Enable pack consolidation during garbage collection
5. Keep the implementation modular and testable

## Dependencies

**Existing code to leverage:**
- [pack/pack-writer.ts](packages/core/src/pack/pack-writer.ts) - Pack file writing
- [pack/pack-reader.ts](packages/core/src/pack/pack-reader.ts) - Pack file reading with delta resolution
- [pack/pack-index-writer.ts](packages/core/src/pack/pack-index-writer.ts) - V2 index writing
- [pack/pack-index-reader.ts](packages/core/src/pack/pack-index-reader.ts) - V2 index reading
- [pack/pack-indexer.ts](packages/core/src/pack/pack-indexer.ts) - Index generation from pack data
- [delta/delta-store.ts](packages/core/src/delta/delta-store.ts) - DeltaStore interface
- [files/index.ts](packages/core/src/files/index.ts) - FilesApi for storage operations

**JGit references:**
- [PackDirectory.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/PackDirectory.java) - Pack enumeration and caching
- [DeltaEncoder.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/pack/DeltaEncoder.java) - Delta serialization
- [BinaryDelta.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/pack/BinaryDelta.java) - Delta parsing
- [GC.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/internal/storage/file/GC.java) - Pack consolidation

## Implementation Phases

### Phase 1: Core Infrastructure

**Duration estimate:** Foundation work

**Deliverables:**
1. `PackDirectory` class - manages multiple pack files
2. `DeltaMetadataIndex` class - tracks delta relationships
3. Basic file layout and path utilities

#### 1.1 PackDirectory Implementation

**File:** `packages/core/src/pack/pack-directory.ts`

```typescript
export interface PackDirectoryOptions {
  /** FilesApi instance for storage operations */
  files: FilesApi;
  /** Base path for pack files (e.g., ".git/objects/pack") */
  basePath: string;
  /** Maximum cached pack readers (default: 10) */
  maxCachedPacks?: number;
}

export class PackDirectory {
  private readonly files: FilesApi;
  private readonly basePath: string;
  private readonly cache: Map<string, { reader: PackReader; index: PackIndex }>;
  private packNames: string[] | null = null;

  constructor(options: PackDirectoryOptions);

  /** Scan directory for pack files */
  async scan(): Promise<string[]>;

  /** Get pack reader by name, using cache */
  async getPack(name: string): Promise<PackReader>;

  /** Get pack index by name, using cache */
  async getIndex(name: string): Promise<PackIndex>;

  /** Find which pack contains an object */
  async findPack(id: ObjectId): Promise<string | undefined>;

  /** Check if object exists in any pack */
  async has(id: ObjectId): Promise<boolean>;

  /** Load object from any pack */
  async load(id: ObjectId): Promise<Uint8Array | undefined>;

  /** Add a new pack file pair */
  async addPack(name: string, packData: Uint8Array, indexData: Uint8Array): Promise<void>;

  /** Remove a pack file pair */
  async removePack(name: string): Promise<void>;

  /** Invalidate cache (call after GC) */
  invalidate(): void;

  /** List all object IDs across all packs */
  async *listObjects(): AsyncIterable<ObjectId>;
}
```

**Key implementation details:**
- Use LRU cache for PackReader instances (memory management)
- Query packs in reverse alphabetical order (newer packs first by convention)
- Handle concurrent access with atomic file operations
- Validate pack/index pairs exist together

#### 1.2 DeltaMetadataIndex Implementation

**File:** `packages/core/src/delta/delta-metadata-index.ts`

```typescript
export interface DeltaMetadata {
  baseKey: string;
  packName: string;
  offset: number;
  depth: number;
  compressedSize: number;
  originalSize: number;
}

export interface DeltaMetadataIndexOptions {
  files: FilesApi;
  basePath: string;
  autoSave?: boolean;
  saveDebounceMs?: number;
}

export class DeltaMetadataIndex {
  private entries: Map<string, DeltaMetadata>;
  private dirty: boolean = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: DeltaMetadataIndexOptions);

  /** Check if object is stored as delta */
  isDelta(targetKey: string): boolean;

  /** Get metadata for target */
  getMetadata(targetKey: string): DeltaMetadata | undefined;

  /** Add or update entry */
  setEntry(targetKey: string, metadata: DeltaMetadata): void;

  /** Remove entry */
  removeEntry(targetKey: string): void;

  /** Iterate all entries */
  entries(): IterableIterator<[string, DeltaMetadata]>;

  /** Persist to storage */
  async save(): Promise<void>;

  /** Load from storage */
  async load(): Promise<void>;

  /** Rebuild from pack files */
  async rebuild(packDir: PackDirectory): Promise<void>;
}
```

**Storage format (JSON):**
```json
{
  "version": 1,
  "entries": {
    "abc123...": {
      "baseKey": "def456...",
      "packName": "pack-xyz789",
      "offset": 1234,
      "depth": 2,
      "compressedSize": 567,
      "originalSize": 2048
    }
  }
}
```

### Phase 2: Delta Format Conversion

**Duration estimate:** Algorithm work

**Deliverables:**
1. `serializeDelta()` function - Delta[] to Git binary
2. `parseBinaryDelta()` function - Git binary to Delta[]
3. Utility functions for varint encoding

#### 2.1 Delta Serialization

**File:** `packages/core/src/delta/delta-binary-format.ts`

```typescript
import type { Delta } from "@statewalker/vcs-utils";

/**
 * Serialize Delta[] instructions to Git binary delta format
 *
 * Git delta format:
 * - Header: base_size (varint) + result_size (varint)
 * - Instructions:
 *   - COPY: 0x80 | flags, followed by offset/size bytes
 *   - INSERT: 1-127 (length), followed by literal bytes
 */
export function serializeDelta(delta: Delta[]): Uint8Array;

/**
 * Parse Git binary delta format to Delta[] instructions
 */
export function parseBinaryDelta(data: Uint8Array): Delta[];

/**
 * Encode copy instruction following Git pack format
 *
 * @see JGit DeltaEncoder.encodeCopy()
 */
export function encodeCopyInstruction(offset: number, length: number): Uint8Array;

/**
 * Encode variable-length integer (Git varint format)
 */
export function encodeVarint(value: number): Uint8Array;

/**
 * Decode variable-length integer
 */
export function decodeVarint(data: Uint8Array, offset: number): { value: number; bytesRead: number };
```

**Implementation notes:**
- Maximum copy size is 64KB (0x10000) per instruction - split larger copies
- Maximum insert size is 127 bytes per instruction - split larger inserts
- Copy instruction uses little-endian byte encoding for offset/size
- Zero-length copies are skipped (empty instruction)

#### 2.2 Integration with Existing Delta Utils

The `@statewalker/vcs-utils` package already has delta computation. Ensure compatibility:

```typescript
// Verify round-trip compatibility
const original: Delta[] = createDelta(base, target);
const binary = serializeDelta(original);
const parsed = parseBinaryDelta(binary);
// parsed should be equivalent to original
```

### Phase 3: PendingPack Implementation

**Duration estimate:** Write path work

**Deliverables:**
1. `PendingPack` class - buffers objects before pack creation
2. Integration with `PackWriterStream`
3. Automatic flush on threshold

#### 3.1 PendingPack Implementation

**File:** `packages/core/src/pack/pending-pack.ts`

```typescript
export interface PendingPackOptions {
  /** Maximum objects before auto-flush (default: 100) */
  maxObjects?: number;
  /** Maximum bytes before auto-flush (default: 10MB) */
  maxBytes?: number;
  /** Volatile store for buffering */
  volatile: VolatileStore;
}

export interface PendingEntry {
  id: ObjectId;
  type: "full" | "delta";
  objectType?: PackObjectType;
  baseId?: ObjectId;
  data: Uint8Array;
}

export interface FlushResult {
  packName: string;
  packData: Uint8Array;
  indexData: Uint8Array;
  entries: Array<{ id: ObjectId; offset: number; crc32: number }>;
}

export class PendingPack {
  private entries: PendingEntry[] = [];
  private totalSize: number = 0;

  constructor(options: PendingPackOptions);

  /** Add a full object */
  addObject(id: ObjectId, type: PackObjectType, content: Uint8Array): void;

  /** Add a delta object */
  addDelta(id: ObjectId, baseId: ObjectId, delta: Uint8Array): void;

  /** Number of pending objects */
  get objectCount(): number;

  /** Total pending data size */
  get size(): number;

  /** Check if flush threshold reached */
  shouldFlush(): boolean;

  /** Generate pack file from pending entries */
  async flush(): Promise<FlushResult>;

  /** Discard all pending data */
  clear(): void;
}
```

**Pack naming convention:**
```typescript
// Generate unique pack name based on timestamp + random suffix
function generatePackName(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `pack-${timestamp}${random}`;
}
```

### Phase 4: PackDeltaStore Implementation

**Duration estimate:** Integration work

**Deliverables:**
1. `PackDeltaStore` class implementing `DeltaStore` interface
2. Full read/write cycle
3. Chain resolution support

#### 4.1 PackDeltaStore Implementation

**File:** `packages/core/src/delta/pack-delta-store.ts`

```typescript
export interface PackDeltaStoreOptions {
  files: FilesApi;
  basePath: string;
  volatile: VolatileStore;
  flushThreshold?: number;
}

export class PackDeltaStore implements DeltaStore {
  private readonly packDir: PackDirectory;
  private readonly metaIndex: DeltaMetadataIndex;
  private pending: PendingPack;

  constructor(options: PackDeltaStoreOptions);

  // DeltaStore interface implementation
  async storeDelta(info: DeltaInfo, delta: Delta[]): Promise<number>;
  async loadDelta(targetKey: string): Promise<StoredDelta | undefined>;
  async isDelta(targetKey: string): Promise<boolean>;
  async removeDelta(targetKey: string, keepAsBase?: boolean): Promise<boolean>;
  async getDeltaChainInfo(targetKey: string): Promise<DeltaChainDetails | undefined>;
  listDeltas(): AsyncIterable<DeltaInfo>;

  // Additional methods
  async flush(): Promise<void>;
  async close(): Promise<void>;
}
```

**Implementation flow for `storeDelta()`:**
1. Serialize `Delta[]` to binary format
2. Add to pending pack
3. Update metadata index with depth calculation
4. Check flush threshold, flush if needed
5. Return compressed size

**Implementation flow for `loadDelta()`:**
1. Check metadata index for entry
2. If not found, return undefined
3. Find pack containing the object
4. Read raw delta bytes from pack
5. Parse binary to `Delta[]`
6. Return `StoredDelta` with ratio calculation

### Phase 5: Pack Consolidation

**Duration estimate:** GC integration work

**Deliverables:**
1. `PackConsolidator` class
2. Integration with `GCController`
3. Atomic pack replacement

#### 5.1 PackConsolidator Implementation

**File:** `packages/core/src/pack/pack-consolidator.ts`

```typescript
export interface ConsolidateOptions {
  /** Minimum pack size to keep separate (default: 1MB) */
  minPackSize?: number;
  /** Maximum number of packs (default: 50) */
  maxPacks?: number;
  /** Progress callback */
  onProgress?: (current: number, total: number) => void;
}

export interface ConsolidateResult {
  packsRemoved: number;
  packsCreated: number;
  objectsProcessed: number;
  bytesReclaimed: number;
}

export class PackConsolidator {
  constructor(
    private readonly packDir: PackDirectory,
    private readonly files: FilesApi,
    private readonly volatile: VolatileStore,
  );

  /** Check if consolidation is needed */
  async shouldConsolidate(options?: ConsolidateOptions): Promise<boolean>;

  /** Perform consolidation */
  async consolidate(options?: ConsolidateOptions): Promise<ConsolidateResult>;
}
```

**Consolidation algorithm:**
1. List all packs with sizes
2. Identify packs smaller than threshold
3. If count exceeds max or many small packs exist:
   a. Read all objects from small packs
   b. Sort by type, then path hint, then size (for delta selection)
   c. Write to new pack using `PackWriterStream`
   d. Generate index
   e. Atomically: write new files, delete old files
   f. Update metadata index

**Atomic replacement:**
```typescript
async function atomicPackReplace(
  files: FilesApi,
  basePath: string,
  toRemove: string[],
  toAdd: { name: string; pack: Uint8Array; index: Uint8Array },
): Promise<void> {
  // 1. Write new pack with .tmp suffix
  // 2. Write new index with .tmp suffix
  // 3. Rename .tmp to final names
  // 4. Delete old pack files
  // 5. Delete old index files
}
```

### Phase 6: Integration and Testing

**Duration estimate:** Quality assurance

**Deliverables:**
1. Integration with `RawStoreWithDelta`
2. Integration with `GCController`
3. Comprehensive test suite

#### 6.1 RawStoreWithDelta Integration

Update `RawStoreWithDelta` to accept `PackDeltaStore`:

```typescript
// packages/core/src/delta/raw-store-with-delta.ts
export interface RawStoreWithDeltaOptions {
  objects: RawStore;
  deltas: DeltaStore; // Can be PackDeltaStore
  // ... existing options
}
```

#### 6.2 GCController Integration

Update `GCController` to use pack consolidation:

```typescript
// packages/core/src/delta/gc-controller.ts
export interface GCControllerOptions {
  // ... existing options
  packDir?: PackDirectory;
  consolidator?: PackConsolidator;
}

// In repack method:
async repack(options?: RepackOptions): Promise<RepackResult> {
  // ... existing logic ...

  if (this.consolidator && await this.consolidator.shouldConsolidate()) {
    await this.consolidator.consolidate();
  }
}
```

#### 6.3 Test Plan

**Unit tests:**
- `pack-directory.test.ts` - Pack enumeration, caching, CRUD
- `delta-metadata-index.test.ts` - Entry tracking, persistence, rebuild
- `delta-binary-format.test.ts` - Round-trip serialization
- `pending-pack.test.ts` - Buffering, threshold, flush
- `pack-delta-store.test.ts` - Full DeltaStore interface
- `pack-consolidator.test.ts` - Consolidation logic

**Integration tests:**
- Read packs created by Git (`git gc`)
- Write packs readable by Git (`git verify-pack`)
- Multi-pack queries
- Chain resolution across packs
- GC with pack consolidation

**Performance tests:**
- Large pack handling (10k+ objects)
- Deep chain resolution (depth 50+)
- Consolidation speed with many small packs

## File Structure

```
packages/core/src/
├── delta/
│   ├── delta-binary-format.ts      # NEW: Delta serialization
│   ├── delta-metadata-index.ts     # NEW: Metadata tracking
│   ├── pack-delta-store.ts         # NEW: DeltaStore implementation
│   ├── delta-store.ts              # Existing interface
│   ├── gc-controller.ts            # Update for consolidation
│   └── raw-store-with-delta.ts     # Update for PackDeltaStore
├── pack/
│   ├── pack-directory.ts           # NEW: Multi-pack management
│   ├── pack-consolidator.ts        # NEW: Pack merging
│   ├── pending-pack.ts             # NEW: Write buffering
│   ├── pack-writer.ts              # Existing
│   ├── pack-reader.ts              # Existing
│   ├── pack-index-writer.ts        # Existing
│   ├── pack-index-reader.ts        # Existing
│   └── pack-indexer.ts             # Existing
└── index.ts                        # Update exports

packages/core/tests/
├── delta/
│   ├── delta-binary-format.test.ts # NEW
│   ├── delta-metadata-index.test.ts # NEW
│   └── pack-delta-store.test.ts    # NEW
└── pack/
    ├── pack-directory.test.ts      # NEW
    ├── pack-consolidator.test.ts   # NEW
    └── pending-pack.test.ts        # NEW
```

## Risk Mitigation

**Risk: Pack file corruption**
- Mitigation: Use CRC32 checksums, verify on read
- Recovery: Rebuild from loose objects or other packs

**Risk: Metadata index out of sync**
- Mitigation: Rebuild capability from pack files
- Recovery: Auto-detect and rebuild on startup

**Risk: Concurrent access issues**
- Mitigation: Atomic file operations, file locking where supported
- Design: Single-writer assumption with read-only cache

**Risk: Memory pressure with large packs**
- Mitigation: Streaming APIs, chunk processing
- Design: Never load full pack into memory

## Success Criteria

1. All existing tests pass
2. New tests achieve >90% coverage of new code
3. `git verify-pack` validates generated packs
4. `git unpack-objects` successfully extracts objects
5. Performance: <100ms for single object lookup in 10k-object pack
6. Memory: <50MB peak for consolidating 100 small packs
