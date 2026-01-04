# Example: Pack GC with Native Git Verification

This example demonstrates the complete Git workflow including repository creation, commits, packing (garbage collection), and verification that native git can read the resulting repository.

## What This Example Does

The example performs the following steps:

**Step 1: Create New Git Repository**
Creates a fresh Git repository on the real filesystem using `NodeFilesApi`.

**Step 2: Create Multiple Commits**
Creates 4 commits with progressive changes:
- Initial commit with README.md
- Add source file (index.ts)
- Update source file with more functions
- Add package.json

**Step 3: Verify Loose Objects**
Confirms that all Git objects (blobs, trees, commits) are stored as loose objects in `.git/objects/XX/YYYY...` format.

**Step 4: Pack All Objects (GC)**
Runs the `repack()` operation to consolidate all loose objects into a single pack file with delta compression.

**Step 5: Verify Automatic Loose Objects Cleanup**
Verifies that `repack()` automatically removes loose objects that are now in pack files.

**Step 6: Verify Filesystem State**
Confirms that loose objects are removed and pack files exist.

**Step 7: Verify Commit Restoration**
Loads and verifies all commits from the pack file, checking that file contents match expected values.

**Step 8: Native Git Verification**
Runs native git commands to prove compatibility:
- `git log` - View commit history
- `git show` - Display commit details
- `git cat-file` - Read objects from pack
- `git fsck` - Verify repository integrity
- `git reset --hard` - Checkout working tree
- Verifies checked-out file contents match

## Running the Example

```bash
# From the repository root
pnpm --filter @statewalker/vcs-example-pack-gc start

# Or from this directory
pnpm start
```

## Output

The example produces detailed output showing each step and verification result. A successful run shows:

```
======================================================================
  Summary
======================================================================

  This example demonstrated:

    1. Repository Creation
       - Created Git repository at test-repo
       - Used NodeFilesApi for real filesystem operations

    2. Commit Creation
       - Created 4 commits with file changes
       - Each commit properly linked to parent

    3. Loose Object Storage
       - Initially stored 12 loose objects
       - Objects stored in .git/objects/XX/YYYY... format

    4. Packing (GC)
       - Ran repack operation to create pack files
       - Created 1 pack file(s)

    5. Loose Objects Cleanup
       - Automatic cleanup: YES
       - Loose objects remaining: 0

    6. Verification
       - All commits readable from pack files: YES
       - Native git compatible: YES
```

## Exploring the Repository

After running the example, you can explore the created repository:

```bash
cd apps/example-pack-gc/test-repo

# View commit history
git log --oneline

# Show repository structure
git cat-file -p HEAD^{tree}

# View pack file contents
git verify-pack -v .git/objects/pack/*.pack

# Check out different commits
git checkout HEAD~2
git log --oneline
```

## Key APIs Used

- `createGitStorage()` - Initialize Git repository
- `storage.objects.store()` - Store blob content
- `storage.trees.storeTree()` - Create tree objects
- `storage.commits.storeCommit()` - Create commits
- `storage.refs.set()` - Update branch references
- `storage.rawStorage.repack()` - Pack objects and prune loose objects (GC)
- `storage.rawStorage.pruneLooseObjects()` - Manually prune loose objects in packs
- `storage.refresh()` - Reload pack files
