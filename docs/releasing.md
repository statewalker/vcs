# Releasing Packages

This guide covers how to version and publish packages in the StateWalker VCS monorepo using [Changesets](https://github.com/changesets/changesets).

## Overview

The release workflow follows three phases:

1. **Document changes** - Create changesets as you develop
2. **Version packages** - Bump versions and generate changelogs
3. **Publish to npm** - Build and publish updated packages

## For Contributors

### Creating a Changeset

After making changes that should be released, create a changeset:

```bash
pnpm changeset
```

The interactive prompt asks:

1. **Which packages changed?** - Select affected packages with spacebar
2. **What type of change?** - Choose major/minor/patch for each
3. **Summary** - Describe what changed and why

This creates a markdown file in `.changeset/` that gets committed with your code.

### Version Bump Guidelines

Choose the version type based on what changed:

| Type | When to use | Example |
|------|-------------|---------|
| **patch** | Bug fixes, docs, internal refactoring | Fix delta calculation edge case |
| **minor** | New features, backwards-compatible changes | Add streaming support for large files |
| **major** | Breaking changes to public API | Remove deprecated `oldMethod()` |

### Example Workflow

```bash
# 1. Make your code changes
git checkout -b feature/streaming-blobs

# 2. Before committing, create a changeset
pnpm changeset

# 3. Commit both code and changeset
git add .
git commit -m "Add streaming blob support"

# 4. Push and open PR
git push -u origin feature/streaming-blobs
```

The changeset file looks like:

```markdown
---
"@statewalker/vcs-core": minor
"@statewalker/vcs-utils": patch
---

Add streaming support for large blob operations. The utils package
receives internal optimizations to support the new streaming API.
```

## For Maintainers

### Manual Release Process

When ready to release accumulated changesets:

```bash
# 1. Update versions and changelogs
pnpm version

# 2. Review the changes
git diff

# 3. Commit version updates
git add .
git commit -m "chore: version packages"

# 4. Build and publish
pnpm release

# 5. Push commits and tags
git push --follow-tags
```

The `pnpm version` command:

- Consumes all `.changeset/*.md` files
- Updates `package.json` versions across affected packages
- Creates or updates `CHANGELOG.md` in each package
- Handles dependency version updates automatically

The `pnpm release` command:

- Runs `pnpm build` to build all packages
- Runs `changeset publish` to publish to npm

### Automated Releases (CI/CD)

GitHub Actions automates the release process:

1. When changesets are merged to `main`, CI creates a "Version Packages" PR
2. The PR accumulates multiple changesets into a single version bump
3. When the version PR is merged, CI publishes to npm automatically

The workflow is defined in `.github/workflows/release.yml`.

### Pre-release Versions

For alpha/beta releases:

```bash
# Enter pre-release mode
pnpm changeset pre enter alpha

# Create changesets as normal
pnpm changeset

# Version (creates 0.2.0-alpha.0)
pnpm version

# Exit pre-release mode when ready
pnpm changeset pre exit
```

## Package Publishing Status

### Published Packages

These packages are public on npm:

| Package | Description |
|---------|-------------|
| `@statewalker/vcs-core` | Repository, stores, staging, pack files |
| `@statewalker/vcs-utils` | Hashing, compression, diff algorithms |
| `@statewalker/vcs-commands` | High-level Git operations |
| `@statewalker/vcs-transport` | Git protocols (HTTP smart protocol) |
| `@statewalker/vcs-sandbox` | Isolated storage utilities |
| `@statewalker/vcs-store-mem` | In-memory storage backend |
| `@statewalker/vcs-store-kv` | Key-value storage backend |
| `@statewalker/vcs-store-sql` | SQL storage backend |

### Private Packages

These packages are internal and not published:

- `@statewalker/vcs-testing` - Test utilities
- `@statewalker/vcs-storage-tests` - Storage backend tests
- All apps in `apps/` directory

## npm Configuration

### Required Setup

To publish, you need:

1. **npm account** with access to the `@statewalker` scope
2. **NPM_TOKEN** secret configured in GitHub repository settings

### Local Publishing

For one-time local publishing:

```bash
# Login to npm
npm login

# Verify access
npm whoami

# Publish (after versioning)
pnpm release
```

## Troubleshooting

### "No changesets found"

If `pnpm version` reports no changesets:

- Verify `.changeset/` contains markdown files (not just config)
- Check that changesets reference valid package names

### "Package not found in registry"

For first-time publishing of a new package:

```bash
# Publish with public access (required for scoped packages)
npm publish --access public
```

### Version Conflicts

If versions get out of sync:

```bash
# Check current versions
pnpm -r exec -- npm pkg get name version

# Manually fix package.json versions if needed
```

## Best Practices

**One changeset per logical change.** Don't create a changeset per commit. Group related changes into a single changeset that describes the feature or fix.

**Write meaningful summaries.** The changeset description appears in CHANGELOG.md. Write for users who want to understand what changed.

**Don't skip changesets for user-facing changes.** Internal refactoring might not need a changeset, but any change to public APIs, behavior, or bug fixes should have one.

**Review the version PR.** Before merging the automated version PR, review the changelog entries and version bumps to ensure they make sense.
