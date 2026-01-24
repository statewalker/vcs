# Claude Code Project Guidelines

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
After each Beads epic or logically independent task:

```bash
pnpm test && pnpm typecheck && pnpm lint:fix && pnpm format:fix  # Quality gates
git add <files> && git commit -m "..."                            # Commit
git push                                                          # Push immediately
```

Before ending any session, ensure all work is committed and pushed.

**[Full Guide](.claude/workflows/session-protocol.md)**
