# Claude Code Project Guidelines

## File and Folder Naming Conventions

All files and folders in this project **MUST** use **kebab-case** naming convention.

### ✅ GOOD Examples:
- `project-dir/my-script.ts`
- `components/user-profile.tsx`
- `utils/date-formatter.ts`
- `tests/create-delta-ranges.test.ts`

### ❌ BAD Examples:
- `projectDir/MyScript.ts` (camelCase directory, PascalCase file)
- `ProjectDir/myScript.ts` (PascalCase directory, camelCase file)
- `components/UserProfile.tsx` (PascalCase file)
- `utils/dateFormatter.ts` (camelCase file)

### Rules:
- **Files**: Always use `kebab-case.ts`, `kebab-case.tsx`, `kebab-case.test.ts`, etc.
- **Folders**: Always use `kebab-case/` for directory names
- **Constants**: Lowercase with hyphens separating words
- **Test files**: Follow pattern `feature-name.test.ts` or `feature-name.spec.ts`

This convention ensures consistency across the codebase and aligns with modern web development best practices.

## Module Structure and Imports

All modules follow a consistent structure with **folder-based exports** and **wildcard re-exports**.

### Key Rules:
- **Each folder has index.ts** - Every source folder must contain an `index.ts` file
- **Wildcard exports only** - Use `export *` in all index files, not named exports
- **Import from folder index** - Cross-folder imports must reference `index.js`, not specific files
- **Use .js extensions** - All imports use `.js` extension (not `.ts`), following ES module conventions

### Quick Examples:

**Index file (wildcard exports):**
```typescript
// src/delta/index.ts
export * from "./apply-delta.js";
export * from "./create-delta.js";
export * from "./types.js";
```

**Cross-folder import:**
```typescript
// ✅ GOOD
import { weakChecksum } from "../delta/index.js";

// ❌ BAD
import { weakChecksum } from "../delta/create-fossil-ranges.js";
```

**[Full Module Structure Guide](.claude/code/module-structure.md)**

## Documentation Writing Style

**Write for humans, not AI readers.** Use narrative prose instead of bullet points and numbered lists.

**Core principles:**
- **Conversational tone** - Explain as if talking to a colleague
- **Action-oriented** - Focus on what readers will *do* and *accomplish*
- **Visual first** - Show examples before explanations
- **Progressive complexity** - Start simple, reveal depth gradually
- **Narrative over lists** - Default to prose paragraphs

**Quick example:**

**Avoid:**
```markdown
## States

States are building blocks. Follow these steps:
1. Choose a unique key
2. Define transitions
3. Add nested states
```

**Prefer:**
```markdown
## Defining States

Think of states as snapshots of your process. When an order arrives, it might be "AwaitingPayment." After the customer pays, it transitions to "ProcessingOrder."

Give each state a unique `key` in PascalCase:
{/* code example */}
```

**[Full Writing Style Guide](.claude/documentation/writing-style.md)**

### Note Organization

All exploration and planning notes: `notes/src/YYYY-MM-DD/CC-[project]-subject.md`

**Format:** `notes/src/{YYYY-MM-DD}/{CC}-[{project}]-{subject}.md`
- Store in `notes/src/` - managed by ObservableHQ framework
- Date folder `{YYYY-MM-DD}` groups daily work
- Counter `{CC}` resets to `01` daily
- Optional project tag `[{project}]` in brackets (kebab-case)
- Subject in kebab-case

**Examples:**
- `notes/src/2025-11-07/01-[doc-refactoring]-process-analysis.md`
- `notes/src/2025-11-07/02-architecture-exploration.md` (no project)
- `notes/src/2025-11-07/03-[fsm-validation]-fixes-applied.md`

**[Full Guidelines](.claude/workflows/note-organization.md)**

## Beads Issue Tracking Integration

This project uses **Beads** for AI-native issue tracking. Claude Code should integrate with beads throughout development sessions.

### Core Workflow

When starting a session, check for available work using `bd ready` to see issues with no blockers. As you work on issues, update their status to track progress. When you discover new tasks during implementation, create issues to capture them. At the end of each session, sync changes with `bd sync`.

### Essential Commands

**Finding work:**
```bash
bd ready              # Show unblocked issues ready to work
bd show <id>          # View full issue details
```

**Tracking progress:**
```bash
bd update <id> --status in_progress  # Claim an issue
bd close <id>                        # Mark complete
bd create --title="..." --type=task --priority=2  # Create new issue
```

**Session completion:**
```bash
bd sync               # Commit and sync beads changes
git push              # Always push at session end
```

### Integration Points

**Session Start** - Run `bd ready` to find actionable work. Mention available issues to the user and ask which to work on.

**During Work** - When you start working on an issue, update its status to `in_progress`. As you discover new tasks or follow-up work, create new issues with appropriate priority and type.

**Session End** - Before completing any session, run `bd sync` to commit beads changes, then ensure all code is committed and pushed. Check `git status` to verify everything is up to date with origin.

### Issue Management

**Priority levels:** P0=critical, P1=high, P2=medium, P3=low, P4=backlog (use numbers 0-4, not words)

**Issue types:** task, bug, feature, epic, question, docs

**Dependencies:** Issues can block others. `bd ready` automatically filters to show only unblocked work.

### Example Session Flow

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

# 6. Sync - Commit and push everything
bd sync
git add .
git commit -m "Implement delta function"
git push
```

### Best Practices

**Always check `bd ready` at session start** to understand available work and project priorities.

**Update issue status as you work** so the project state stays current. Move issues to `in_progress` when you start, close them when done.

**Create issues for discovered work** rather than silently doing extra tasks. This maintains project visibility and helps with planning.

**Never end a session without syncing** - run `bd sync` and `git push` to ensure all changes (both code and issues) are persisted to the remote repository.
