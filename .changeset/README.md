# Changesets Workflow

This monorepo uses [Changesets](https://github.com/changesets/changesets) to manage versioning and releases for the @statewalker/vcs-* packages.

## Quick Start

When you make changes that should be released, create a changeset to describe what changed:

```bash
pnpm changeset
```

This interactive command will ask you:

1. Which packages have changed
2. What type of version bump (patch/minor/major)
3. A summary of the changes

The command creates a markdown file in `.changeset/` describing your changes.

## Version Types

Choose the appropriate version bump based on the change type:

- **patch** (0.0.X): Bug fixes, documentation updates, internal refactoring
- **minor** (0.X.0): New features that are backwards-compatible
- **major** (X.0.0): Breaking changes to the public API

## Creating a Changeset

After making code changes:

```bash
# Create a new changeset interactively
pnpm changeset

# Example output:
# 🦋 What kind of change is this for @statewalker/vcs-core? (major/minor/patch)
# 🦋 Please enter a summary for this change
```

Each changeset file looks like:

```markdown
---
"@statewalker/vcs-core": minor
"@statewalker/vcs-utils": patch
---

Add new delta compression algorithm with improved performance
```

## Release Workflow

### For Maintainers

When ready to release:

```bash
# 1. Update package versions based on changesets
pnpm version

# 2. Review the version bumps and CHANGELOG.md updates

# 3. Commit the version changes
git add .
git commit -m "Version packages"

# 4. Build and publish to npm
pnpm release
```

The `pnpm version` command:

- Consumes all changeset files in `.changeset/`
- Updates package.json versions appropriately
- Updates or creates CHANGELOG.md files

The `pnpm release` command:

- Builds all packages
- Publishes updated packages to npm

### For Contributors

1. Make your code changes
2. Run `pnpm changeset` before committing
3. Commit both your changes and the changeset file
4. Open a pull request

The maintainers will handle versioning and publishing.

## Package Structure

Published packages in this monorepo:

- `@statewalker/vcs-core` - Core VCS functionality
- `@statewalker/vcs-utils` - Utility functions
- `@statewalker/vcs-commands` - High-level VCS commands
- `@statewalker/vcs-transport` - Network transport layer
- `@statewalker/vcs-sandbox` - Sandboxed execution environment
- `@statewalker/vcs-store-mem` - In-memory storage backend
- `@statewalker/vcs-store-kv` - Key-value storage backend
- `@statewalker/vcs-store-sql` - SQL storage backend

Internal packages (not published):

- `@statewalker/vcs-testing` - Test utilities
- `@statewalker/vcs-storage-tests` - Storage backend tests
- Example apps in `apps/`

## Common Scenarios

### Bug fix in a single package

```bash
pnpm changeset
# Select the affected package
# Choose "patch"
# Write: "Fix issue with delta calculation edge case"
```

### New feature across multiple packages

```bash
pnpm changeset
# Select all affected packages
# Choose "minor" for packages with new APIs
# Choose "patch" for packages with internal updates only
# Write: "Add streaming support for large file operations"
```

### Breaking change

```bash
pnpm changeset
# Select the affected package
# Choose "major"
# Write: "Remove deprecated `oldMethod()` in favor of `newMethod()`"
```

## Tips

- Create one changeset per logical change, not per commit
- Multiple changesets can exist before a release
- If unsure about version type, err on the side of caution (minor over patch)
- Changesets are consumed during `pnpm version`, so they disappear after release
