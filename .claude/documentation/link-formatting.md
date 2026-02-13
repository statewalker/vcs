# Documentation Link Formatting Rules

## Rule: No .md Extension in Links

**Always omit the `.md` extension** from markdown links in documentation.

### ✅ Correct

```markdown
[Test Documentation](/test)
[Getting Started](/journey/01-getting-started/quick-start)
[Contact Form Tutorial](/journey/03-building/contact-form)
[Framework Integration](/journey/04-mastery/framework-integration)
```

### ❌ Incorrect

```markdown
[Test Documentation](/test.md)
[Getting Started](/journey/01-getting-started/quick-start.md)
[Contact Form Tutorial](/journey/03-building/contact-form.md)
[Framework Integration](/journey/04-mastery/framework-integration.md)
```

## Rationale

- **Cleaner URLs**: More maintainable and readable
- **Platform-agnostic**: Works with various static site generators
- **Web conventions**: Consistent with standard web URL patterns
- **Framework compatibility**: Observable Framework automatically handles `.md` resolution

## Scope

This rule applies to:
- ✅ ALL documentation in `/src` directory
- ✅ Internal cross-references between documentation files
- ✅ Navigation links in headers and menus
- ✅ Inline references within content
- ✅ Footer navigation links
- ✅ Table of contents links

This rule does NOT apply to:
- ❌ Links to external websites
- ❌ Links to raw source files in repository browsers
- ❌ Code examples showing file paths
- ❌ README files outside the `/src` directory

## Examples

### Internal Documentation Links

```markdown
<!-- ✅ Correct -->
See our [Quick Start Guide](/journey/01-getting-started/quick-start) to begin.

Learn more about [Testing](/journey/03-building/testing).

Check the [API Reference](/api) for details.

<!-- ❌ Incorrect -->
See our [Quick Start Guide](/journey/01-getting-started/quick-start.md) to begin.
```

### Navigation Menus

```markdown
<!-- ✅ Correct -->
- [Home](/)
- [Getting Started](/journey/01-getting-started/quick-start)
- [Building](/journey/03-building/project-structure)
- [Mastery](/journey/04-mastery/framework-integration)

<!-- ❌ Incorrect -->
- [Home](/index.md)
- [Getting Started](/journey/01-getting-started/quick-start.md)
```

### Relative Links

```markdown
<!-- ✅ Correct -->
[Previous: Quick Start](./quick-start)
[Next: Multi-Step Wizard](./multi-step-wizard)

<!-- ❌ Incorrect -->
[Previous: Quick Start](./quick-start.md)
[Next: Multi-Step Wizard](./multi-step-wizard.md)
```

## Common Mistakes

### Mistake 1: Adding .md to New Links

When creating new documentation, developers might default to including `.md`:

```markdown
<!-- ❌ Wrong -->
For more details, see [our guide](./new-feature.md).

<!-- ✅ Correct -->
For more details, see [our guide](./new-feature).
```

### Mistake 2: Inconsistent Link Styles

Mixing link styles in the same document:

```markdown
<!-- ❌ Inconsistent -->
- [Page One](/page-one)
- [Page Two](/page-two.md)  <!-- Inconsistent -->
- [Page Three](/page-three)

<!-- ✅ Consistent -->
- [Page One](/page-one)
- [Page Two](/page-two)
- [Page Three](/page-three)
```

### Mistake 3: Copying External Markdown

When copying markdown from external sources that use `.md` extensions:

```markdown
<!-- ❌ Copied from external source -->
Check [their docs](https://example.com/docs/guide.md)
And [our docs](/our-guide.md)  <!-- Don't copy this pattern -->

<!-- ✅ Adapted for our project -->
Check [their docs](https://example.com/docs/guide.md)  <!-- External is fine -->
And [our docs](/our-guide)  <!-- Internal follows our rules -->
```

## Validation

Before committing documentation changes:

```bash
# Search for .md in links (should return no results in /src)
grep -r '\[.*\](.*\.md)' src/

# If results found, remove .md extensions from internal links
```

## Quick Reference

| Link Type | Format | Example |
|-----------|--------|---------|
| Internal page | `/path/to/page` | `/journey/01-getting-started/quick-start` |
| Relative page | `./page` or `../page` | `./contact-form` |
| Section link | `/page#section` | `/api#methods` |
| Root | `/` | `/` |
| External | Full URL | `https://example.com/guide.md` ✅ (OK for external) |
