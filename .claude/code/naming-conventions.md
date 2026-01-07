# File and Folder Naming Conventions

All files and folders in this project use **kebab-case** naming convention exclusively.

## Why Kebab-Case?

Kebab-case provides consistency across the codebase and aligns with modern web development best practices. It's readable, URL-friendly, and avoids case-sensitivity issues across different operating systems.

## Examples

**Files:**
```
project-dir/my-script.ts
components/user-profile.tsx
utils/date-formatter.ts
tests/create-delta-ranges.test.ts
```

**Avoid:**
```
projectDir/MyScript.ts      # camelCase directory, PascalCase file
ProjectDir/myScript.ts      # PascalCase directory, camelCase file
components/UserProfile.tsx  # PascalCase file
utils/dateFormatter.ts      # camelCase file
```

## Detailed Rules

### Files

Always use lowercase with hyphens separating words:
- Source files: `feature-name.ts`, `component-name.tsx`
- Test files: `feature-name.test.ts` or `feature-name.spec.ts`
- Configuration: `config-name.json`, `settings-file.yaml`

### Folders

Directory names follow the same pattern:
- `src/delta-operations/`
- `tests/integration-tests/`
- `components/user-interface/`

### Constants and Variables

File and folder names use kebab-case, but TypeScript identifiers follow standard conventions:
- Variables: `camelCase`
- Constants: `SCREAMING_SNAKE_CASE` or `camelCase`
- Classes: `PascalCase`
- Types/Interfaces: `PascalCase`

## Migration

When renaming existing files to follow this convention:

1. Use `git mv` to preserve history
2. Update all imports referencing the renamed file
3. Run the build to verify no broken imports
