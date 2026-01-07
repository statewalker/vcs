# Planning Organization

Accepted implementation plans are stored in `planning/` and tracked by git, making them part of the project's permanent record.

## Location

```
planning/{YYYY-MM-DD}/{CC}-[{project}]-{subject}.md
```

## Format Components

| Component | Description | Example |
|-----------|-------------|---------|
| `YYYY-MM-DD` | Date folder grouping by approval date | `2025-12-22` |
| `CC` | Counter, resets to `01` daily | `01`, `02` |
| `[{project}]` | Optional project tag in brackets (kebab-case) | `[vcs-refactoring]` |
| `{subject}` | Topic in kebab-case | `implementation-plan` |

## Examples

```
planning/2025-12-22/01-[vcs-refactoring]-implementation-plan.md
planning/2025-12-22/02-migration-strategy.md
planning/2025-12-23/01-[api-design]-endpoint-structure.md
```

## Workflow

Plans typically start as exploration notes in `notes/src/`. Once a plan is validated and approved by the team, move it to `planning/` so it becomes part of the tracked codebase.

```
notes/src/2025-12-20/03-[vcs]-api-exploration.md  # Draft
    ↓ (approved)
planning/2025-12-22/01-[vcs]-api-design.md        # Final
```

## What Belongs Here

- Implementation plans for features
- Architecture decisions
- Migration strategies
- API design documents
- Approved technical proposals

## What Doesn't Belong Here

- Work-in-progress exploration (use `notes/src/`)
- Meeting notes (use `notes/src/`)
- Bug investigations (use issue tracker)
