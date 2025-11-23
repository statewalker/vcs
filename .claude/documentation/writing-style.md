# Documentation Writing Style Guide

**Based on analysis of D3.js and Observable Plot documentation**

## Core Principles

**Human-centered tone**: Write as if explaining to a colleague. Confident and clear without being formal or condescending.

**Progressive complexity**: Start simple, reveal depth gradually. Let readers stop when they've learned enough.

**Action-oriented**: Focus on what readers will *do* and *accomplish*, not what the library *has*.

**Visual first**: Show examples and diagrams before explanations. Prove value immediately.

**Narrative over lists**: Default to prose paragraphs. Use bullet points only for API reference, validation requirements, or checklists.

**Plain text formatting**: Avoid special characters and emojis (like ✅, ❌, 📖) in documentation. Use clear text labels like "GOOD", "AVOID", "Prefer", "Before/After" instead.

## Writing Patterns

### Introducing Concepts

1. Start with relatable scenario
2. Show the solution in code
3. Explain what's happening
4. Reveal underlying concept

Example:
> Imagine you're comparing two versions of a file to find what changed. The Myers diff algorithm finds the shortest sequence of edits:
>
> ```typescript
> const diff = computeDiff(oldLines, newLines);
>
> for (const edit of diff) {
>   if (edit.type === 'delete') {
>     console.log(`- ${edit.text}`);
>   } else if (edit.type === 'insert') {
>     console.log(`+ ${edit.text}`);
>   }
> }
> ```
>
> Each edit represents a single change. Deletions show lines removed from the original. Insertions show new lines added. The algorithm finds the minimal set of operations to transform one file into another.

### Explaining Features

Pattern: **[Feature] helps you [accomplish goal]. When [situation], you can [action]. This means [concrete benefit].**

Example:
> Binary delta compression helps you minimize storage overhead. When you're tracking file versions, you can store just the differences instead of full copies. This means a repository with hundreds of commits stays compact rather than growing linearly with each change.

### Code Examples

Keep minimal and focused. Code should be self-explanatory. Avoid excessive comments:

```typescript
// GOOD - clear and minimal
function applyHunk(content: string, hunk: Hunk): string {
  const lines = content.split('\n');
  const result = lines.slice(0, hunk.oldStart);

  for (const change of hunk.changes) {
    if (change.type === 'insert') {
      result.push(change.content);
    }
  }

  return result.concat(lines.slice(hunk.oldStart + hunk.oldLines)).join('\n');
}

// AVOID - over-commented
function applyHunk(content: string, hunk: Hunk): string {
  const lines = content.split('\n'); // Split content into array of lines
  const result = lines.slice(0, hunk.oldStart); // Keep lines before the hunk

  for (const change of hunk.changes) { // Iterate through all changes
    if (change.type === 'insert') { // Check if it's an insertion
      result.push(change.content); // Add the new line
    }
  }
  // Append remaining lines after the modified section
  return result.concat(lines.slice(hunk.oldStart + hunk.oldLines)).join('\n');
}
```

### Headers

Use headers to guide navigation, not enumerate steps.

**Prefer:** "Computing File Differences"
**Avoid:** "Step 1: Diff Algorithm Implementation"

### Links

Embed links naturally in sentences:

**Prefer:**
> Object IDs use [SHA-1 hashing](link), while packed objects rely on [delta compression](link).

**Avoid:**
> **See also:**
> - Hash Algorithm Details
> - Compression Techniques

### Paragraphs Over Bullets

Default to prose. Use lists only for:
- API parameters in reference docs
- Specific validation requirements
- Quick verification checklists

Even then, consider whether narrative text might work better.

## Tone Markers

### Use
- Clear statements: "This does X," "You can Y"
- Natural transitions: "Now," "Next," "Once," "When"
- Direct address: "You'll find," "Your code"
- Conversational rhythm: Mix sentence lengths, use contractions naturally

### Avoid
- Excessive enthusiasm: "Amazing!", "Awesome!"
- Hedge words: "basically," "simply," "just," "easy"
- Over-qualification: "Note that," "It should be noted"
- Marketing speak: "powerful," "robust," "enterprise-grade"

## Before Publishing Checklist

- [ ] Opens with user benefit or concrete scenario (not abstract definition)
- [ ] Uses active voice and action-oriented language
- [ ] Shows example before detailed explanation
- [ ] Integrates lists and links naturally into prose
- [ ] Headers describe content (not numbered steps)
- [ ] Code examples are minimal and focused
- [ ] Technical details revealed progressively
- [ ] Reads naturally when spoken aloud
- [ ] No excessive bullet points in narrative sections
- [ ] Tone is conversational but confident
- [ ] No special characters or emojis (uses plain text labels instead)

## Quick Reference: Before and After

### Parsing Git Patches

**BEFORE:**
> ## Parsing Patches
>
> Patches are the fundamental building blocks of Git diffs. Follow these steps:
> 1. Extract the file headers
> 2. Parse each hunk
> 3. Identify insertions and deletions

**AFTER:**
> ## Parsing Patches
>
> Think of a patch as a recipe for transforming one file into another. When you run `git diff`, Git shows you lines removed (prefixed with `-`) and lines added (prefixed with `+`). Each hunk represents a continuous block of changes.
>
> Start by reading the hunk header that tells you where changes occur:
> ```typescript
> const match = line.match(/@@ -(\d+),(\d+) \+(\d+),(\d+) @@/);
> const [oldStart, oldLines, newStart, newLines] = match.slice(1);
> ```
>
> These numbers tell you exactly where the old content lived and where the new content goes.

### Computing Edit Distance

**BEFORE:**
> ## Edit Distance
>
> The Myers algorithm computes edit distance.
>
> **Format:** `{ x, y, type }`
>
> **Rules:**
> - x represents position in old file
> - y represents position in new file
> - type is insert, delete, or keep

**AFTER:**
> ## Computing Edit Distance
>
> Files change through a series of edits. The Myers algorithm traces a path through a grid where each step represents keeping, deleting, or inserting a line:
>
> ```typescript
> { x: 5, y: 5, type: 'keep' }    // Line matches in both files
> { x: 5, y: 6, type: 'insert' }  // New line added
> { x: 6, y: 6, type: 'delete' }  // Old line removed
> ```
>
> Read these as: "At position (5,5), both files match. Then we insert a line at y=6. Finally we delete the line at x=6."

---

**Source:** Analysis of D3.js and Observable Plot documentation (2025-11-07)
