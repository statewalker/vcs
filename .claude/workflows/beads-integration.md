# Beads Issue Tracking Integration

This project uses **Beads** (`bd` command) for AI-native issue tracking. Issues are stored in `.beads/` and tracked in git.

## Essential Commands

### Finding Work

```bash
bd ready              # Show unblocked issues ready to work
bd list --status=open # All open issues
bd show <id>          # Full issue details with dependencies
```

### Tracking Progress

```bash
bd update <id> --status in_progress  # Claim an issue
bd close <id>                        # Mark complete
bd close <id1> <id2>                 # Close multiple at once
bd close <id> --reason="Completed"   # Close with reason
```

### Creating Issues

```bash
bd create --title="..." --type=task --priority=2
```

### Dependencies

```bash
bd dep add <issue> <depends-on>  # Add dependency
bd blocked                       # Show all blocked issues
```

### Syncing

```bash
bd sync               # Commit and sync beads changes
bd sync --from-main   # Pull beads updates from main branch
bd sync --status      # Check sync status
```

## Issue Properties

### Priority Levels

Use numbers 0-4, not words:

| Priority | Meaning |
|----------|---------|
| P0 (0) | Critical |
| P1 (1) | High |
| P2 (2) | Medium |
| P3 (3) | Low |
| P4 (4) | Backlog |

### Issue Types

`task`, `bug`, `feature`, `epic`, `question`, `docs`

## Integration Points

### Session Start

Run `bd ready` to find actionable work. Mention available issues and ask which to work on.

### During Work

When you start working on an issue, update its status to `in_progress`. As you discover new tasks or follow-up work, create new issues with appropriate priority and type.

### Session End

Before completing any session:
1. Run quality checks (`pnpm test`, `pnpm lint:fix`, `pnpm format:fix`)
2. Run `bd sync` to commit beads changes
3. Ensure all code is committed and pushed
4. Check `git status` to verify everything is up to date

## Example Session Flow

```bash
# 1. Start - Check what's available
bd ready

# 2. Claim - Update status when starting work
bd update webrun-vcs-123 --status in_progress

# 3. Work - Implement the task
# ... code changes ...

# 4. Create - File new issues discovered during work
bd create --title="Add tests for new delta function" --type=task --priority=2

# 5. Complete - Close finished work
bd close webrun-vcs-123

# 6. Verify - Run tests, linting, and formatting
pnpm test
pnpm lint:fix
pnpm format:fix

# 7. Sync - Commit and push everything
bd sync
git add .
git commit -m "Implement delta function"
git push
```

## Best Practices

**Always check `bd ready` at session start** to understand available work and project priorities.

**Update issue status as you work** so the project state stays current. Move issues to `in_progress` when you start, close them when done.

**Create issues for discovered work** rather than silently doing extra tasks. This maintains project visibility and helps with planning.

**Run quality checks before every commit** - execute `pnpm test`, `pnpm lint:fix`, and `pnpm format:fix` to ensure code passes all tests and follows project standards.
