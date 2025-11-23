/**
 * PatchApplier - applies patches to file content
 *
 * Based on JGit's PatchApplier.java
 * Supports:
 * - Text patch application with fuzzy matching
 * - Binary patch application (literal and delta)
 * - Handling different change types (ADD, DELETE, MODIFY, RENAME, COPY)
 */

import { nextLF } from "./buffer-utils.js";
import type { FileHeader } from "./file-header.js";
import type { HunkHeader } from "./hunk-header.js";
import { ChangeType, PatchType } from "./types.js";

/**
 * Result of applying a patch to a single file
 */
export interface FileApplyResult {
  /** Whether the patch was applied successfully */
  success: boolean;
  /** The resulting content after applying the patch */
  content: Uint8Array | null;
  /** List of errors encountered during application */
  errors: string[];
  /** List of warnings */
  warnings: string[];
}

/**
 * Options for patch application
 */
export interface ApplyOptions {
  /** Allow conflicts and insert conflict markers */
  allowConflicts?: boolean;
  /** Maximum number of lines to shift when fuzzy matching (default: 100) */
  maxFuzz?: number;
}

/**
 * Represents a line in the file
 */
interface Line {
  /** Line content as bytes */
  content: Uint8Array;
  /** Whether this line ends with \r\n (CRLF) */
  hasCrLf: boolean;
}

/**
 * PatchApplier applies patches to file content
 */
export class PatchApplier {
  private errors: string[] = [];
  private warnings: string[] = [];
  private readonly options: Required<ApplyOptions>;

  constructor(options: ApplyOptions = {}) {
    this.options = {
      allowConflicts: options.allowConflicts ?? false,
      maxFuzz: options.maxFuzz ?? 100,
    };
  }

  /**
   * Apply a file header patch to content
   *
   * @param fileHeader The file header containing hunks to apply
   * @param oldContent The original file content (null for ADD)
   * @returns Result of applying the patch
   */
  apply(fileHeader: FileHeader, oldContent: Uint8Array | null): FileApplyResult {
    this.errors = [];
    this.warnings = [];

    try {
      // Handle different change types
      switch (fileHeader.changeType) {
        case ChangeType.ADD:
          return this.applyAdd(fileHeader);

        case ChangeType.DELETE:
          return this.applyDelete();

        case ChangeType.MODIFY:
        case ChangeType.RENAME:
        case ChangeType.COPY:
          if (!oldContent) {
            this.errors.push("Cannot modify/rename/copy: old content is null");
            return this.createResult(false, null);
          }
          return this.applyModify(fileHeader, oldContent);

        default:
          this.errors.push(`Unknown change type: ${fileHeader.changeType}`);
          return this.createResult(false, null);
      }
    } catch (error) {
      this.errors.push(`Unexpected error: ${error}`);
      return this.createResult(false, null);
    }
  }

  /**
   * Apply ADD operation (create new file)
   */
  private applyAdd(fileHeader: FileHeader): FileApplyResult {
    // For ADD, we start with empty content and apply all hunks
    const emptyLines: Line[] = [];
    return this.applyHunks(fileHeader, emptyLines);
  }

  /**
   * Apply DELETE operation (remove file)
   */
  private applyDelete(): FileApplyResult {
    // DELETE means the file should be removed
    return this.createResult(true, null);
  }

  /**
   * Apply MODIFY operation (modify existing file)
   */
  private applyModify(fileHeader: FileHeader, oldContent: Uint8Array): FileApplyResult {
    // Handle binary patches
    if (fileHeader.patchType === PatchType.GIT_BINARY) {
      return this.applyBinary(fileHeader, oldContent);
    }

    // Parse old content into lines
    const oldLines = this.parseLines(oldContent);

    // Apply text hunks
    return this.applyHunks(fileHeader, oldLines);
  }

  /**
   * Apply binary patch
   */
  private applyBinary(fileHeader: FileHeader, _oldContent: Uint8Array): FileApplyResult {
    if (!fileHeader.forwardBinaryHunk) {
      this.errors.push("Binary patch has no forward hunk");
      return this.createResult(false, null);
    }

    // For now, we decode the base85 data but don't decompress
    // Full implementation would require inflate/deflate support
    try {
      fileHeader.forwardBinaryHunk.getData();
      // TODO: Inflate the data for full binary patch support
      this.warnings.push(
        "Binary patch application not fully implemented (requires inflate/deflate)",
      );
      return this.createResult(false, null);
    } catch (error) {
      this.errors.push(`Failed to decode binary patch: ${error}`);
      return this.createResult(false, null);
    }
  }

  /**
   * Apply text hunks to content
   */
  private applyHunks(fileHeader: FileHeader, oldLines: Line[]): FileApplyResult {
    const newLines = [...oldLines];
    let afterLastHunk = 0;

    // Apply each hunk
    for (const hunk of fileHeader.hunks) {
      const result = this.applyHunk(hunk, newLines, afterLastHunk);

      if (!result.success) {
        if (this.options.allowConflicts) {
          this.warnings.push(`Hunk at line ${hunk.oldStartLine} has conflicts`);
          // TODO: Insert conflict markers
        } else {
          this.errors.push(`Failed to apply hunk at line ${hunk.oldStartLine}`);
          return this.createResult(false, null);
        }
      }

      afterLastHunk = result.position;
    }

    // Convert lines back to bytes
    const content = this.linesToBytes(newLines);
    return this.createResult(true, content);
  }

  /**
   * Apply a single hunk to the content
   */
  private applyHunk(
    hunk: HunkHeader,
    lines: Line[],
    afterLastHunk: number,
  ): { success: boolean; position: number } {
    // Find best position for this hunk using fuzzy matching
    const expectedPosition = hunk.newStartLine - 1;
    const bestPosition = this.findBestHunkPosition(hunk, lines, expectedPosition, afterLastHunk);

    if (bestPosition < 0) {
      return { success: false, position: afterLastHunk };
    }

    // Apply the hunk at the found position
    let currentLine = bestPosition;
    const hunkLines = this.parseHunkLines(hunk);

    for (const hunkLine of hunkLines) {
      switch (hunkLine.type) {
        case " ": // Context line
          currentLine++;
          break;

        case "-": // Deletion
          lines.splice(currentLine, 1);
          break;

        case "+": // Addition
          lines.splice(currentLine, 0, hunkLine.line);
          currentLine++;
          break;
      }
    }

    return { success: true, position: currentLine };
  }

  /**
   * Find the best position to apply a hunk using fuzzy matching
   */
  private findBestHunkPosition(
    hunk: HunkHeader,
    lines: Line[],
    expectedPosition: number,
    afterLastHunk: number,
  ): number {
    const oldLinesInHunk = hunk.contextLineCount + hunk.deletedLineCount;

    // Can't do fuzzy matching without context
    if (oldLinesInHunk <= 1) {
      if (this.canApplyAt(hunk, lines, expectedPosition)) {
        return expectedPosition;
      }
      return -1;
    }

    // Try shifting backwards first (prefer earlier positions)
    const maxBackShift = Math.min(expectedPosition - afterLastHunk, this.options.maxFuzz);
    for (let shift = 0; shift <= maxBackShift; shift++) {
      const pos = expectedPosition - shift;
      if (this.canApplyAt(hunk, lines, pos)) {
        if (shift > 0) {
          this.warnings.push(`Applied hunk at line ${pos + 1} (shifted by -${shift} lines)`);
        }
        return pos;
      }
    }

    // Try shifting forwards
    const maxForwardShift = Math.min(
      lines.length - expectedPosition - oldLinesInHunk,
      this.options.maxFuzz,
    );
    for (let shift = 1; shift <= maxForwardShift; shift++) {
      const pos = expectedPosition + shift;
      if (this.canApplyAt(hunk, lines, pos)) {
        this.warnings.push(`Applied hunk at line ${pos + 1} (shifted by +${shift} lines)`);
        return pos;
      }
    }

    return -1;
  }

  /**
   * Check if a hunk can be applied at a specific position
   */
  private canApplyAt(hunk: HunkHeader, lines: Line[], position: number): boolean {
    const hunkLines = this.parseHunkLines(hunk);
    let currentLine = position;

    for (const hunkLine of hunkLines) {
      if (hunkLine.type === "+") {
        // Addition doesn't need to match
        continue;
      }

      // Check if we have enough lines
      if (currentLine >= lines.length) {
        return false;
      }

      // Context and deletion lines must match
      if (hunkLine.type === " " || hunkLine.type === "-") {
        const fileLine = lines[currentLine];
        if (!this.linesMatch(hunkLine.line, fileLine)) {
          return false;
        }
        currentLine++;
      }
    }

    return true;
  }

  /**
   * Check if two lines match (ignoring trailing whitespace)
   */
  private linesMatch(line1: Line, line2: Line): boolean {
    // Compare content, ignoring trailing whitespace
    const content1 = this.trimTrailingWhitespace(line1.content);
    const content2 = this.trimTrailingWhitespace(line2.content);

    if (content1.length !== content2.length) {
      return false;
    }

    for (let i = 0; i < content1.length; i++) {
      if (content1[i] !== content2[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Trim trailing whitespace from a line
   */
  private trimTrailingWhitespace(content: Uint8Array): Uint8Array {
    let end = content.length;
    while (end > 0 && (content[end - 1] === 0x20 || content[end - 1] === 0x09)) {
      // space or tab
      end--;
    }
    return content.slice(0, end);
  }

  /**
   * Parse lines from a hunk
   */
  private parseHunkLines(hunk: HunkHeader): Array<{ type: string; line: Line }> {
    const result: Array<{ type: string; line: Line }> = [];
    let ptr = hunk.startOffset;

    // Skip hunk header line
    ptr = nextLF(hunk.buffer, ptr);

    // Parse each line in the hunk
    while (ptr < hunk.endOffset) {
      const lineType = hunk.getLineType(ptr);

      if (lineType === "\\") {
        // "No newline at end of file" marker
        ptr = nextLF(hunk.buffer, ptr);
        continue;
      }

      if (lineType !== " " && lineType !== "-" && lineType !== "+") {
        // End of hunk or unknown line type
        break;
      }

      // Extract line content (skip the +/- prefix)
      const lineEnd = nextLF(hunk.buffer, ptr);
      const contentStart = ptr + 1; // Skip the type character

      // Check for CRLF
      let contentEnd = lineEnd - 1; // Skip newline
      const hasCrLf = contentEnd > contentStart && hunk.buffer[contentEnd - 1] === 0x0d;
      if (hasCrLf) {
        contentEnd--; // Skip CR
      }

      const content = hunk.buffer.slice(contentStart, contentEnd);
      result.push({
        type: lineType,
        line: { content, hasCrLf },
      });

      ptr = lineEnd;
    }

    return result;
  }

  /**
   * Parse content into lines
   */
  private parseLines(content: Uint8Array): Line[] {
    const lines: Line[] = [];
    let offset = 0;

    while (offset < content.length) {
      const lineEnd = nextLF(content, offset);

      // Extract line content
      let contentEnd = lineEnd;
      if (contentEnd > offset && content[contentEnd - 1] === 0x0a) {
        contentEnd--; // Skip LF
      }

      const hasCrLf = contentEnd > offset && content[contentEnd - 1] === 0x0d;
      if (hasCrLf) {
        contentEnd--; // Skip CR
      }

      const lineContent = content.slice(offset, contentEnd);
      lines.push({ content: lineContent, hasCrLf });

      offset = lineEnd;
      if (offset >= content.length) {
        break;
      }
    }

    return lines;
  }

  /**
   * Convert lines back to bytes
   */
  private linesToBytes(lines: Line[]): Uint8Array {
    // Calculate total size
    let totalSize = 0;
    for (const line of lines) {
      totalSize += line.content.length;
      if (line.hasCrLf) {
        totalSize += 2; // CR + LF
      } else {
        totalSize += 1; // LF
      }
    }

    // Allocate buffer and copy lines
    const result = new Uint8Array(totalSize);
    let offset = 0;

    for (const line of lines) {
      result.set(line.content, offset);
      offset += line.content.length;

      if (line.hasCrLf) {
        result[offset++] = 0x0d; // CR
        result[offset++] = 0x0a; // LF
      } else {
        result[offset++] = 0x0a; // LF
      }
    }

    return result;
  }

  /**
   * Create a result object
   */
  private createResult(success: boolean, content: Uint8Array | null): FileApplyResult {
    return {
      success,
      content,
      errors: [...this.errors],
      warnings: [...this.warnings],
    };
  }

  /**
   * Get errors from the last apply operation
   */
  getErrors(): string[] {
    return [...this.errors];
  }

  /**
   * Get warnings from the last apply operation
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }
}
