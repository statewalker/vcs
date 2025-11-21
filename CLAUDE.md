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
