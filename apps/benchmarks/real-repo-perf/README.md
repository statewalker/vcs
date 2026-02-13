# Real Repository Performance Benchmark

Simulates realistic Git workflows and measures end-to-end performance of WebRun VCS operations.

## What This Measures

- **Repository initialization**: Time to create and configure repository
- **File staging**: Time to add files to the index
- **Commit creation**: Time to create commits with file changes
- **History traversal**: Time to walk commit history (log)
- **Status computation**: Time to calculate working tree status
- **Branch operations**: Time to create/switch branches
- **Diff computation**: Time to compute changes between commits

## Running the Benchmark

```bash
pnpm start
```

## Test Configuration

Default configuration:
- **100 files**: Mix of source, test, and documentation files
- **20 commits**: Each modifying 5 files
- **Branch operations**: Create and switch branches

## Simulated Project Structure

```
project/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   └── module-*.ts (60% of files)
├── tests/
│   └── module-*.test.ts (30% of files)
└── docs/
    └── page-*.md (10% of files)
```

## Output

The benchmark produces a table showing timing for each operation:

| Operation | Description |
|-----------|-------------|
| Add all files | Stage initial project files |
| First commit | Create initial commit |
| Create N commits | Sequential commits with changes |
| Traverse history | Walk commit log |
| Compute status | Calculate working tree status |
| List branches | Enumerate all branches |
| Create & switch branches | Branch creation and checkout |
| Diff first..last | Compute diff between commits |

## Use Cases

This benchmark helps validate:
1. **Scaling behavior**: How performance changes with repo size
2. **Real-world patterns**: Common Git workflow performance
3. **Regression detection**: Performance changes between versions
4. **Memory usage**: Heap usage during operations

## See Also

- [benchmarks/delta-compression/](../delta-compression/) - Delta algorithm benchmarks
- [benchmarks/pack-operations/](../pack-operations/) - Pack file benchmarks
- [examples/02-porcelain-commands/](../../examples/02-porcelain-commands/) - Commands API usage
