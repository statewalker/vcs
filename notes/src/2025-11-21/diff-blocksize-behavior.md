# BlockSize Behavior in Delta Encoding

## Understanding BlockSize and MinMatch

The `createDeltaRanges` and `createDelta` functions use a **rolling hash algorithm** to find matching blocks between source and target arrays. Two key parameters control this behavior:

- **`blockSize`** (default: 16): The size of blocks used for rolling hash computation
- **`minMatch`** (default: 16): The minimum number of consecutive matching bytes required to emit a COPY range

## Why Default BlockSize = 16 May Miss Patterns

### Example Case

Consider this scenario:

```typescript
const source = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
const target = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 99, 100, 101, 102, 13, 14, 15, 16]);
```

**Expected pattern:**
- COPY bytes 1-8 from source (positions 0-7)
- LITERAL bytes 99, 100, 101, 102 (positions 8-11 in target)
- COPY bytes 13-16 from source (positions 12-15)

### With Default BlockSize = 16

```typescript
const ranges = Array.from(createDeltaRanges(source, target));
// Result: [{ from: 'target', start: 0, len: 16 }]
```

**Why?** The algorithm looks for 16-byte matching blocks:
- Position 0 in target: bytes `[1, 2, 3, 4, 5, 6, 7, 8, 99, 100, 101, 102, 13, 14, 15, 16]`
- Position 0 in source: bytes `[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]`
- **They don't match** (bytes 8-11 are different)

Since no 16-byte block matches, the algorithm falls back to treating everything as literal.

### With BlockSize = 4

```typescript
const ranges = Array.from(createDeltaRanges(source, target, 4, 4));
// Result: [
//   { from: 'source', start: 0, len: 8 },
//   { from: 'target', start: 8, len: 4 },
//   { from: 'source', start: 12, len: 4 }
// ]
```

**Why?** With a smaller block size:
1. Hash of bytes `[1, 2, 3, 4]` at target[0] matches source[0]
2. Algorithm extends the match forward: finds 8 consecutive matching bytes
3. Bytes 8-11 don't match → emits as LITERAL
4. Hash of bytes `[13, 14, 15, 16]` at target[12] matches source[12]
5. Emits 4-byte COPY from source

## Algorithm Details

The algorithm works in phases:

1. **Build hash index** of all blockSize-length blocks in source
2. **Scan target** using rolling hash:
   - For each position, compute hash of next blockSize bytes
   - If hash matches a source position:
     - **Extend backward** as far as bytes match
     - **Extend forward** as far as bytes match
     - If total match length >= minMatch, emit COPY range
3. **Fall back** to LITERAL for unmatched bytes

## Choosing BlockSize

### Larger BlockSize (e.g., 16-32)

**Pros:**
- Fewer false positives from hash collisions
- Better compression for files with large similar blocks
- Lower memory usage for hash index

**Cons:**
- May miss shorter matching patterns
- Less effective for files with many small changes

**Best for:** Binary files, images, large files with big unchanged sections

### Smaller BlockSize (e.g., 4-8)

**Pros:**
- Finds shorter matching patterns
- Better for files with many small changes
- More granular delta encoding

**Cons:**
- More hash collisions possible
- Higher memory usage for hash index
- More computation

**Best for:** Text files, source code, files with scattered small changes

## Recommendations

1. **Source code / text files**: Use blockSize=4 to 8
2. **Binary files / images**: Use blockSize=16 to 32
3. **General purpose**: Default blockSize=16 is a good compromise

## Performance Trade-offs

| BlockSize | Memory | Speed | Compression |
|-----------|--------|-------|-------------|
| 4         | Higher | Slower| Better (small changes) |
| 8         | Medium | Medium| Good (balanced) |
| 16        | Lower  | Faster| Good (large blocks) |
| 32        | Lowest | Fastest| Best (very large blocks) |

## Test Example

See [tests/create-delta-apply-delta.test.ts](tests/create-delta-apply-delta.test.ts) for the test case "should handle middle insertion with appropriate blockSize" which demonstrates this behavior.
