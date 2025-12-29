# Git Pack File Examples

Working examples demonstrating how to read and write Git pack files using the `@webrun-vcs/core` package.

## Quick Start

```bash
# Install dependencies
pnpm install

# Generate test data
./test-data/create-test-pack.sh ./test-data

# Run all examples
pnpm examples ./test-data/git-repo/test.pack

# Run individual examples
pnpm example:01 ./test-data/git-repo/test.pack
```

## Examples

| # | Name | Description |
|---|------|-------------|
| 1 | [Simple Roundtrip](src/01-simple-roundtrip/) | Basic read-all-objects-and-write-back workflow |
| 2 | [Delta Preservation](src/02-delta-preservation/) | Analyze delta relationships and object dependencies |
| 3 | [Streaming OFS_DELTA](src/03-streaming-ofs-delta/) | Incremental pack building with offset-based deltas |
| 4 | [Full Verification](src/04-full-verification/) | Detailed logging and byte-level comparison |
| 5 | [Index Format Comparison](src/05-index-format-comparison/) | Compare V1 vs V2 index formats |

## Running Examples

### Run All Examples

```bash
pnpm examples ./test-data/git-repo/test.pack
```

### Run Individual Example

```bash
# Example 1: Simple roundtrip
pnpm example:01 ./test-data/git-repo/test.pack

# Example 2: Delta analysis
pnpm example:02 ./test-data/git-repo/test.pack

# Example 3: Streaming writer
pnpm example:03 ./test-data/git-repo/test.pack

# Example 4: Full verification
pnpm example:04 ./test-data/git-repo/test.pack

# Example 5: Index format comparison
pnpm example:05 ./test-data/git-repo/test.idx
```

### Run Specific Example by Number

```bash
# Run only example 3
pnpm examples ./test-data/git-repo/test.pack 3
```

## Test Data

### Generate Test Data

The included script creates a pack file with various object types:

```bash
./test-data/create-test-pack.sh ./test-data
```

This creates:
- `git-repo/test.pack` - Pack file with commits, trees, blobs, and tags
- `git-repo/test.idx` - Corresponding index file

### Use Existing Repository

You can also use pack files from any Git repository:

```bash
# Copy from an existing repo
cp /path/to/repo/.git/objects/pack/*.pack ./test-data/git-repo/
cp /path/to/repo/.git/objects/pack/*.idx ./test-data/git-repo/

# Run examples
pnpm example:01 ./test-data/git-repo/pack-*.pack
```

## Key APIs Demonstrated

### Reading Pack Files

```typescript
import {
  readPackIndex,
  PackReader,
} from "@webrun-vcs/core";

// Read index file
const idxData = await files.read("pack.idx");
const index = readPackIndex(idxData);

// Open pack reader
const reader = new PackReader(files, "pack.pack", index);
await reader.open();

// Get object by ID
const obj = await reader.get(objectId);
// obj.type - PackObjectType (COMMIT, TREE, BLOB, TAG)
// obj.content - Uint8Array of uncompressed content
// obj.size - Content size

await reader.close();
```

### Writing Pack Files

```typescript
import {
  writePack,
  writePackIndexV2,
  PackObjectType,
} from "@webrun-vcs/core";

// Prepare objects
const objects = [
  { id: "abc123...", type: PackObjectType.BLOB, content: new Uint8Array([...]) },
  { id: "def456...", type: PackObjectType.COMMIT, content: new Uint8Array([...]) },
];

// Write pack
const result = await writePack(objects);

// Write index
const idxData = await writePackIndexV2(result.indexEntries, result.packChecksum);

// Save files
await files.write("new.pack", result.packData);
await files.write("new.idx", idxData);
```

### Streaming Writer

```typescript
import { PackWriterStream } from "@webrun-vcs/core";

const writer = new PackWriterStream();

// Add objects incrementally
await writer.addObject(id1, PackObjectType.BLOB, content1);
await writer.addObject(id2, PackObjectType.BLOB, content2);

// Add delta (OFS_DELTA)
await writer.addOfsDelta(id3, id1, deltaData);

// Finalize
const result = await writer.finalize();
```

## Directory Structure

```
apps/examples-git/
├── package.json
├── tsconfig.json
├── README.md
├── src/
│   ├── 01-simple-roundtrip/
│   │   ├── 01-simple-roundtrip.ts    # Example code
│   │   └── 01-simple-roundtrip.md    # Documentation
│   ├── 02-delta-preservation/
│   │   └── ...
│   ├── 03-streaming-ofs-delta/
│   │   └── ...
│   ├── 04-full-verification/
│   │   └── ...
│   ├── 05-index-format-comparison/
│   │   └── ...
│   ├── shared/
│   │   └── utils.ts                  # Shared utilities
│   └── run-all.ts                    # Example runner
└── test-data/
    ├── README.md
    ├── create-test-pack.sh           # Test data generator
    └── git-repo/
        ├── test.pack                 # Generated pack file
        └── test.idx                  # Generated index file
```

## Output Files

Examples create output files alongside the input:

| Example | Output Files |
|---------|-------------|
| 01 | `*.repacked` pack and index |
| 02 | `*.no-deltas.pack` and index |
| 03 | `*.streamed.pack` and index |
| 04 | `*.verified.pack` and index |
| 05 | `*.v1.idx` and `*.v2.idx` |

## Verifying Generated Files

Use the included shell scripts to verify generated pack files with native git:

```bash
# Verify a single pack file
./test-data/verify-pack.sh ./test-data/git-repo/test.pack.verified.pack

# Verify all pack files in the directory
./test-data/verify-all.sh ./test-data/git-repo
```

Example output:
```
=== Verifying All Pack Files ===

Directory: ./test-data/git-repo

  [1] test.pack                                ✓ VALID (36 objects)
  [2] test.pack.no-deltas.pack                 ✓ VALID (36 objects)
  [3] test.pack.streamed.pack                  ✓ VALID (36 objects)
  [4] test.pack.verified.pack                  ✓ VALID (36 objects)

=== Summary ===

Total pack files: 4
Valid:            4
Failed:           0

✓ All pack files are valid!
```

## Learn More

- [Git Pack Format](https://git-scm.com/docs/pack-format)
- [Git Index Format](https://git-scm.com/docs/index-format)
- [Pro Git - Packfiles](https://git-scm.com/book/en/v2/Git-Internals-Packfiles)
