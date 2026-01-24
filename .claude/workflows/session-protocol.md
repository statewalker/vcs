# Session Protocol

This document defines the mandatory workflow for completing work sessions. Work is **NOT complete** until all changes are pushed to the remote repository.

## Incremental Commits (After Each Epic/Task)

After completing each Beads epic or logically independent task, run quality gates and commit immediately:

```bash
pnpm test && pnpm typecheck && pnpm lint:fix && pnpm format:fix
git add <changed-files>
git commit -m "feat: description of completed work"
git push
```

**Why incremental commits?**
- Smaller, focused commits are easier to review and revert
- Reduces risk of losing work
- Keeps the remote up to date for collaborators
- Makes it easier to track what changed per task

**What counts as "logically independent"?**
- A completed Beads epic or task
- A feature or bug fix that works on its own
- A refactoring that doesn't break anything
- Any coherent unit of work that passes all quality gates

## Pre-Commit Quality Checks

Before every commit, run these commands in order:

```bash
pnpm test         # Ensure all tests pass
pnpm lint:fix     # Fix and verify linting
pnpm format:fix   # Fix and verify formatting
```

Do not commit code that fails tests or has linting/formatting issues. If any command fails, fix the issues before proceeding.

## Session Completion Checklist

When ending a work session, complete ALL steps below:

### 1. File Issues for Remaining Work

Create issues for anything that needs follow-up using `bd create`.

### 2. Run Quality Gates

If code changed, run tests, linters, and builds:

```bash
pnpm test
pnpm lint:fix
pnpm format:fix
```

### 3. Update Issue Status

Close finished work and update in-progress items:

```bash
bd close <completed-issue-ids>
bd update <partial-work-id> --status in_progress
```

### 4. Push to Remote

This is **MANDATORY**:

```bash
git pull --rebase
bd sync
git add .
git commit -m "Your commit message"
git push
git status  # MUST show "up to date with origin"
```

### 5. Clean Up

- Clear any stashes
- Prune remote branches if needed

### 6. Verify

- All changes committed AND pushed
- `git status` shows clean working tree
- Remote is up to date

### 7. Hand Off

Provide context for the next session about:
- What was completed
- What's in progress
- Any blockers or issues discovered

## Critical Rules

- **Work is NOT complete until `git push` succeeds**
- **NEVER stop before pushing** - that leaves work stranded locally
- **NEVER say "ready to push when you are"** - YOU must push
- **If push fails**, resolve conflicts and retry until it succeeds

## Quick Reference

```bash
# Complete session workflow
pnpm test && pnpm lint:fix && pnpm format:fix  # Quality gates
bd close <ids>                                  # Close issues
git pull --rebase                               # Get latest
bd sync                                         # Sync beads
git add . && git commit -m "..."               # Commit
git push                                        # Push (MANDATORY)
git status                                      # Verify
```
