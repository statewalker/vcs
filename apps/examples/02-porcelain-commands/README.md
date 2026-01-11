# 02-porcelain-commands

**Goal:** Complete Git workflow using the Commands API (porcelain layer).

## What You'll Learn

- Initialize repositories with the Commands API
- Stage files and create commits
- Create and manage branches
- Checkout branches
- Merge branches with different strategies
- View commit history and diffs
- Check repository status
- Create and list tags
- Use stash operations

## Prerequisites

- Node.js 18+
- pnpm
- Completed [01-quick-start](../01-quick-start/)

## Running

Run all steps:
```bash
pnpm start
```

Run individual steps:
```bash
pnpm step:01  # Init and commit
pnpm step:02  # Branching
pnpm step:03  # Checkout
pnpm step:04  # Merge
pnpm step:05  # Log and diff
pnpm step:06  # Status
pnpm step:07  # Tags
pnpm step:08  # Stash
```

## Steps Overview

### Step 1: Init and Commit
Initialize a repository and create commits using the Commands API.

### Step 2: Branching
Create, list, and delete branches.

### Step 3: Checkout
Switch between branches and create new branches on checkout.

### Step 4: Merge
Merge branches using different strategies (fast-forward, three-way).

### Step 5: Log and Diff
View commit history and compare changes between commits.

### Step 6: Status
Check the repository status to see staged and unstaged changes.

### Step 7: Tags
Create lightweight and annotated tags.

### Step 8: Stash
Save work in progress and restore it later.

## Key Concepts

### Commands API vs Low-Level API

The Commands API (porcelain) provides high-level operations like `git.commit()`, `git.checkout()`, etc. It's built on top of the low-level API (plumbing) shown in 01-quick-start.

### GitStore

The `GitStore` combines repository storage with staging area, enabling the Commands API to work with both committed and staged changes.

## Next Steps

- [03-object-model](../03-object-model/) - Deep dive into Git's object model
- [04-branching-merging](../04-branching-merging/) - Advanced branching and merging
