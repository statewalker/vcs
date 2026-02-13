# Delta Compression Benchmark

Measures the performance of WebRun VCS delta encoding and decoding algorithms across various file sizes and mutation rates.

## What This Measures

- **Encoding performance**: Time to compute delta between source and target
- **Decoding performance**: Time to reconstruct target from source + delta
- **Compression ratio**: Delta size relative to target size
- **Throughput**: MB/s processing speed

## Running the Benchmark

```bash
pnpm start
```

## Output

The benchmark produces a table showing:

| Column | Description |
|--------|-------------|
| Size | Source/target file size |
| Mutation | Percentage of bytes changed |
| Delta | Size of the encoded delta |
| Ratio | Delta size / target size |
| Encode | Time to create delta |
| Decode | Time to apply delta |
| Total | Combined encode + decode time |
| Throughput | Processing speed in MB/s |

## Test Matrix

**File sizes**: 1KB, 10KB, 50KB, 100KB, 500KB, 1MB

**Mutation rates**:
- 0% - Identical files (best case)
- 1% - Minor changes
- 5% - Small edits
- 10% - Moderate changes
- 25% - Significant changes
- 50% - Heavy modifications
- 100% - Completely different (worst case)

## Expected Results

- **0% mutation**: Delta should be very small (just metadata)
- **1-10% mutation**: Good compression ratios (20-40% of original)
- **50%+ mutation**: Limited compression benefit
- **100% mutation**: Delta approaches original size

## Algorithm Details

This benchmark uses the Git-compatible delta format with:
- Block-based similarity detection (16-byte blocks)
- Rolling checksum for fast matching
- Copy/insert instruction encoding

## See Also

- [packages/utils/src/diff/delta/](../../../packages/utils/src/diff/delta/) - Delta algorithm implementation
- [packages/utils/tests/diff/performance/](../../../packages/utils/tests/diff/performance/) - Unit test benchmarks
