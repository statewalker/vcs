# Pack Operations Benchmark

Measures the performance of Git pack file writing and reading operations in WebRun VCS.

## What This Measures

- **Pack writing**: Time to serialize objects into pack format with compression
- **Index writing**: Time to generate pack index for random access
- **Pack reading**: Time to read and decompress objects from pack
- **Index reading**: Time to parse pack index
- **Compression ratio**: Pack size relative to raw content size

## Running the Benchmark

```bash
pnpm start
```

## Output

The benchmark produces a table showing:

| Column | Description |
|--------|-------------|
| Config | Test configuration name |
| Objects | Number of objects in pack |
| Content | Total raw content size |
| Pack | Pack file size |
| Index | Index file size |
| Ratio | Compression ratio |
| Write | Time to write pack + index |
| Read | Time to read all objects |

## Test Configurations

- **Small blobs**: 1KB objects (configs, small source files)
- **Medium blobs**: 10KB objects (typical source files)
- **Large blobs**: 100KB objects (assets, large files)
- **Mixed sizes**: Realistic distribution of file sizes
- **Many tiny blobs**: 256B objects (stress test for overhead)

## Expected Results

- **Compression**: Pack files are typically 40-70% of raw size
- **Write speed**: Depends on compression level
- **Read speed**: Fast decompression, index lookup
- **Index overhead**: ~28 bytes per object (SHA-1 + offset + CRC32)

## Pack Format Details

WebRun VCS uses Git-compatible pack format (version 2):
- zlib-compressed object data
- Variable-length integer encoding
- Optional delta compression (REF_DELTA, OFS_DELTA)
- SHA-1 checksums for integrity

## See Also

- [packages/core/src/storage/pack/](../../../packages/core/src/storage/pack/) - Pack implementation
- [benchmarks/delta-compression/](../delta-compression/) - Delta algorithm benchmarks
