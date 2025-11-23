# Claude AI Assistant Instructions

## Project Context

This is the **Statewalker FSM documentation site**. Follow project conventions strictly.

---

## Core Workflow Rules

### Note Organization

All exploration and planning notes: `notes/src/YYYY-MM-DD/CC-[project]-subject.md`

**Format:** `notes/src/{YYYY-MM-DD}/{CC}-[{project}]-{subject}.md`
- Store in `notes/src/` - managed by ObservableHQ framework
- Date folder `{YYYY-MM-DD}` groups daily work
- Counter `{CC}` resets to `01` daily
- Optional project tag `[{project}]` in brackets (kebab-case)
- Subject in kebab-case

**Examples:**
- `notes/src/2025-11-07/01-[doc-refactoring]-process-analysis.md`
- `notes/src/2025-11-07/02-architecture-exploration.md` (no project)
- `notes/src/2025-11-07/03-[validation]-fixes-applied.md`

**Why `notes/src/`:** The notes are visualized using ObservableHQ Framework, which treats `src/` as the documentation root.

### Documentation Link Formatting

**Always omit `.md` extension** from documentation links:

**Correct:**
```markdown
[Quick Start](/journey/01-getting-started/quick-start)
[Contact Form](/journey/03-building/contact-form)
```

**Incorrect:**
```markdown
[Quick Start](/journey/01-getting-started/quick-start.md)
[Contact Form](/journey/03-building/contact-form.md)
```

**Why:** Cleaner URLs, platform-agnostic, Observable Framework compatibility

**[Full Guidelines](.claude/documentation/link-formatting.md)**

### Documentation Writing Style

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
## Module Imports

Imports are essential. Follow these steps:
1. Create an index.ts file
2. Add wildcard exports
3. Import from the index
```

**Prefer:**
```markdown
## Organizing Module Exports

Each folder acts as a self-contained module with its own public interface. When you create a new feature folder like `delta/`, think of `index.ts` as its front door—it controls what gets exposed to the rest of your codebase.

Start by creating an `index.ts` that exports everything:

```typescript
// src/delta/index.ts
export * from "./apply-delta.js";
export * from "./create-delta.js";
```

Now other modules import from the folder, not individual files:

```typescript
import { applyDelta } from "../delta/index.js";
```
```

**[Full Writing Style Guide](.claude/documentation/writing-style.md)**

