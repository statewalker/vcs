# Implementation Plan: Update storeObject to Stream-Based Signature

## Overview

Update the `DeltaStoreUpdate.storeObject` method to accept stream-based content without requiring an explicit type parameter. The object type will be detected from the Git header when needed.

## Current State

```typescript
// Current signature in delta-store.ts
storeObject(key: string, type: ObjectTypeCode, content: Uint8Array): void
```

**Problems:**
- Requires caller to know the object type upfront
- Synchronous `Uint8Array` doesn't support streaming large objects
- Type parameter is redundant since Git objects include a header with type information

## Target State

```typescript
// New signature
storeObject(
  key: string,
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>
): Promise<void>
```

**Benefits:**
- Stream-based content supports large objects without full memory buffering
- Type is extracted from Git header when needed (PackDeltaStore)
- Simpler API - callers don't need to specify type separately
- Consistent with `RawStore` which stores objects with Git headers

## Implementation Steps

### Step 1: Update Interface Definition

**File:** `packages/core/src/delta/delta-store.ts`

Update the `DeltaStoreUpdate` interface:

```typescript
export interface DeltaStoreUpdate {
  /**
   * Store a full object (non-delta) in this batch
   *
   * Content should be a stream of raw object data. 
   *
   * @param key Object key (SHA-1 hash)
   * @param content Stream of raw object data WITH Git header
   */
  storeObject(
    key: string,
    content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
  ): Promise<void>;

  // storeDelta and close remain unchanged
}
```

Remove the `ObjectTypeCode` import if no longer used elsewhere in this file.

### Step 2: Update PackDeltaStoreUpdate (Header Detection)

**File:** `packages/core/src/pack/pack-delta-store.ts`

This is the only implementation that needs the object type. It must parse the Git header from the stream.

**Add imports:**
```typescript
import { collect, newByteSplitter, readHeader } from "@statewalker/vcs-utils";
import { parseHeader } from "../objects/object-header.js";
```

**Update method:**
```typescript
/**
 * Store a full object in this batch
 *
 * Parses the Git header to determine object type, then stores
 * the content (without header) in the pending pack.
 */
async storeObject(
  key: string,
  content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<void> {
  if (this.closed) {
    throw new Error("Update already closed");
  }

  // Use readHeader to split stream into header and remaining content
  // newByteSplitter(0) finds the null byte that terminates Git header ("type size\0")
  const [headerBytes, contentStream] = await readHeader(
    content,
    newByteSplitter(0), // Split on null byte (includes delimiter in header)
    32, // Max header length (type + space + size + null)
  );

  // Parse header to extract type
  const parsed = parseHeader(headerBytes);
  const packType = toPackObjectType(parsed.typeCode);

  // Collect content (readHeader already excludes header from contentStream)
  const contentBytes = await collect(contentStream);

  this.pending.addObject(key, packType, contentBytes);
}
```

### Step 3: Update MemDeltaStoreUpdate

**File:** `packages/store-mem/src/binary-storage/mem-delta-store.ts`

This store ignores full objects (handled by MemRawStore), so just update the signature:

```typescript
/**
 * Store a full object - no-op for memory store (objects stored elsewhere)
 */
async storeObject(
  _key: string,
  _content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<void> {
  if (this.closed) {
    throw new Error("Update already closed");
  }
  // Memory delta store only handles deltas, not full objects
  // Full objects are stored in MemRawStore
}
```

Remove the unused `ObjectTypeCode` import.

### Step 4: Update KvDeltaStoreUpdate

**File:** `packages/store-kv/src/binary-storage/kv-delta-store.ts`

Same pattern as MemDeltaStore:

```typescript
/**
 * Store a full object - no-op for KV delta store
 */
async storeObject(
  _key: string,
  _content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<void> {
  if (this.closed) {
    throw new Error("Update already closed");
  }
  // KV delta store only handles deltas, not full objects
}
```

Remove unused `ObjectTypeCode` import.

### Step 5: Update SqlDeltaStoreUpdate

**File:** `packages/store-sql/src/binary-storage/sql-delta-store.ts`

Same pattern:

```typescript
/**
 * Store a full object - no-op for SQL delta store
 */
async storeObject(
  _key: string,
  _content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<void> {
  if (this.closed) {
    throw new Error("Update already closed");
  }
  // SQL delta store only handles deltas, not full objects
}
```

Remove unused `ObjectTypeCode` import.

### Step 6: Update MockDeltaStoreUpdate

**File:** `packages/core/tests/mocks/mock-delta-store.ts`

```typescript
async storeObject(
  _key: string,
  _content: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
): Promise<void> {
  if (this.closed) {
    throw new Error("Update already closed");
  }
  // Mock delta store only handles deltas
}
```

Remove unused `ObjectTypeCode` import.

### Step 7: Update All Callers

Search for all usages of `storeObject` and update them to pass streams:

```bash
# Find all callers
rg "\.storeObject\(" packages/
```

**Common pattern for updating callers:**

Before:
```typescript
update.storeObject(key, ObjectType.BLOB, content);
```

After:
```typescript
// Helper function (add to utils if needed)
function* toStream(data: Uint8Array): Iterable<Uint8Array> {
  yield data;
}

// Or inline
update.storeObject(key, (function* () { yield contentWithHeader; })());
```

If content doesn't have a header, wrap it:
```typescript
import { createGitObject } from "../objects/object-header.js";

const contentWithHeader = createGitObject("blob", content);
await update.storeObject(key, [contentWithHeader]);
```

### Step 8: Add/Export Helper Utility

**File:** `packages/utils/src/streams/index.ts`

Consider adding a helper to convert `Uint8Array` to iterable:

```typescript
/**
 * Convert a Uint8Array to an Iterable for stream APIs
 */
export function* asIterable(data: Uint8Array): Iterable<Uint8Array> {
  yield data;
}
```

### Step 9: Update Tests

Update any tests that call `storeObject`:

```typescript
// Before
update.storeObject("key", ObjectType.BLOB, content);

// After
const objectWithHeader = createGitObject("blob", content);
await update.storeObject("key", [objectWithHeader]);
```

### Step 10: Run Tests and Verify

```bash
pnpm test
pnpm lint:fix
pnpm format:fix
```

## Files to Modify

| File | Change |
|------|--------|
| `packages/core/src/delta/delta-store.ts` | Interface signature, remove type param |
| `packages/core/src/pack/pack-delta-store.ts` | Header detection with readAhead |
| `packages/store-mem/src/binary-storage/mem-delta-store.ts` | Signature only |
| `packages/store-kv/src/binary-storage/kv-delta-store.ts` | Signature only |
| `packages/store-sql/src/binary-storage/sql-delta-store.ts` | Signature only |
| `packages/core/tests/mocks/mock-delta-store.ts` | Signature only |
| Various test files | Update storeObject calls |

## Dependencies

The `readHeader` function from `packages/utils/src/streams/read-header.ts` is already available and handles:
- Splitting stream into header and remaining content
- Returns `[header, rest]` where `rest` excludes the header (no manual skipping needed)
- Max length protection

The `newByteSplitter` function from `packages/utils/src/streams/split-stream.ts` provides:
- A factory for creating byte-based stream splitters
- `newByteSplitter(0)` creates a splitter that finds the null byte (0x00)
- Returns position after delimiter (includes delimiter in the split)

The `parseHeader` function from `packages/core/src/objects/object-header.ts` handles:
- Parsing Git header format `"type size\0"`
- Extracting type code and content offset

## Risk Assessment

**Low Risk:**
- Most implementations (Mem, Kv, Sql, Mock) don't use `storeObject` for anything - just signature change
- Type detection logic uses existing, tested header parsing

**Medium Risk:**
- PackDeltaStore changes are more involved
- Need to verify all callers are updated correctly

**Mitigation:**
- Existing tests should catch regressions
- Add specific test for header detection in PackDeltaStoreUpdate

## Testing Strategy

1. **Unit tests for PackDeltaStoreUpdate:**
   - Verify type is correctly extracted from header
   - Test with all object types (blob, tree, commit, tag)
   - Test with streamed content (multiple chunks)

2. **Integration tests:**
   - Verify pack files are created correctly
   - Verify objects can be read back after storage

3. **Regression tests:**
   - Run full test suite to catch any broken callers

## Rollout

1. Update interface and all implementations
2. Update all direct callers
3. Run full test suite
4. Fix any failing tests
5. Commit and push
