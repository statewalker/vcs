# Claude Code Project Guidelines

## General Behavior

Do not over-analyze or over-explore before acting. When the task is clear, start implementation immediately. Ask for clarification only when genuinely ambiguous.

## File Operations

When creating notes or documents, always confirm the target directory/path with the user before writing. Never assume the output location.

## Conventions

### Naming
All files and folders use **kebab-case**: `my-component.ts`, `utils/date-formatter.ts`

**[Full Guide](.claude/code/naming-conventions.md)**

### Module Structure
Folder-based exports with wildcard re-exports. Import from `index.js`, use `.js` extensions.

```typescript
// ✅ import { foo } from "../delta/index.js";
// ❌ import { foo } from "../delta/specific-file.js";
```

**[Full Guide](.claude/code/module-structure.md)**

### Documentation Style
Write for humans using narrative prose. Show examples before explanations.

**[Full Guide](.claude/documentation/writing-style.md)**

## Code Quality / Post-Edit Checks

After any refactoring or multi-file edit, run `tsc --noEmit` and fix ALL TypeScript errors (unused imports, type mismatches, missing extends) before reporting completion.

## Testing

When editing existing test files, NEVER overwrite/replace the entire file. Always append or surgically insert new tests alongside existing ones.

## Task Execution

When working from checklist/epic documents, complete ALL items listed — do not skip or forget items. Before reporting done, re-read the checklist and verify every item is addressed.

## Documentation / Notes

When the user asks for structural consistency or formatting conformity in documents, apply it uniformly without arguing — even if some sections seem like they don't need it.

## References

### Source Analysis
Reference implementations (JGit, Fossil) for analyzing patterns and algorithms.

**[Full Guide](.claude/sources.md)**

## Workflows

### Notes
Exploration notes: `notes/src/YYYY-MM-DD/CC-[project]-subject.md`

**[Full Guide](.claude/workflows/note-organization.md)**

### Planning
Approved plans: `planning/YYYY-MM-DD/CC-[project]-subject.md`

**[Full Guide](.claude/workflows/planning-organization.md)**

### Issue Tracking (Beads)
Use `bd` for AI-native issue tracking:

```bash
bd ready                                  # Find available work
bd update <id> --status in_progress       # Claim issue
bd close <id>                             # Complete work
bd create --title="..." --type=task --priority=2
```

**[Full Guide](.claude/workflows/beads-integration.md)**

### Session Protocol
Before ending any session:

```bash
pnpm test && pnpm lint:fix && pnpm format:fix  # Quality gates
bd sync                                         # Sync beads
git add . && git commit -m "..."               # Commit
git push                                        # MANDATORY
```

**[Full Guide](.claude/workflows/session-protocol.md)**

## Project-Specific Tools

Beads CLI is installed via the project's own install script, not npm/pip. For Jira URLs, use the format: `https://<domain>/browse/<ISSUE-KEY>`
