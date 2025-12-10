# Git Source Repository Performance Benchmark

This example application benchmarks webrun-vcs by loading and traversing the git source code repository itself. It demonstrates the library's ability to handle large, real-world git repositories with extensive commit histories.

## What It Does

The benchmark performs these operations in sequence:

**Step 1: Clone the Git Repository** - Downloads the official git source code from GitHub. On subsequent runs, it fetches updates instead of re-cloning, making repeated benchmarks faster.

**Step 2: Run Garbage Collection** - Executes `git gc --aggressive` to consolidate all objects into optimally packed files. This creates the most realistic scenario for testing pack file reading performance.

**Step 3: Load Pack Files with webrun-vcs** - Initializes the webrun-vcs storage layer and loads the pack file indexes. This measures the overhead of preparing the library for use.

**Step 4: Traverse Commit History** - Walks through the last 1000 commits using the commit ancestry traversal API. Each commit is fully loaded and parsed, demonstrating the library's ability to resolve delta-compressed objects.

**Step 5: Measure Object Access** - Performs random access to a sample of commits and their associated tree objects. This tests the pack index lookup and object decompression performance.

**Step 6: Output Performance Results** - Writes detailed metrics to `performance-results.json` including individual operation timings, commit information, and summary statistics.

**Step 7: Checkout Third Commit** - Extracts the third commit's entire file tree to the `git-repo` working directory using only the webrun-vcs API. Then verifies the extraction using native git's `diff-index` command to ensure all files match the commit exactly.

## Running the Benchmark

### Full Benchmark

Run all steps in sequence:

```bash
# From the monorepo root
pnpm install
pnpm --filter @webrun-vcs/example-git-perf start

# Or from this directory
pnpm start
```

The first run takes several minutes to clone the git repository (approximately 200MB). Subsequent runs reuse the local clone and only fetch updates.

### Individual Steps

Each step can be run independently, which is useful for debugging or when you want to skip time-consuming operations like cloning:

```bash
# Step 1: Clone repository (or fetch if exists)
pnpm step:clone

# Step 2: Run garbage collection
pnpm step:gc

# Step 3: Load pack files with webrun-vcs
pnpm step:load

# Step 4: Traverse last 1000 commits
pnpm step:traverse

# Step 5: Measure object access performance
pnpm step:measure

# Step 6: Show results info
pnpm step:results

# Step 7: Checkout 3rd commit to local folder
pnpm step:checkout
```

Steps 3-7 require the repository to exist (run step:clone first). Step 6 is informational only when run standalone - full results require running all steps via `pnpm start`.

## Output Files

After running, you'll find these artifacts:

- `git-repo/` - The cloned git source repository (with 3rd commit checked out after step 7)
- `performance-results.json` - Detailed performance metrics

The JSON results file contains:

```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "repository": "https://github.com/git/git.git",
  "commitCount": 1000,
  "metrics": [
    { "name": "git_clone", "duration": 45000, "unit": "ms" },
    { "name": "git_gc", "duration": 12000, "unit": "ms" },
    { "name": "webrun_vcs_init", "duration": 150, "unit": "ms" },
    { "name": "commit_traversal", "duration": 2500, "unit": "ms" },
    { "name": "object_random_access", "duration": 800, "unit": "ms" }
  ],
  "commits": [...],
  "summary": {
    "totalDuration": 60450,
    "packFilesCount": 1,
    "packFilesTotalSize": 215000000,
    "objectCount": 5200
  }
}
```

## Understanding the Results

The most relevant metrics for evaluating webrun-vcs performance are:

- **webrun_vcs_init** - Time to initialize storage and load pack indexes
- **commit_traversal** - Time to walk 1000 commits with full parsing
- **object_random_access** - Time for random object lookups

The summary includes derived rates like commits per second and objects per second, giving you a quick sense of throughput.

## Project Structure

```
src/
├── main.ts              # Main entry point - runs all steps
├── shared/              # Shared utilities
│   ├── config.ts        # Configuration constants
│   ├── types.ts         # Type definitions
│   ├── performance.ts   # Performance tracking
│   ├── helpers.ts       # Helper functions
│   ├── storage.ts       # Storage initialization
│   └── index.ts         # Re-exports
└── steps/               # Individual step scripts
    ├── 01-clone-repository.ts
    ├── 02-garbage-collection.ts
    ├── 03-load-pack-files.ts
    ├── 04-traverse-commits.ts
    ├── 05-measure-access.ts
    ├── 06-write-results.ts
    ├── 07-checkout-commit.ts
    └── index.ts
```

## Requirements

- Node.js 18 or later
- Git command-line tools installed and in PATH
- Internet connection (for initial clone)
- Approximately 500MB disk space
