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
