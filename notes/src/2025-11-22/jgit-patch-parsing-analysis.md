# JGit Patch Parsing Analysis

## Executive Summary

This document analyzes the JGit patch parsing implementation and proposes a TypeScript implementation plan that integrates with the existing webrun-vcs diff/patch infrastructure. JGit provides a comprehensive, production-grade implementation for parsing Git's unified diff format, including binary patches, text hunks, and metadata extraction.

## Table of Contents

1. [Overview of JGit Patch Architecture](#overview-of-jgit-patch-architecture)
2. [Core Algorithms](#core-algorithms)
3. [Implementation Details](#implementation-details)
4. [TypeScript Implementation Plan](#typescript-implementation-plan)
5. [Integration with Existing Codebase](#integration-with-existing-codebase)
6. [References](#references)

---

## Overview of JGit Patch Architecture

### File Structure

JGit organizes patch parsing into several specialized classes:

```
org.eclipse.jgit.patch/
├── Patch.java              # Main entry point, orchestrates parsing
├── FileHeader.java         # Parses file-level metadata
├── HunkHeader.java         # Parses and applies text hunks
├── BinaryHunk.java         # Handles binary patch data
├── PatchApplier.java       # Applies patches to files/index
├── FormatError.java        # Error tracking
├── CombinedFileHeader.java # Merge commit diffs
└── CombinedHunkHeader.java # Combined hunks
```

### Key Design Principles

1. **Incremental Parsing**: Parse patch data as byte arrays with offset tracking
2. **Zero-Copy**: Use buffer offsets instead of creating substrings
3. **Streaming**: Process patches line-by-line without loading entire content
4. **Error Recovery**: Collect errors without failing completely
5. **Format Detection**: Auto-detect patch format (git, traditional, combined)

---

## Core Algorithms

### 1. Patch Entry Point Algorithm

**Location**: [Patch.java:143-146](Patch.java)

```java
public void parse(byte[] buf, int ptr, int end) {
    while (ptr < end)
        ptr = parseFile(buf, ptr, end);
}
```

**Algorithm**:
1. Read input into byte array
2. Scan for file headers
3. For each file, parse headers and hunks
4. Track errors but continue parsing

**Key Decision Points**:
- Detect `diff --git` → Git format
- Detect `diff --cc` → Combined diff (merge)
- Detect `--- ` and `+++ ` → Traditional patch
- Detect disconnected hunks → Error but continue

### 2. File Header Parsing Algorithm

**Location**: [FileHeader.java:363-421](FileHeader.java)

**Git Filename Parsing** (`parseGitFileName`):
```
Input: "diff --git a/path/to/file b/path/to/file\n"
Algorithm:
1. Find first '/' after start (aStart)
2. Scan for space character
3. Find second '/' after space (bStart)
4. Compare buffer[aStart..sp-1] == buffer[bStart..eol-1]
5. If equal, extract path (handles quoted paths)
6. Handle C-style quoted strings with QuotedString.GIT_PATH
```

**Git Headers Parsing** (`parseGitHeaders`):
```
Loop until hunk or end:
  Match header type:
    - "old mode " → Parse file mode
    - "new mode " → Parse file mode
    - "deleted file mode " → Mark as DELETE
    - "new file mode " → Mark as ADD
    - "rename from/to " → Mark as RENAME
    - "copy from/to " → Mark as COPY
    - "similarity index " → Store score
    - "dissimilarity index " → Store score
    - "index " → Parse object IDs
    - "--- " → Parse old name
    - "+++ " → Parse new name
```

### 3. Hunk Header Parsing Algorithm

**Location**: [HunkHeader.java:264-281](HunkHeader.java)

**Header Format**: `@@ -oldStart,oldCount +newStart,newCount @@`

**Parsing Steps**:
1. Skip `@@` prefix and space
2. Parse `-oldStart` (negative number)
3. If comma, parse `,oldCount`, else oldCount = 1
4. Parse `+newStart`
5. If comma, parse `,newCount`, else newCount = 1

**Body Parsing** ([HunkHeader.java:283-347](HunkHeader.java)):
```
For each line:
  Switch on first character:
    ' ' or '\n' → Context line (nContext++)
    '-' → Deletion (nDeleted++)
    '+' → Addition (nAdded++)
    '\' → "No newline at end of file" marker
    other → End of hunk

Validation:
  - Verify nContext + nDeleted == lineCount
  - Verify nContext + nAdded == newLineCount
  - Report errors but continue
```

### 4. Binary Hunk Parsing Algorithm

**Location**: [BinaryHunk.java:109-141](BinaryHunk.java)

**Format Detection**:
```
"literal <size>\n" → LITERAL_DEFLATED
"delta <size>\n"   → DELTA_DEFLATED
```

**Parsing**:
1. Detect type and parse size
2. Skip to next line
3. Scan until blank line (end of base85 encoded data)
4. Store offsets but don't decode (lazy evaluation)

### 5. Patch Application Algorithm

**Location**: [PatchApplier.java:299-388](PatchApplier.java)

**Main Flow**:
```
For each FileHeader:
  1. Verify file existence constraints
  2. Switch on ChangeType:
     ADD    → Create file, apply hunks
     MODIFY → Apply hunks to existing file
     DELETE → Remove file
     RENAME → Rename, then apply hunks
     COPY   → Copy, then apply hunks
  3. Update DirCache (staging area)
  4. Write tree object
```

**Text Hunk Application** ([PatchApplier.java:918-1100](PatchApplier.java)):

```typescript
// Conceptual algorithm
function applyText(oldLines: ByteBuffer[], hunks: HunkHeader[]): ByteBuffer[] {
  let newLines = [...oldLines]
  let lineNumberShift = 0
  let afterLastHunk = 0

  for (hunk of hunks) {
    // Try to apply at expected position
    let applyAt = hunk.newStartLine - 1 + lineNumberShift

    // Fuzzy matching: try shifting up/down
    let applies = canApplyAt(hunk, newLines, applyAt)
    if (!applies) {
      // Try shifting backwards
      for (shift in 0..maxShift) {
        if (canApplyAt(hunk, newLines, applyAt - shift)) {
          applyAt -= shift
          applies = true
          break
        }
      }
    }
    if (!applies) {
      // Try shifting forwards
      for (shift in 1..maxShift) {
        if (canApplyAt(hunk, newLines, applyAt + shift)) {
          applyAt += shift
          applies = true
          break
        }
      }
    }

    if (!applies) {
      if (allowConflicts) {
        // Insert conflict markers
        insertConflictMarkers(newLines, applyAt, hunk)
      } else {
        return error
      }
    } else {
      // Apply hunk
      for (line of hunk) {
        switch (line[0]) {
          case ' ': applyAt++; break
          case '-': newLines.remove(applyAt); break
          case '+': newLines.insert(applyAt++, line.slice(1)); break
        }
      }
    }

    afterLastHunk = applyAt
  }

  return newLines
}
```

**Binary Hunk Application** ([PatchApplier.java:864-915](PatchApplier.java)):

```typescript
function applyBinary(hunk: BinaryHunk, oldData: Uint8Array): Uint8Array {
  switch (hunk.type) {
    case LITERAL_DEFLATED:
      // 1. Verify old file hash
      // 2. Decode base85
      // 3. Inflate (decompress)
      return inflateStream(decodeBase85(hunk.data))

    case DELTA_DEFLATED:
      // 1. Load old data into memory (needs random access)
      // 2. Decode base85
      // 3. Inflate to get delta instructions
      // 4. Apply delta to old data
      let deltaInstructions = inflateStream(decodeBase85(hunk.data))
      return applyDelta(oldData, deltaInstructions)
  }
}
```

### 6. Fuzzy Hunk Matching Algorithm

**Location**: [PatchApplier.java:972-1006](PatchApplier.java)

This is a sophisticated algorithm that allows patches to apply even when line numbers have changed.

```typescript
function findBestHunkPosition(
  hunk: HunkHeader,
  targetLines: Line[],
  expectedPosition: number,
  afterLastHunk: number
): number {
  const oldLinesInHunk = hunk.contextLines + hunk.deletedLines

  if (oldLinesInHunk <= 1) {
    // No context - can't do fuzzy matching
    if (canApplyAt(hunk, targetLines, expectedPosition)) {
      return expectedPosition
    }
    return -1 // Can't apply
  }

  // Try shifting backwards first (prefer earlier positions)
  const maxBackShift = expectedPosition - afterLastHunk
  for (let shift = 0; shift <= maxBackShift; shift++) {
    if (canApplyAt(hunk, targetLines, expectedPosition - shift)) {
      return expectedPosition - shift
    }
  }

  // Try shifting forwards
  const maxForwardShift = targetLines.length - expectedPosition - oldLinesInHunk
  for (let shift = 1; shift <= maxForwardShift; shift++) {
    if (canApplyAt(hunk, targetLines, expectedPosition + shift)) {
      return expectedPosition + shift
    }
  }

  return -1 // Can't apply anywhere
}
```

---

## Implementation Details

### 1. Buffer Management

**Pattern**: Use byte arrays with offset tracking

```java
class FileHeader {
    final byte[] buf;        // Shared buffer
    final int startOffset;   // Start of this file's data
    int endOffset;           // End of this file's data
}
```

**Benefits**:
- Zero-copy parsing
- Memory efficient
- Fast substring comparisons
- Easy to track exact error positions

### 2. Line Ending Detection

**Location**: [PatchApplier.java:755-784](PatchApplier.java)

```java
private static boolean hasCrLf(FileHeader fh) {
  for (HunkHeader hunk : fh.getHunks()) {
    // Check if any old lines (space or -) end in \r
    if (nextLineStart - lineStart > 1) {
      if (first == ' ' || first == '-') {
        if (buf[nextLineStart - 2] == '\r') {
          return true
        }
      }
    }
  }
  return false
}
```

**Strategy**:
- Check patch content for CRLF
- Check file content for CRLF
- Use appropriate line ending conversion

### 3. Error Handling

**Pattern**: Collect errors, continue parsing

```java
class Patch {
    private final List<FormatError> errors;

    void error(byte[] buf, int ptr, String msg) {
        addError(new FormatError(buf, ptr, Severity.ERROR, msg));
    }

    void warn(byte[] buf, int ptr, String msg) {
        addError(new FormatError(buf, ptr, Severity.WARNING, msg));
    }
}
```

**Error Types**:
- Disconnected hunks
- Truncated hunks
- Header/body mismatch
- Invalid object IDs
- Missing files

### 4. Special Cases

#### Empty Hunks
Handle hunks with `@@ -0,0 +0,0 @@` (clear all content)

#### No Newline Marker
Handle `\ No newline at end of file`

#### Combined Diffs
Support merge conflict diffs with multiple parent columns

#### Quoted Paths
Handle C-style quoted paths with escapes

---

## TypeScript Implementation Plan

### Phase 1: Core Data Structures

**File**: `packages/diff/src/patch/types.ts`

```typescript
export interface PatchOptions {
  allowConflicts?: boolean
  charset?: string
}

export interface FormatError {
  message: string
  offset: number
  severity: 'error' | 'warning'
  line?: number
}

export enum PatchType {
  UNIFIED = 'UNIFIED',
  BINARY = 'BINARY',
  GIT_BINARY = 'GIT_BINARY'
}

export enum ChangeType {
  ADD = 'ADD',
  DELETE = 'DELETE',
  MODIFY = 'MODIFY',
  RENAME = 'RENAME',
  COPY = 'COPY'
}

export enum BinaryHunkType {
  LITERAL_DEFLATED = 'LITERAL_DEFLATED',
  DELTA_DEFLATED = 'DELTA_DEFLATED'
}

export interface FileMode {
  mode: number // Octal: 100644, 100755, 120000, etc.
  isExecutable: boolean
  isSymlink: boolean
}

export interface ObjectId {
  hash: string
  abbreviated: boolean
}
```

### Phase 2: Patch Parser

**File**: `packages/diff/src/patch/patch-parser.ts`

```typescript
export class Patch {
  private files: FileHeader[] = []
  private errors: FormatError[] = []

  parse(input: Uint8Array | string): void {
    const buf = typeof input === 'string'
      ? new TextEncoder().encode(input)
      : input

    let ptr = 0
    while (ptr < buf.length) {
      ptr = this.parseFile(buf, ptr)
    }
  }

  private parseFile(buf: Uint8Array, ptr: number): number {
    // Detect format
    if (matchBytes(buf, ptr, DIFF_GIT)) {
      return this.parseDiffGit(buf, ptr)
    }
    if (matchBytes(buf, ptr, DIFF_CC)) {
      return this.parseDiffCombined(buf, ptr, DIFF_CC)
    }
    if (matchBytes(buf, ptr, OLD_NAME)) {
      return this.parseTraditionalPatch(buf, ptr)
    }

    // Skip unknown lines
    return nextLF(buf, ptr)
  }

  getFiles(): FileHeader[] {
    return this.files
  }

  getErrors(): FormatError[] {
    return this.errors
  }
}
```

### Phase 3: File Header Parser

**File**: `packages/diff/src/patch/file-header.ts`

```typescript
export class FileHeader {
  public readonly buffer: Uint8Array
  public readonly startOffset: number
  public endOffset: number

  public oldPath: string = ''
  public newPath: string = ''
  public oldMode: FileMode | null = null
  public newMode: FileMode | null = null
  public oldId: ObjectId | null = null
  public newId: ObjectId | null = null
  public changeType: ChangeType = ChangeType.MODIFY
  public patchType: PatchType = PatchType.UNIFIED
  public score: number = 0

  private hunks: HunkHeader[] = []
  public forwardBinaryHunk: BinaryHunk | null = null
  public reverseBinaryHunk: BinaryHunk | null = null

  parseGitFileName(ptr: number, end: number): number {
    // Implementation matches JGit algorithm
    const eol = nextLF(this.buffer, ptr)
    const aStart = nextChar(this.buffer, ptr, '/')

    // ... find matching a/path b/path pattern
    // ... handle quoted strings

    return eol
  }

  parseGitHeaders(ptr: number, end: number): number {
    while (ptr < end) {
      const eol = nextLF(this.buffer, ptr)

      if (isHunkHeader(this.buffer, ptr)) {
        break // Start of hunks
      }

      // Match each header type
      if (matchBytes(this.buffer, ptr, OLD_MODE)) {
        this.oldMode = parseFileMode(this.buffer, ptr + OLD_MODE.length)
      } else if (matchBytes(this.buffer, ptr, NEW_MODE)) {
        this.newMode = parseFileMode(this.buffer, ptr + NEW_MODE.length)
      }
      // ... etc for all header types

      ptr = eol
    }
    return ptr
  }

  getHunks(): HunkHeader[] {
    return this.hunks
  }

  addHunk(hunk: HunkHeader): void {
    this.hunks.push(hunk)
  }
}
```

### Phase 4: Hunk Header Parser

**File**: `packages/diff/src/patch/hunk-header.ts`

```typescript
export class HunkHeader {
  public readonly file: FileHeader
  public readonly startOffset: number
  public endOffset: number

  public oldStartLine: number = 0
  public oldLineCount: number = 0
  public newStartLine: number = 0
  public newLineCount: number = 0

  public linesDeleted: number = 0
  public linesAdded: number = 0
  public linesContext: number = 0

  private editList: Edit[] | null = null

  parseHeader(): void {
    // Parse "@@ -236,9 +236,9 @@" format
    const buf = this.file.buffer
    let ptr = nextChar(buf, this.startOffset, ' ') // Skip "@@"

    this.oldStartLine = -parseBase10(buf, ptr)
    if (buf[ptr] === ','.charCodeAt(0)) {
      this.oldLineCount = parseBase10(buf, ptr + 1)
    } else {
      this.oldLineCount = 1
    }

    // Similar for new start/count
  }

  parseBody(patch: Patch, end: number): number {
    const buf = this.file.buffer
    let ptr = nextLF(buf, this.startOffset)

    while (ptr < end) {
      const ch = String.fromCharCode(buf[ptr])

      switch (ch) {
        case ' ':
        case '\n':
          this.linesContext++
          break
        case '-':
          this.linesDeleted++
          break
        case '+':
          this.linesAdded++
          break
        case '\\':
          // No newline marker
          break
        default:
          // End of hunk
          return ptr
      }

      ptr = nextLF(buf, ptr)
    }

    // Validate counts
    this.validate(patch)

    return ptr
  }

  toEditList(): Edit[] {
    if (this.editList !== null) {
      return this.editList
    }

    this.editList = []
    const buf = this.file.buffer
    let ptr = nextLF(buf, this.startOffset)
    let oldLine = this.oldStartLine
    let newLine = this.newStartLine
    let currentEdit: Edit | null = null

    while (ptr < this.endOffset) {
      const ch = String.fromCharCode(buf[ptr])

      switch (ch) {
        case ' ':
        case '\n':
          currentEdit = null
          oldLine++
          newLine++
          break

        case '-':
          if (!currentEdit) {
            currentEdit = new Edit(oldLine - 1, newLine - 1)
            this.editList.push(currentEdit)
          }
          oldLine++
          currentEdit.extendA()
          break

        case '+':
          if (!currentEdit) {
            currentEdit = new Edit(oldLine - 1, newLine - 1)
            this.editList.push(currentEdit)
          }
          newLine++
          currentEdit.extendB()
          break

        case '\\':
          // No newline marker
          break

        default:
          return this.editList
      }

      ptr = nextLF(buf, ptr)
    }

    return this.editList
  }
}

export class Edit {
  constructor(
    public beginA: number,
    public beginB: number,
    public endA: number = beginA,
    public endB: number = beginB
  ) {}

  extendA(): void {
    this.endA++
  }

  extendB(): void {
    this.endB++
  }
}
```

### Phase 5: Binary Hunk Parser

**File**: `packages/diff/src/patch/binary-hunk.ts`

```typescript
export class BinaryHunk {
  public readonly file: FileHeader
  public readonly startOffset: number
  public endOffset: number

  public type: BinaryHunkType | null = null
  public size: number = 0

  parseHunk(ptr: number, end: number): number {
    const buf = this.file.buffer

    if (matchBytes(buf, ptr, LITERAL)) {
      this.type = BinaryHunkType.LITERAL_DEFLATED
      this.size = parseBase10(buf, ptr + LITERAL.length)
    } else if (matchBytes(buf, ptr, DELTA)) {
      this.type = BinaryHunkType.DELTA_DEFLATED
      this.size = parseBase10(buf, ptr + DELTA.length)
    } else {
      return -1 // Not a binary hunk
    }

    ptr = nextLF(buf, ptr)

    // Skip base85 encoded data until blank line
    while (ptr < end) {
      const isEmpty = buf[ptr] === '\n'.charCodeAt(0)
      ptr = nextLF(buf, ptr)
      if (isEmpty) {
        break
      }
    }

    return ptr
  }

  getData(): Uint8Array {
    // Extract base85 data between startOffset and endOffset
    const buf = this.file.buffer
    let ptr = nextLF(buf, this.startOffset) // Skip "literal" or "delta" line
    const dataStart = ptr
    const dataEnd = this.endOffset

    return buf.slice(dataStart, dataEnd)
  }
}
```

### Phase 6: Patch Applier

**File**: `packages/diff/src/patch/patch-applier.ts`

```typescript
export interface ApplyResult {
  treeId?: string
  paths: string[]
  errors: ApplyError[]
}

export interface ApplyError {
  message: string
  path: string
  hunk?: HunkHeader
  isGitConflict: boolean
}

export class PatchApplier {
  private allowConflicts: boolean = false

  constructor(
    private repo: Repository,
    private options: PatchOptions = {}
  ) {
    this.allowConflicts = options.allowConflicts ?? false
  }

  async applyPatch(patch: Patch): Promise<ApplyResult> {
    const result: ApplyResult = {
      paths: [],
      errors: []
    }

    for (const fh of patch.getFiles()) {
      switch (fh.changeType) {
        case ChangeType.ADD:
          await this.applyAdd(fh, result)
          break
        case ChangeType.MODIFY:
          await this.applyModify(fh, result)
          break
        case ChangeType.DELETE:
          await this.applyDelete(fh, result)
          break
        case ChangeType.RENAME:
          await this.applyRename(fh, result)
          break
        case ChangeType.COPY:
          await this.applyCopy(fh, result)
          break
      }
    }

    return result
  }

  private async applyText(
    oldLines: Uint8Array[],
    fileHeader: FileHeader,
    result: ApplyResult
  ): Promise<Uint8Array[]> {
    const newLines = [...oldLines]
    let lineNumberShift = 0
    let afterLastHunk = 0

    for (const hunk of fileHeader.getHunks()) {
      let applyAt = hunk.newStartLine - 1 + lineNumberShift

      // Fuzzy matching
      const position = this.findHunkPosition(
        hunk,
        newLines,
        applyAt,
        afterLastHunk
      )

      if (position === -1) {
        if (this.allowConflicts) {
          this.insertConflictMarkers(newLines, applyAt, hunk)
          result.errors.push({
            message: 'cannot apply hunk',
            path: fileHeader.oldPath,
            hunk,
            isGitConflict: true
          })
        } else {
          result.errors.push({
            message: 'cannot apply hunk',
            path: fileHeader.oldPath,
            hunk,
            isGitConflict: false
          })
          return [] // Fail
        }
      } else {
        applyAt = position
        this.applyHunkAt(hunk, newLines, applyAt)
      }

      afterLastHunk = applyAt
    }

    return newLines
  }

  private findHunkPosition(
    hunk: HunkHeader,
    lines: Uint8Array[],
    expected: number,
    afterLast: number
  ): number {
    const oldLinesInHunk = hunk.linesContext + hunk.linesDeleted

    if (oldLinesInHunk <= 1) {
      // No context - can't fuzzy match
      return this.canApplyAt(hunk, lines, expected) ? expected : -1
    }

    // Try backwards first
    const maxBackShift = expected - afterLast
    for (let shift = 0; shift <= maxBackShift; shift++) {
      if (this.canApplyAt(hunk, lines, expected - shift)) {
        return expected - shift
      }
    }

    // Try forwards
    const maxForwardShift = lines.length - expected - oldLinesInHunk
    for (let shift = 1; shift <= maxForwardShift; shift++) {
      if (this.canApplyAt(hunk, lines, expected + shift)) {
        return expected + shift
      }
    }

    return -1
  }

  private canApplyAt(
    hunk: HunkHeader,
    lines: Uint8Array[],
    position: number
  ): boolean {
    const hunkLines = this.extractHunkLines(hunk)
    let pos = position

    for (let i = 1; i < hunkLines.length; i++) {
      const hunkLine = hunkLines[i]
      if (hunkLine.length === 0) {
        // Empty context line
        if (pos >= lines.length || lines[pos].length > 0) {
          return false
        }
        pos++
        continue
      }

      const prefix = String.fromCharCode(hunkLine[0])
      if (prefix === ' ' || prefix === '-') {
        // Must match existing line
        if (pos >= lines.length) {
          return false
        }
        if (!this.bytesEqual(lines[pos], hunkLine.slice(1))) {
          return false
        }
        pos++
      }
    }

    return true
  }

  private applyHunkAt(
    hunk: HunkHeader,
    lines: Uint8Array[],
    position: number
  ): void {
    const hunkLines = this.extractHunkLines(hunk)
    let pos = position

    for (let i = 1; i < hunkLines.length; i++) {
      const hunkLine = hunkLines[i]
      if (hunkLine.length === 0) {
        pos++
        continue
      }

      const prefix = String.fromCharCode(hunkLine[0])
      switch (prefix) {
        case ' ':
          pos++
          break
        case '-':
          lines.splice(pos, 1)
          break
        case '+':
          lines.splice(pos, 0, hunkLine.slice(1))
          pos++
          break
      }
    }
  }

  private async applyBinary(
    oldData: Uint8Array,
    fileHeader: FileHeader,
    result: ApplyResult
  ): Promise<Uint8Array | null> {
    const hunk = fileHeader.forwardBinaryHunk
    if (!hunk) {
      return null
    }

    switch (hunk.type) {
      case BinaryHunkType.LITERAL_DEFLATED:
        return await this.applyLiteralBinary(hunk, oldData, fileHeader, result)

      case BinaryHunkType.DELTA_DEFLATED:
        return await this.applyDeltaBinary(hunk, oldData, fileHeader, result)

      default:
        result.errors.push({
          message: `Unsupported binary hunk type: ${hunk.type}`,
          path: fileHeader.oldPath,
          isGitConflict: false
        })
        return null
    }
  }

  private async applyLiteralBinary(
    hunk: BinaryHunk,
    oldData: Uint8Array,
    fileHeader: FileHeader,
    result: ApplyResult
  ): Promise<Uint8Array | null> {
    // 1. Verify old file hash matches
    const oldHash = await this.hashObject(oldData)
    if (fileHeader.oldId && oldHash !== fileHeader.oldId.hash) {
      result.errors.push({
        message: 'Old file hash mismatch',
        path: fileHeader.oldPath,
        isGitConflict: false
      })
      return null
    }

    // 2. Decode base85 and inflate
    const encoded = hunk.getData()
    const decoded = decodeGitBase85(encoded)
    const inflated = await inflateData(decoded)

    return inflated
  }

  private async applyDeltaBinary(
    hunk: BinaryHunk,
    oldData: Uint8Array,
    fileHeader: FileHeader,
    result: ApplyResult
  ): Promise<Uint8Array | null> {
    // 1. Decode base85 and inflate
    const encoded = hunk.getData()
    const decoded = decodeGitBase85(encoded)
    const deltaInstructions = await inflateData(decoded)

    // 2. Apply delta using existing implementation
    const newData = applyBinaryDelta(oldData, deltaInstructions)

    return newData
  }
}
```

### Phase 7: Utility Functions

**File**: `packages/diff/src/patch/utils.ts`

```typescript
export function matchBytes(
  buf: Uint8Array,
  offset: number,
  pattern: Uint8Array
): boolean {
  if (offset + pattern.length > buf.length) {
    return false
  }
  for (let i = 0; i < pattern.length; i++) {
    if (buf[offset + i] !== pattern[i]) {
      return false
    }
  }
  return true
}

export function nextLF(buf: Uint8Array, offset: number): number {
  for (let i = offset; i < buf.length; i++) {
    if (buf[i] === 0x0A) { // '\n'
      return i + 1
    }
  }
  return buf.length
}

export function nextChar(
  buf: Uint8Array,
  offset: number,
  char: string
): number {
  const code = char.charCodeAt(0)
  for (let i = offset; i < buf.length; i++) {
    if (buf[i] === code) {
      return i
    }
  }
  return buf.length
}

export function parseBase10(
  buf: Uint8Array,
  offset: number
): number {
  let result = 0
  let sign = 1
  let i = offset

  if (buf[i] === 0x2D) { // '-'
    sign = -1
    i++
  }

  while (i < buf.length) {
    const ch = buf[i]
    if (ch < 0x30 || ch > 0x39) { // '0'-'9'
      break
    }
    result = result * 10 + (ch - 0x30)
    i++
  }

  return result * sign
}

export function parseFileMode(
  buf: Uint8Array,
  offset: number
): FileMode {
  let mode = 0
  let i = offset

  while (i < buf.length) {
    const ch = buf[i]
    if (ch < 0x30 || ch > 0x37) { // '0'-'7' (octal)
      break
    }
    mode = (mode << 3) | (ch - 0x30)
    i++
  }

  return {
    mode,
    isExecutable: (mode & 0o111) !== 0,
    isSymlink: (mode & 0o170000) === 0o120000
  }
}

export function isHunkHeader(
  buf: Uint8Array,
  offset: number
): boolean {
  let ptr = offset
  let atCount = 0

  // Count leading '@' characters
  while (ptr < buf.length && buf[ptr] === 0x40) { // '@'
    atCount++
    ptr++
  }

  if (atCount < 2) {
    return false
  }

  // Must be followed by space and '-'
  if (ptr >= buf.length || buf[ptr] !== 0x20) { // ' '
    return false
  }
  ptr++

  if (ptr >= buf.length || buf[ptr] !== 0x2D) { // '-'
    return false
  }

  return true
}

// Git's base85 encoding (different from standard base85)
const BASE85_CHARS =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~"

export function decodeGitBase85(encoded: Uint8Array): Uint8Array {
  const result: number[] = []
  let offset = 0

  while (offset < encoded.length) {
    // Each line starts with a length character
    const lineStart = offset
    const lineEnd = nextLF(encoded, offset)

    if (lineEnd <= lineStart) {
      break
    }

    // First character encodes the output length
    const lengthChar = String.fromCharCode(encoded[lineStart])
    const outputLength = lengthChar.charCodeAt(0) - 'A'.charCodeAt(0) + 1

    // Decode the rest of the line
    let lineOffset = lineStart + 1
    while (lineOffset < lineEnd - 1 && result.length < outputLength) {
      // Read 5 base85 characters → 4 bytes
      let acc = 0
      for (let i = 0; i < 5 && lineOffset < lineEnd - 1; i++) {
        const ch = String.fromCharCode(encoded[lineOffset++])
        const value = BASE85_CHARS.indexOf(ch)
        if (value === -1) {
          throw new Error(`Invalid base85 character: ${ch}`)
        }
        acc = acc * 85 + value
      }

      // Extract 4 bytes
      result.push((acc >> 24) & 0xFF)
      result.push((acc >> 16) & 0xFF)
      result.push((acc >> 8) & 0xFF)
      result.push(acc & 0xFF)
    }

    offset = lineEnd
  }

  return new Uint8Array(result)
}

export async function inflateData(data: Uint8Array): Promise<Uint8Array> {
  // Use DecompressionStream or pako
  const ds = new DecompressionStream('deflate')
  const writer = ds.writable.getWriter()
  await writer.write(data)
  await writer.close()

  const chunks: Uint8Array[] = []
  const reader = ds.readable.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  // Concatenate chunks
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}
```

### Phase 8: Binary Delta Application

**File**: `packages/diff/src/patch/binary-delta.ts`

This can reuse the existing delta implementation from `packages/diff/src/delta/apply-delta.ts`, but we need to ensure it handles the Git pack delta format.

```typescript
export function applyBinaryDelta(
  base: Uint8Array,
  delta: Uint8Array
): Uint8Array {
  let offset = 0

  // Read base size (variable length encoding)
  const baseSize = readVariableLength(delta, offset)
  offset = baseSize.offset

  if (baseSize.value !== base.length) {
    throw new Error(
      `Base size mismatch: expected ${baseSize.value}, got ${base.length}`
    )
  }

  // Read result size
  const resultSize = readVariableLength(delta, offset)
  offset = resultSize.offset

  const result: number[] = []

  while (offset < delta.length) {
    const cmd = delta[offset++]

    if ((cmd & 0x80) !== 0) {
      // Copy from base
      let copyOffset = 0
      let copySize = 0

      // Read offset (up to 4 bytes)
      if ((cmd & 0x01) !== 0) copyOffset |= delta[offset++]
      if ((cmd & 0x02) !== 0) copyOffset |= delta[offset++] << 8
      if ((cmd & 0x04) !== 0) copyOffset |= delta[offset++] << 16
      if ((cmd & 0x08) !== 0) copyOffset |= delta[offset++] << 24

      // Read size (up to 3 bytes)
      if ((cmd & 0x10) !== 0) copySize |= delta[offset++]
      if ((cmd & 0x20) !== 0) copySize |= delta[offset++] << 8
      if ((cmd & 0x40) !== 0) copySize |= delta[offset++] << 16

      if (copySize === 0) {
        copySize = 0x10000 // 64K default
      }

      // Copy from base
      for (let i = 0; i < copySize; i++) {
        result.push(base[copyOffset + i])
      }
    } else if (cmd !== 0) {
      // Insert literal bytes
      const insertSize = cmd
      for (let i = 0; i < insertSize; i++) {
        result.push(delta[offset++])
      }
    } else {
      throw new Error('Invalid delta command: 0')
    }
  }

  if (result.length !== resultSize.value) {
    throw new Error(
      `Result size mismatch: expected ${resultSize.value}, got ${result.length}`
    )
  }

  return new Uint8Array(result)
}

function readVariableLength(
  buf: Uint8Array,
  offset: number
): { value: number; offset: number } {
  let value = 0
  let shift = 0

  while (offset < buf.length) {
    const byte = buf[offset++]
    value |= (byte & 0x7F) << shift
    shift += 7

    if ((byte & 0x80) === 0) {
      break
    }
  }

  return { value, offset }
}
```

---

## Integration with Existing Codebase

### 1. Reuse Existing Delta Infrastructure

The existing code in `packages/diff/src/delta/` provides:
- Delta creation with rolling hash ([create-delta-ranges.ts](packages/diff/src/delta/create-delta-ranges.ts))
- Fossil-like delta format ([fossil-delta-format.ts](packages/diff/src/delta/fossil-delta-format.ts))
- Delta application ([apply-delta.ts](packages/diff/src/delta/apply-delta.ts))

**Integration Strategy**:
1. Keep existing delta generation for custom format
2. Add Git pack delta format support alongside Fossil format
3. Share common delta application logic
4. Add Git binary patch encoding/decoding

### 2. Extend Test Infrastructure

Leverage existing JGit test integration:
- Use 161 test files from `packages/diff/tests/fixtures/jgit-full/`
- Add new test suite for patch parsing
- Validate against JGit behavior

**File**: `packages/diff/tests/patch-parser.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { Patch } from '../src/patch/patch-parser'
import { readFile } from 'fs/promises'
import { join } from 'path'

describe('Patch Parser', () => {
  describe('JGit Compatibility', () => {
    const fixturesDir = join(__dirname, 'fixtures/jgit-full')

    it('should parse all JGit test patches', async () => {
      const testCases = await discoverTestCases(fixturesDir)

      for (const testCase of testCases) {
        const patchData = await readFile(testCase.patchFile)
        const patch = new Patch()
        patch.parse(patchData)

        expect(patch.getErrors()).toHaveLength(0)
        expect(patch.getFiles()).not.toHaveLength(0)
      }
    })

    it('should extract correct metadata from X.patch', async () => {
      const patchData = await readFile(join(fixturesDir, 'X.patch'))
      const patch = new Patch()
      patch.parse(patchData)

      const files = patch.getFiles()
      expect(files).toHaveLength(1)

      const fh = files[0]
      expect(fh.oldPath).toBe('X')
      expect(fh.newPath).toBe('X')
      expect(fh.changeType).toBe('MODIFY')
      expect(fh.patchType).toBe('UNIFIED')

      const hunks = fh.getHunks()
      expect(hunks.length).toBeGreaterThan(0)
    })

    it('should parse binary patches correctly', async () => {
      const patchData = await readFile(join(fixturesDir, 'delta.patch'))
      const patch = new Patch()
      patch.parse(patchData)

      const files = patch.getFiles()
      expect(files[0].patchType).toBe('GIT_BINARY')
      expect(files[0].forwardBinaryHunk).not.toBeNull()
      expect(files[0].forwardBinaryHunk?.type).toBe('DELTA_DEFLATED')
    })
  })
})
```

### 3. File Structure

Organize new patch code alongside existing delta code:

```
packages/diff/
├── src/
│   ├── delta/
│   │   ├── create-delta-ranges.ts
│   │   ├── apply-delta.ts
│   │   ├── fossil-delta-format.ts
│   │   └── index.ts
│   ├── patch/
│   │   ├── types.ts                 # NEW
│   │   ├── patch-parser.ts          # NEW
│   │   ├── file-header.ts           # NEW
│   │   ├── hunk-header.ts           # NEW
│   │   ├── binary-hunk.ts           # NEW
│   │   ├── patch-applier.ts         # NEW
│   │   ├── binary-delta.ts          # NEW
│   │   ├── utils.ts                 # NEW
│   │   └── index.ts                 # NEW
│   └── index.ts
└── tests/
    ├── fixtures/
    │   ├── jgit/
    │   └── jgit-full/
    ├── patch-parser.test.ts          # NEW
    ├── patch-applier.test.ts         # NEW
    ├── binary-patch.test.ts          # NEW
    └── jgit-compatibility.test.ts   # NEW
```

### 4. Public API Design

**File**: `packages/diff/src/index.ts`

```typescript
// Delta operations (existing)
export {
  createDelta,
  applyDelta,
  createDeltaRanges,
  createFossilDelta
} from './delta'

// Patch operations (new)
export {
  Patch,
  FileHeader,
  HunkHeader,
  BinaryHunk,
  PatchApplier,
  type PatchOptions,
  type ApplyResult,
  type ApplyError,
  type FormatError,
  PatchType,
  ChangeType,
  BinaryHunkType
} from './patch'

// Utility functions
export {
  parsePatch,
  applyPatchToString,
  applyPatchToFile,
  generatePatch
} from './patch/helpers'
```

### 5. Naming Conventions

Following the project's kebab-case convention:

```typescript
// File names (kebab-case)
patch-parser.ts
file-header.ts
hunk-header.ts
binary-hunk.ts
patch-applier.ts
binary-delta.ts

// Class names (PascalCase in code)
class PatchParser {}
class FileHeader {}
class HunkHeader {}

// Function names (camelCase)
function parsePatch() {}
function applyPatch() {}
```

---

## References

### JGit Source Files Analyzed

1. [Patch.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/patch/Patch.java) - Main patch parsing entry point
2. [FileHeader.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/patch/FileHeader.java) - File header parsing and metadata
3. [HunkHeader.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/patch/HunkHeader.java) - Hunk parsing and edit list generation
4. [BinaryHunk.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/patch/BinaryHunk.java) - Binary patch data handling
5. [PatchApplier.java](tmp/jgit/org.eclipse.jgit/src/org/eclipse/jgit/patch/PatchApplier.java) - Patch application with fuzzy matching

### Existing Project Files

1. [03.diff-merge.spec.md](notes/src/2025-11-21/03.diff-merge.spec.md) - Fossil delta format specification
2. [JGIT_TEST_INTEGRATION.md](notes/src/2025-11-21/JGIT_TEST_INTEGRATION.md) - JGit test suite integration
3. [packages/diff/src/delta/](packages/diff/src/delta/) - Existing delta implementation

### External Resources

- Git patch format: https://git-scm.com/docs/git-diff
- Git binary delta format: https://git-scm.com/docs/pack-format
- JGit project: https://github.com/eclipse-jgit/jgit
- Base85 encoding: https://en.wikipedia.org/wiki/Ascii85

---

## Summary

The JGit patch parsing implementation provides a robust, production-tested foundation for handling Git patches in TypeScript. The key insights are:

1. **Incremental parsing** with byte-level offset tracking
2. **Fuzzy hunk matching** for applying patches to modified files
3. **Comprehensive error handling** with graceful degradation
4. **Support for all Git patch formats** including binary, text, and combined diffs
5. **Efficient memory usage** through buffer reuse and zero-copy operations

The proposed TypeScript implementation maintains compatibility with JGit's approach while leveraging modern JavaScript features like `Uint8Array`, async/await, and TypeScript's type system. Integration with the existing delta infrastructure ensures consistency across the codebase.

---

**Next Steps**:

1. Review this analysis with the team
2. Prioritize implementation phases
3. Set up development environment
4. Begin Phase 1 (Core Data Structures)
5. Iteratively implement and test each phase
6. Validate against JGit test suite
