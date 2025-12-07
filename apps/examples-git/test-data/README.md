# Test Data and Verification Scripts

This directory contains test pack files and verification scripts for the Git pack examples.

## Scripts

### create-test-pack.sh

Creates a test pack file with various Git object types.

```bash
./create-test-pack.sh [output-directory]
```

The script:
1. Creates a temporary Git repository
2. Adds commits, trees, blobs, and tags
3. Runs `git gc` to generate pack files
4. Copies the pack and index files to the output directory

### verify-pack.sh

Verifies a single pack file using native git commands.

```bash
./verify-pack.sh <pack-file>
```

The script uses `git verify-pack` to check:
- Pack file structure validity
- Object checksums
- Delta chain integrity
- Index consistency

Example:
```
=== Git Pack Verification ===

Pack file: ./git-repo/test.pack
Index file: ./git-repo/test.idx

--- Verifying Pack Structure ---
✓ Pack structure is valid

--- Pack Contents (git verify-pack -v) ---
32e948119c28805ce82baaedc6da2b8a0c169fb4 commit 224 155 12
...

Total objects: 36

=== Verification Complete ===

Pack file: VALID
Objects: 36
```

### verify-all.sh

Verifies all pack files in a directory.

```bash
./verify-all.sh [directory]
```

Default directory is `./git-repo`. Finds all `.pack` files and verifies each one.

Example:
```
=== Verifying All Pack Files ===

Directory: ./git-repo

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

## Test Data Contents

The generated pack contains:
- **Commits**: Multiple commits with incremental changes
- **Trees**: Directory structures
- **Blobs**: Text files of various sizes
- **Tags**: An annotated tag (v1.0)
- **Deltas**: Some objects may be stored as deltas

## Generated Files

After running `create-test-pack.sh`:

```
git-repo/
├── test.pack    # Pack file with Git objects
└── test.idx     # Corresponding index file
```

After running examples:

```
git-repo/
├── test.pack                    # Original pack
├── test.idx                     # Original index
├── test.pack.repacked           # Example 01 output
├── test.pack.repacked.idx
├── test.pack.no-deltas.pack     # Example 02 output
├── test.pack.no-deltas.idx
├── test.pack.streamed.pack      # Example 03 output
├── test.pack.streamed.idx
├── test.pack.verified.pack      # Example 04 output
├── test.pack.verified.idx
├── test.idx.v1.idx              # Example 05 output
└── test.idx.v2.idx
```

## Requirements

- Git must be installed and available in PATH
- Bash shell (Linux/macOS/WSL)

## Manual Creation

If you prefer to use an existing repository, you can copy pack files from any Git repository:

```bash
cp /path/to/repo/.git/objects/pack/*.pack ./git-repo/test.pack
cp /path/to/repo/.git/objects/pack/*.idx ./git-repo/test.idx
```

## Complete Workflow

```bash
# Generate test data
./create-test-pack.sh .

# Run examples (generates additional pack files)
cd .. && pnpm examples ./test-data/git-repo/test.pack

# Verify all generated packs
cd test-data && ./verify-all.sh
```
